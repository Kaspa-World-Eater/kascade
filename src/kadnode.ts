/**
 * A DHT node: the thing that replaces kascade's central tracker.
 *
 * A tracker is a single list of "who holds which file". This distributes that list: each node keeps
 * only the provider records nearest its own id, and any node can find a file's providers by walking
 * the network toward that file's id — asking the closest nodes it knows, learning closer ones from
 * their answers, and repeating until it can get no closer (Kademlia's iterative lookup). No node has
 * the whole list, and there is no node everyone must ask.
 *
 * Transport is abstracted (`Rpc`) so the same node logic runs over an in-process map in a test and
 * over HTTP between machines in production — exactly the split the founts already use. This slice is
 * the node and its lookup; the HTTP transport and wiring founts/gatherers onto it come next.
 */
import { type Id, type Peer, idOf, toHex } from './distance.js';
import { RoutingTable } from './routing.js';

/** How a node reaches another. Every call carries `from` so the callee learns the caller exists. */
export interface Rpc {
  findProviders(url: string, target: Id, from: Peer): Promise<{ providers: string[]; peers: Peer[] }>;
  storeProvider(url: string, fileId: Id, provider: string, from: Peer): Promise<void>;
}

export class KadNode {
  readonly id: Id;
  readonly self: Peer;
  readonly table: RoutingTable;
  private readonly providers = new Map<string, Set<string>>(); // fileId hex -> provider urls

  constructor(readonly url: string, private readonly rpc: Rpc, seeds: Peer[] = [], private readonly k = 20) {
    this.id = idOf(url);
    this.self = { id: this.id, url };
    this.table = new RoutingTable(this.id, k);
    for (const s of seeds) this.table.add(s);
  }

  /** Answer a lookup: record the caller, then return known providers plus the peers nearest target. */
  onFindProviders(target: Id, from: Peer): { providers: string[]; peers: Peer[] } {
    this.table.add(from);
    return { providers: [...(this.providers.get(toHex(target)) ?? [])], peers: this.table.closest(target, this.k) };
  }

  /** Record that `provider` holds `fileId`, and remember the caller. */
  onStoreProvider(fileId: Id, provider: string, from: Peer): void {
    this.table.add(from);
    const key = toHex(fileId);
    const set = this.providers.get(key) ?? new Set<string>();
    set.add(provider);
    this.providers.set(key, set);
  }

  /** Iterative lookup toward `target`: query the closest unqueried peer until none is left, learning
   *  closer peers as we go. `collect` gathers providers seen along the way. Returns the closest peers. */
  private async walk(target: Id, collect?: (providers: string[]) => void): Promise<Peer[]> {
    const queried = new Set<string>();
    let shortlist = this.table.closest(target, this.k);
    for (;;) {
      const next = shortlist.find((p) => !queried.has(p.url));
      if (!next) return shortlist;
      queried.add(next.url);
      const r = await this.rpc.findProviders(next.url, target, this.self);
      collect?.(r.providers);
      for (const p of r.peers) if (p.url !== this.url) this.table.add(p);
      shortlist = this.table.closest(target, this.k);
    }
  }

  /** Enter the network through a known node, filling the table with peers near us. */
  async join(bootstrap: Peer): Promise<void> {
    this.table.add(bootstrap);
    await this.walk(this.id);
  }

  /** Announce that `provider` serves `fileId`, storing the record on the nodes nearest the file's id. */
  async announce(fileId: Id, provider: string): Promise<number> {
    const targets = await this.walk(fileId);
    this.onStoreProvider(fileId, provider, this.self);
    for (const p of targets) await this.rpc.storeProvider(p.url, fileId, provider, this.self);
    return targets.length;
  }

  /** Find who serves `fileId`, by walking the network toward its id and collecting provider records. */
  async findProviders(fileId: Id): Promise<string[]> {
    const found = new Set<string>(this.providers.get(toHex(fileId)) ?? []);
    await this.walk(fileId, (ps) => ps.forEach((x) => found.add(x)));
    return [...found];
  }
}

/** An in-process network of nodes sharing one address space — the DHT with the wire stubbed out. */
export function inProcessNetwork(): { rpc: Rpc; register: (n: KadNode) => void } {
  const nodes = new Map<string, KadNode>();
  const rpc: Rpc = {
    async findProviders(url, target, from) {
      const n = nodes.get(url);
      return n ? n.onFindProviders(target, from) : { providers: [], peers: [] };
    },
    async storeProvider(url, fileId, provider, from) {
      nodes.get(url)?.onStoreProvider(fileId, provider, from);
    },
  };
  return { rpc, register: (n) => { nodes.set(n.url, n); } };
}
