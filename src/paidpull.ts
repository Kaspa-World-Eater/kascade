/**
 * Pulling a set of parcels from one fount, paying per parcel as they arrive.
 *
 * This is the gatherer's half of the per-parcel 402 handshake. For each parcel it sends the voucher
 * covering everything received so far, pulls the next one, VERIFIES it against the manifest, and only
 * then signs a new voucher that includes it. So the gatherer never signs for a parcel it has not seen
 * and checked, and the fount never hands over more than one parcel before it is paid (see [[creditline]]
 * and the fount's gate). A final voucher settles the last parcel, which no further request would carry.
 *
 * A whole file is pulled by running one of these against each fount that holds part of it — the Meridian
 * is many of these at once, one channel per fount, exactly as the free pull is many plain requests.
 */
import { voucherForState, type Voucher, type ChannelRef } from 'metered-protocol';
import { verifyParcel, type Manifest } from './manifest.js';

export interface PaidPullOptions {
  fountUrl: string;
  manifest: Manifest;
  indices: number[];
  channel: ChannelRef;
  buyerSk: string;
  priceSompi: number;
}

const sign = (cumulativeSompi: number, channel: ChannelRef, buyerSk: string): Voucher =>
  voucherForState({ cumulativeSompi } as unknown as Parameters<typeof voucherForState>[0], channel, buyerSk);

/** Pull `indices` from one credit-enforcing fount, paying per parcel; returns the parcels and the final voucher. */
export async function paidPull(opts: PaidPullOptions): Promise<{ parcels: Map<number, Uint8Array>; voucher: Voucher; paidSompi: number }> {
  const { fountUrl, manifest, channel, buyerSk, priceSompi } = opts;
  const parcels = new Map<number, Uint8Array>();
  let paidSompi = 0;
  let voucher: Voucher | undefined; // covers everything received so far; carried on the NEXT request

  for (const index of opts.indices) {
    const headers: Record<string, string> = voucher ? { 'x-voucher': JSON.stringify(voucher) } : {};
    const res = await fetch(`${fountUrl}/cascade/parcel?file=${manifest.fileId}&i=${index}&channel=${channel.covenantId}`, { headers });
    if (!res.ok) throw new Error(`fount refused parcel ${index}: ${res.status} ${await res.text()}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!verifyParcel(manifest, index, bytes)) throw new Error(`parcel ${index} failed the manifest -- not paid`);
    parcels.set(index, bytes);
    paidSompi += bytes.length * priceSompi;
    voucher = sign(paidSompi, channel, buyerSk);
  }
  if (!voucher) throw new Error('no parcels requested');

  // Settle the last parcel: send the final voucher, which no further parcel request would carry.
  const settle = await fetch(`${fountUrl}/cascade/voucher?channel=${channel.covenantId}`, { headers: { 'x-voucher': JSON.stringify(voucher) } });
  if (!settle.ok) throw new Error(`fount rejected the final voucher: ${settle.status}`);
  return { parcels, voucher, paidSompi };
}
