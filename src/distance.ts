/**
 * XOR distance over 256-bit ids — the whole metric a Kademlia DHT runs on.
 *
 * A node's id and a file's id live in the same 256-bit space (both are sha256 hashes), and
 * "closeness" is the XOR of two ids read as a big number. The only operations the rest of the DHT
 * needs are: turn a seed into an id, compare two ids' distance to a target, and find which bit an
 * id first differs at (its k-bucket). Nothing here talks to the network; it is pure arithmetic, so
 * it is the part that can be pinned down completely by tests before any node exists.
 */
import { createHash } from 'node:crypto';

export type Id = Uint8Array; // 32 bytes

/** A peer or provider the DHT can reach: its id and where it answers. */
export interface Peer { id: Id; url: string }

/** A node/provider id from any seed (a url, a pubkey). A fileId is already a hash — use idFromHex. */
export const idOf = (seed: string): Id => new Uint8Array(createHash('sha256').update(seed).digest());

export function idFromHex(hex: string): Id {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('an id is 32 bytes of hex');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export const toHex = (id: Id): string => [...id].map((b) => b.toString(16).padStart(2, '0')).join('');

const xor = (a: Id, b: Id): Id => a.map((x, i) => x ^ (b[i] ?? 0));

export const distanceHex = (a: Id, b: Id): string => toHex(xor(a, b));

/** Which of a, b is closer to target under XOR (returns the closer id; ties return a). */
export function closerOf(target: Id, a: Id, b: Id): Id {
  const da = xor(target, a);
  const db = xor(target, b);
  for (let i = 0; i < da.length; i++) {
    const x = da[i] ?? 0;
    const y = db[i] ?? 0;
    if (x !== y) return x < y ? a : b;
  }
  return a;
}

/**
 * The index of the highest bit at which two ids differ (0..255), or -1 if identical. This is the
 * k-bucket an id belongs in relative to self: distant ids (high differing bit) spread across the
 * high buckets, near ids fall into the low ones.
 */
export function bucketIndex(self: Id, other: Id): number {
  const d = xor(self, other);
  for (let i = 0; i < d.length; i++) {
    const byte = d[i] ?? 0;
    if (byte !== 0) {
      const bitInByte = 7 - Math.floor(Math.log2(byte)); // highest set bit within the byte
      return (d.length - 1 - i) * 8 + (7 - bitInByte);
    }
  }
  return -1;
}
