/**
 * The DHT over real sockets, and the bridge that lets it replace the central tracker.
 *
 * Slice 2 proved the node logic against an in-process map; this is the same `Rpc`, now HTTP, so nodes
 * on different machines route to each other. Ids travel as hex. A node is its own reachable url, and
 * because the url is only known after the socket is bound, `startDhtNode` binds first and then builds
 * the node — the handlers read the node lazily, so a request never arrives before it exists.
 *
 * `holdersViaDht` is the actual tracker replacement: it asks the DHT who serves a file, then asks each
 * of those founts (over the fount's own /kascade/have) which parcels it holds — the two halves the
 * central tracker used to keep in one list, now assembled with no central list at all.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Id, type Peer, idOf, idFromHex, toHex } from './distance.js';
import { KadNode, type Rpc } from './kadnode.js';

/** A bootstrap peer from just its url (its id is the hash of that url). */
export const peerOf = (url: string): Peer => ({ id: idOf(url), url });

const encPeer = (p: Peer): { id: string; url: string } => ({ id: toHex(p.id), url: p.url });
const decPeer = (p: { id: string; url: string }): Peer => ({ id: idFromHex(p.id), url: p.url });

const post = async (url: string, path: string, body: unknown): Promise<unknown> => {
  const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`dht ${path} -> ${r.status}`);
  return r.json();
};

/** The Rpc, over HTTP. A failed call returns empty rather than throwing — a dead peer is just silent. */
export function httpRpc(): Rpc {
  return {
    async findProviders(url, target, from) {
      try {
        const j = (await post(url, '/dht/find', { target: toHex(target), from: encPeer(from) })) as { providers: string[]; peers: { id: string; url: string }[] };
        return { providers: j.providers ?? [], peers: (j.peers ?? []).map(decPeer) };
      } catch { return { providers: [], peers: [] }; }
    },
    async storeProvider(url, fileId, provider, from) {
      try { await post(url, '/dht/store', { fileId: toHex(fileId), provider, from: encPeer(from) }); } catch { /* a dead peer stores nothing */ }
    },
  };
}

const readBody = (req: IncomingMessage): Promise<Record<string, string>> =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

function serve(node: () => KadNode): Server {
  const json = (res: ServerResponse, body: unknown): void => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  return createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (req.method !== 'POST' || !u.pathname.startsWith('/dht/')) { res.writeHead(404); res.end(); return; }
    void readBody(req).then((b) => {
      if (u.pathname === '/dht/find') {
        const out = node().onFindProviders(idFromHex(b.target as string), decPeer(b.from as unknown as { id: string; url: string }));
        return json(res, { providers: out.providers, peers: out.peers.map(encPeer) });
      }
      node().onStoreProvider(idFromHex(b.fileId as string), b.provider as string, decPeer(b.from as unknown as { id: string; url: string }));
      json(res, { ok: true });
    }).catch(() => { res.writeHead(400); res.end(); });
  });
}

/** Bind a DHT node on a free port, then build the node at its own url and (optionally) join a bootstrap. */
export async function startDhtNode(seeds: Peer[] = [], port = 0): Promise<{ node: KadNode; url: string; close: () => Promise<void> }> {
  let node: KadNode;
  const server = serve(() => node);
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  node = new KadNode(url, httpRpc(), seeds);
  return { node, url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** THE TRACKER REPLACEMENT: who serves this file, and which parcels each holds — via the DHT, no central list. */
export async function holdersViaDht(node: KadNode, fileIdHex: string): Promise<{ url: string; indices: number[] }[]> {
  const urls = await node.findProviders(idFromHex(fileIdHex));
  const holders: { url: string; indices: number[] }[] = [];
  for (const url of urls) {
    const have = await fetch(`${url}/kascade/have`).then((r) => r.json()).catch(() => []);
    const row = (have as { fileId: string; indices: number[] }[]).find((h) => h.fileId === fileIdHex);
    if (row) holders.push({ url, indices: row.indices });
  }
  return holders;
}

/** A throwaway client node bootstrapped to one DHT node — for a fount announcing or a gatherer resolving. */
export async function dhtClient(bootstrapUrl: string, label: string): Promise<KadNode> {
  const c = new KadNode(label, httpRpc(), [peerOf(bootstrapUrl)]);
  await c.join(peerOf(bootstrapUrl));
  return c;
}
