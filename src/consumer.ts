/**
 * The buyer's side: reassemble a file from many providers at once, paying each for what it served.
 *
 * This is the swarm. For every chunk the manifest names, the consumer picks a provider that holds it,
 * pulls the bytes, and CHECKS THEM against the manifest before believing or paying anything. A chunk
 * that fails the check is not paid for and the provider that served it is recorded as a fault (the
 * thing a bond is slashed for); the consumer routes around it to another holder and the file still
 * completes. Payment is accrued per provider -- each is owed the bytes it actually delivered times the
 * price -- which is what a rail voucher per provider will carry.
 *
 * TWO PROPERTIES FALL OUT OF THE MANIFEST, for free:
 *   - You cannot be made to pay for junk: a wrong chunk never verifies, so it is never billed.
 *   - You cannot be overbilled: the amount is the chunk's size FROM THE MANIFEST, which the consumer
 *     knew before it asked -- a provider cannot inflate it.
 * Stopping partway is honest for the same reason spigot's is: you have paid for the chunks that
 * arrived and verified, and nothing else.
 */
import { verifyChunk, type Manifest } from './manifest.js';
import type { Holder } from './tracker.js';

export interface ProviderTally { chunks: number; bytes: number; sompi: number }

export interface Receipt {
  perProvider: Record<string, ProviderTally>;
  totalSompi: number;
  chunksGot: number;
  bytesGot: number;
  complete: boolean;
  /** a provider served a chunk that failed the manifest -- the evidence a bond is slashed on */
  faults: { url: string; index: number }[];
}

export interface FetchOptions {
  manifest: Manifest;
  holders: Holder[];
  priceSompi: number;
  concurrency?: number;
  onChunk?: (index: number, bytes: Uint8Array, from: string) => void;
  stop?: () => boolean;
}

/** For each chunk index, the providers that claim to hold it. */
function holdersByIndex(holders: Holder[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const h of holders) for (const i of h.indices) m.set(i, [...(m.get(i) ?? []), h.url]);
  return m;
}

async function fetchChunk(url: string, fileId: string, index: number): Promise<Uint8Array> {
  const res = await fetch(`${url}/shoal/chunk?file=${encodeURIComponent(fileId)}&i=${index}`);
  if (!res.ok) throw new Error(`chunk ${index} from ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Try each candidate for one chunk until one verifies; record the ones that failed as faults. */
async function getOneChunk(
  index: number, candidates: string[], manifest: Manifest, faults: Receipt['faults'],
): Promise<{ from: string; bytes: Uint8Array } | null> {
  for (const url of candidates) {
    try {
      const bytes = await fetchChunk(url, manifest.fileId, index);
      if (verifyChunk(manifest, index, bytes)) return { from: url, bytes };
      faults.push({ url, index });
    } catch { /* unreachable or errored -- try the next holder */ }
  }
  return null;
}

function credit(tallies: Record<string, ProviderTally>, url: string, bytes: number, priceSompi: number): number {
  const t = tallies[url] ?? { chunks: 0, bytes: 0, sompi: 0 };
  const sompi = bytes * priceSompi;
  tallies[url] = { chunks: t.chunks + 1, bytes: t.bytes + bytes, sompi: t.sompi + sompi };
  return sompi;
}

/** Pull the whole file from the swarm, in parallel, paying each provider for what it delivered. */
export async function fetchFile(opts: FetchOptions): Promise<{ bytes: Uint8Array; receipt: Receipt }> {
  const { manifest } = opts;
  const candidates = holdersByIndex(opts.holders);
  const got = new Map<number, Uint8Array>();
  const receipt: Receipt = { perProvider: {}, totalSompi: 0, chunksGot: 0, bytesGot: 0, complete: false, faults: [] };
  const queue = manifest.chunks.map((c) => c.index);
  let cursor = 0;
  const usage = new Map<string, number>();

  const pick = (urls: string[]): string[] =>
    [...urls].sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0)); // least-loaded provider first

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      if (opts.stop?.()) return;
      const index = queue[cursor++] as number;
      const urls = pick(candidates.get(index) ?? []);
      urls.forEach((u) => usage.set(u, (usage.get(u) ?? 0) + 1));
      const chunk = await getOneChunk(index, urls, manifest, receipt.faults);
      if (!chunk) continue; // no holder could supply a valid copy; file stays incomplete
      got.set(index, chunk.bytes);
      receipt.totalSompi += credit(receipt.perProvider, chunk.from, chunk.bytes.length, opts.priceSompi);
      receipt.chunksGot += 1;
      receipt.bytesGot += chunk.bytes.length;
      opts.onChunk?.(index, chunk.bytes, chunk.from);
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));

  receipt.complete = got.size === manifest.chunks.length;
  const bytes = new Uint8Array(receipt.complete ? manifest.size : receipt.bytesGot);
  if (receipt.complete) {
    let at = 0;
    for (const c of manifest.chunks) { bytes.set(got.get(c.index) as Uint8Array, at); at += c.size; }
  }
  return { bytes, receipt };
}
