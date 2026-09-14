/**
 * A whole file, pulled across the Meridian and paid per parcel: one [[paidpull]] per fount, at once.
 *
 * The free pull ([[consumer]]) grabs parcels ad hoc from whoever answers. A PAID pull is tidier,
 * because payment is per channel and there is one channel per fount: assign every parcel to a fount
 * that holds it and that the gatherer has a channel with, then run a paidPull against each fount in
 * parallel. Each fount is paid, per parcel, only for what it served, and ends holding one final
 * voucher it can claim. Reassembly is the same as ever — the parcels carry their own index.
 *
 * This is the Meridian doing paid delivery end to end, off chain; the vouchers each fount collects are
 * what it later claims on the kaspa-x402 rail (proven live in tools/prove-live-meridian.ts).
 */
import type { Voucher, ChannelRef } from 'metered-protocol';
import type { Manifest } from './manifest.js';
import type { Holder } from './tracker.js';
import { paidPull } from './paidpull.js';

export interface PaidGatherOptions {
  manifest: Manifest;
  holders: Holder[];
  /** the channel the gatherer holds with each fount, by fount url */
  channelByFount: Record<string, ChannelRef>;
  buyerSk: string;
  priceSompi: number;
}

export interface PaidGatherResult {
  bytes: Uint8Array;
  complete: boolean;
  perFount: Record<string, { parcels: number; sompi: number; voucher: Voucher }>;
}

/** Give each parcel to one fount that holds it and that the gatherer can pay (least-loaded first). */
function assign(manifest: Manifest, holders: Holder[], channelByFount: Record<string, ChannelRef>): Map<string, number[]> {
  const byIndex = new Map<number, string[]>();
  for (const h of holders) {
    if (!channelByFount[h.url]) continue; // can't pay this fount -- skip it
    for (const i of h.indices) byIndex.set(i, [...(byIndex.get(i) ?? []), h.url]);
  }
  const perFount = new Map<string, number[]>();
  const usage = new Map<string, number>();
  for (const p of manifest.parcels) {
    const pick = (byIndex.get(p.index) ?? []).sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0))[0];
    if (!pick) continue; // no payable holder for this parcel
    usage.set(pick, (usage.get(pick) ?? 0) + 1);
    perFount.set(pick, [...(perFount.get(pick) ?? []), p.index]);
  }
  return perFount;
}

/** Pull a whole file across the Meridian, paying each fount per parcel over its own channel. */
export async function gatherPaid(opts: PaidGatherOptions): Promise<PaidGatherResult> {
  const { manifest, channelByFount, buyerSk, priceSompi } = opts;
  const assignment = assign(manifest, opts.holders, channelByFount);
  const perFount: PaidGatherResult['perFount'] = {};
  const got = new Map<number, Uint8Array>();

  await Promise.all([...assignment.entries()].map(async ([url, indices]) => {
    const pulled = await paidPull({ fountUrl: url, manifest, indices, channel: channelByFount[url] as ChannelRef, buyerSk, priceSompi });
    for (const [i, b] of pulled.parcels) got.set(i, b);
    perFount[url] = { parcels: pulled.parcels.size, sompi: pulled.paidSompi, voucher: pulled.voucher };
  }));

  const complete = got.size === manifest.parcels.length;
  const bytes = new Uint8Array(complete ? manifest.size : [...got.values()].reduce((n, b) => n + b.length, 0));
  if (complete) {
    let at = 0;
    for (const p of manifest.parcels) { bytes.set(got.get(p.index) as Uint8Array, at); at += p.size; }
  }
  return { bytes, complete, perFount };
}
