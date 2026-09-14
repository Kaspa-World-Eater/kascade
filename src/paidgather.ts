/**
 * A whole file, pulled across the Meridian and paid per parcel, with reroute around a bad fount.
 *
 * Each parcel is assigned to a fount that holds it and that the gatherer has a channel with, and each
 * fount is pulled from in parallel ([[paidpull]]). If a fount refuses or serves junk, it delivers only
 * what it verified; the parcels it did NOT deliver are reassigned to other payable holders and pulled
 * again, until the file is complete or no untried holder is left. A fount may be pulled from more than
 * once across passes, so its voucher ceiling is threaded cumulatively -- the same rule channel reuse
 * uses. The liar is paid for nothing; the file still completes from the honest ones.
 */
import type { Voucher, ChannelRef } from 'metered-protocol';
import type { Manifest } from './manifest.js';
import type { Holder } from './tracker.js';
import { paidPull } from './paidpull.js';
import { assemble } from './assemble.js';

export interface PaidGatherOptions {
  manifest: Manifest;
  holders: Holder[];
  /** the channel the gatherer holds with each fount, by fount url */
  channelByFount: Record<string, ChannelRef>;
  buyerSk: string;
  /** fallback price when a fount's own advertised price is unknown */
  priceSompi: number;
  /** each fount's advertised price (sompi/byte), by url -- so the gatherer pays what the fount charges */
  priceByFount?: Record<string, number>;
  /** ceiling already vouched on each fount's channel, by fount url -- so a reused channel resumes. */
  vouchedByFount?: Record<string, number>;
}

export interface PaidGatherResult {
  bytes: Uint8Array;
  complete: boolean;
  perFount: Record<string, { parcels: number; sompi: number; voucher: Voucher }>;
}

/** Payable holders for each parcel: founts that hold it AND that the gatherer has a channel with. */
function candidatesFor(manifest: Manifest, holders: Holder[], channelByFount: Record<string, ChannelRef>): Map<number, string[]> {
  const byIndex = new Map<number, string[]>();
  for (const h of holders) {
    if (!channelByFount[h.url]) continue;
    for (const i of h.indices) byIndex.set(i, [...(byIndex.get(i) ?? []), h.url]);
  }
  return byIndex;
}

/** Assign each not-yet-gathered parcel to a least-loaded payable holder not already tried for it. */
function assignRemaining(manifest: Manifest, candidates: Map<number, string[]>, got: Map<number, Uint8Array>, tried: Set<string>): Map<string, number[]> {
  const load = new Map<string, number>();
  const out = new Map<string, number[]>();
  for (const p of manifest.parcels) {
    if (got.has(p.index)) continue;
    const pick = (candidates.get(p.index) ?? []).filter((u) => !tried.has(`${u}#${p.index}`)).sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
    if (!pick) continue;
    load.set(pick, (load.get(pick) ?? 0) + 1);
    out.set(pick, [...(out.get(pick) ?? []), p.index]);
  }
  return out;
}

/** Pull a whole file, paying each fount its own price per parcel, rerouting misses to other holders. */
export async function gatherPaid(opts: PaidGatherOptions): Promise<PaidGatherResult> {
  const { manifest, channelByFount, buyerSk } = opts;
  const priceFor = (url: string): number => opts.priceByFount?.[url] ?? opts.priceSompi;
  const candidates = candidatesFor(manifest, opts.holders, channelByFount);
  const perFount: PaidGatherResult['perFount'] = {};
  const got = new Map<number, Uint8Array>();
  const runningVouched: Record<string, number> = {}; // sompi vouched this gather so far, per fount
  const tried = new Set<string>(); // "url#index" already attempted

  for (;;) {
    const assignment = assignRemaining(manifest, candidates, got, tried);
    if (assignment.size === 0) break; // nothing left we can try
    const before = got.size;
    await Promise.all([...assignment.entries()].map(async ([url, indices]) => {
      for (const i of indices) tried.add(`${url}#${i}`);
      const previouslyVouched = (opts.vouchedByFount?.[url] ?? 0) + (runningVouched[url] ?? 0);
      const pulled = await paidPull({ fountUrl: url, manifest, indices, channel: channelByFount[url] as ChannelRef, buyerSk, priceSompi: priceFor(url), previouslyVouched });
      if (pulled.parcels.size === 0 || !pulled.voucher) return; // this fount gave nothing usable
      for (const [i, b] of pulled.parcels) got.set(i, b);
      runningVouched[url] = (runningVouched[url] ?? 0) + pulled.paidSompi;
      const e = perFount[url];
      perFount[url] = { parcels: (e?.parcels ?? 0) + pulled.parcels.size, sompi: (e?.sompi ?? 0) + pulled.paidSompi, voucher: pulled.voucher };
    }));
    if (got.size === before) break; // a whole pass added nothing -- give up, return what we have
  }

  const { bytes, complete } = assemble(manifest, got);
  return { bytes, complete, perFount };
}
