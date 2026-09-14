/**
 * The buyer's side: reassemble a file from many founts at once, paying each for what it served.
 *
 * This is the meridian. For every parcel the manifest names, the consumer picks a fount that holds it,
 * pulls the bytes, and CHECKS THEM against the manifest before believing or paying anything. A parcel
 * that fails the check is not paid for and the fount that served it is recorded as a fault (the
 * thing a bond is slashed for); the consumer routes around it to another holder and the file still
 * completes. Payment is accrued per fount -- each is owed the bytes it actually delivered times the
 * price -- which is what a rail voucher per fount will carry.
 *
 * TWO PROPERTIES FALL OUT OF THE MANIFEST, for free:
 *   - You cannot be made to pay for junk: a wrong parcel never verifies, so it is never billed.
 *   - You cannot be overbilled: the amount is the parcel's size FROM THE MANIFEST, which the consumer
 *     knew before it asked -- a fount cannot inflate it.
 * Stopping partway is honest for the same reason spigot's is: you have paid for the parcels that
 * arrived and verified, and nothing else.
 */
import { verifyParcel, type Manifest } from './manifest.js';
import { assemble } from './assemble.js';
import type { Holder } from './tracker.js';

export interface FountTally { parcels: number; bytes: number; sompi: number }

export interface Receipt {
  perFount: Record<string, FountTally>;
  totalSompi: number;
  parcelsGot: number;
  bytesGot: number;
  complete: boolean;
  /** a fount served a parcel that failed the manifest -- the evidence a bond is slashed on */
  faults: { url: string; index: number }[];
}

export interface FetchOptions {
  manifest: Manifest;
  holders: Holder[];
  priceSompi: number;
  concurrency?: number;
  onParcel?: (index: number, bytes: Uint8Array, from: string) => void;
  stop?: () => boolean;
}

/** For each parcel index, the founts that claim to hold it. */
function holdersByIndex(holders: Holder[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const h of holders) for (const i of h.indices) m.set(i, [...(m.get(i) ?? []), h.url]);
  return m;
}

async function fetchParcel(url: string, fileId: string, index: number): Promise<Uint8Array> {
  const res = await fetch(`${url}/kascade/parcel?file=${encodeURIComponent(fileId)}&i=${index}`);
  if (!res.ok) throw new Error(`parcel ${index} from ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Try each candidate for one parcel until one verifies; record the ones that failed as faults. */
async function getOneParcel(
  index: number, candidates: string[], manifest: Manifest, faults: Receipt['faults'],
): Promise<{ from: string; bytes: Uint8Array } | null> {
  for (const url of candidates) {
    try {
      const bytes = await fetchParcel(url, manifest.fileId, index);
      if (verifyParcel(manifest, index, bytes)) return { from: url, bytes };
      faults.push({ url, index });
    } catch { /* unreachable or errored -- try the next holder */ }
  }
  return null;
}

function credit(tallies: Record<string, FountTally>, url: string, bytes: number, priceSompi: number): number {
  const t = tallies[url] ?? { parcels: 0, bytes: 0, sompi: 0 };
  const sompi = bytes * priceSompi;
  tallies[url] = { parcels: t.parcels + 1, bytes: t.bytes + bytes, sompi: t.sompi + sompi };
  return sompi;
}

/** Pull the whole file from the meridian, in parallel, paying each fount for what it delivered. */
export async function fetchFile(opts: FetchOptions): Promise<{ bytes: Uint8Array; receipt: Receipt }> {
  const { manifest } = opts;
  const candidates = holdersByIndex(opts.holders);
  const got = new Map<number, Uint8Array>();
  const receipt: Receipt = { perFount: {}, totalSompi: 0, parcelsGot: 0, bytesGot: 0, complete: false, faults: [] };
  const queue = manifest.parcels.map((c) => c.index);
  let cursor = 0;
  const usage = new Map<string, number>();

  const pick = (urls: string[]): string[] =>
    [...urls].sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0)); // least-loaded fount first

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      if (opts.stop?.()) return;
      const index = queue[cursor++] as number;
      const urls = pick(candidates.get(index) ?? []);
      urls.forEach((u) => usage.set(u, (usage.get(u) ?? 0) + 1));
      const parcel = await getOneParcel(index, urls, manifest, receipt.faults);
      if (!parcel) continue; // no holder could supply a valid copy; file stays incomplete
      got.set(index, parcel.bytes);
      receipt.totalSompi += credit(receipt.perFount, parcel.from, parcel.bytes.length, opts.priceSompi);
      receipt.parcelsGot += 1;
      receipt.bytesGot += parcel.bytes.length;
      opts.onParcel?.(index, parcel.bytes, parcel.from);
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));

  const { bytes, complete } = assemble(manifest, got);
  receipt.complete = complete;
  return { bytes, receipt };
}
