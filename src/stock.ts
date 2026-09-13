/**
 * Loading files into a fount, inside a storage budget it can never exceed.
 *
 * A fount serves what it holds — but a node operator will only run one that respects a cap. So a
 * fount is stocked THROUGH a [[cache]]: files are cut into parcels and put into a ParcelCache with a
 * fixed capacity, and what comes back out is only what fit. Stock more than the budget and the cold
 * parcels fall away; a single parcel bigger than the whole budget is skipped, not fatal. The fount
 * then serves exactly the bounded set the cache is holding — which is what makes it safe to drop into
 * a Kaspa node.
 */
import { buildManifest, DEFAULT_PARCEL, type Manifest } from './manifest.js';
import { ParcelCache, OverCapacity } from './cache.js';
import type { Held } from './fount.js';

export interface StockFile {
  name: string;
  bytes: Uint8Array;
}

/** Fill a bounded cache with these files, and return what a fount can actually serve from it. */
export function stock(files: StockFile[], capacityBytes: number, parcelSize = DEFAULT_PARCEL): { held: Held[]; cache: ParcelCache } {
  const cache = new ParcelCache(capacityBytes);
  const manifests: Manifest[] = [];
  for (const file of files) {
    const m = buildManifest(file.name, file.bytes, parcelSize);
    manifests.push(m);
    for (const p of m.parcels) {
      const b = file.bytes.subarray(p.index * m.parcelSize, p.index * m.parcelSize + p.size);
      try {
        cache.put(m.fileId, p.index, b, { pinned: false });
      } catch (e) {
        if (!(e instanceof OverCapacity)) throw e; // a parcel bigger than the whole budget: skip it
      }
    }
  }
  const held: Held[] = [];
  for (const m of manifests) {
    const parcels = new Map<number, Uint8Array>();
    for (const p of m.parcels) {
      const b = cache.get(m.fileId, p.index);
      if (b) parcels.set(p.index, b);
    }
    if (parcels.size > 0) held.push({ manifest: m, parcels });
  }
  return { held, cache };
}
