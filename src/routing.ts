/**
 * A Kademlia routing table: what one node remembers about the others.
 *
 * Peers are filed into 256 buckets by their XOR distance from this node (see [[distance]]), so the
 * node knows many peers close to itself and progressively fewer far away — the structure that lets a
 * lookup home in on any target in O(log n) hops. This slice keeps the memory and the one query a
 * lookup needs; the network calls that fill the table and walk it live in the node layer above.
 *
 * Bucket capacity `k` bounds how much any one region is remembered. When a bucket is full this keeps
 * the peers it already knows rather than evicting them — real Kademlia pings the least-recently-seen
 * peer and drops it only if dead; that liveness check belongs with the node that can actually ping.
 */
import { type Id, type Peer, bucketIndex, closerOf, toHex } from './distance.js';

export type { Peer };

export class RoutingTable {
  private readonly buckets: Peer[][] = Array.from({ length: 256 }, () => []);
  private readonly known = new Set<string>(); // peer id hexes, for dedup and size

  constructor(private readonly selfId: Id, private readonly k = 20) {}

  /** Remember a peer, unless it is us or already known, and unless its bucket is full. */
  add(peer: Peer): void {
    const b = bucketIndex(this.selfId, peer.id);
    if (b < 0) return; // that is us
    const hex = toHex(peer.id);
    if (this.known.has(hex)) return;
    const bucket = this.buckets[b] as Peer[];
    if (bucket.length >= this.k) return;
    bucket.push(peer);
    this.known.add(hex);
  }

  size(): number {
    return this.known.size;
  }

  /** The `count` peers nearest `target` under XOR distance, nearest first. */
  closest(target: Id, count: number): Peer[] {
    const all = this.buckets.flat();
    all.sort((a, b) => (closerOf(target, a.id, b.id) === a.id ? -1 : 1));
    return all.slice(0, count);
  }
}
