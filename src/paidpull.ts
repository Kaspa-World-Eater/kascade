/**
 * Pulling a set of parcels from one fount, paying per parcel as they arrive.
 *
 * This is the gatherer's half of the per-parcel 402 handshake. For each parcel it sends the voucher
 * covering everything received so far, pulls the next one, VERIFIES it against the manifest, and only
 * then signs a new voucher that includes it. So the gatherer never signs for a parcel it has not seen
 * and checked, and the fount never hands over more than one parcel before it is paid (see [[creditline]]
 * and the fount's gate). A final voucher settles the last parcel, which no further request would carry.
 *
 * It STOPS rather than throws when a fount refuses or serves junk: it returns the parcels it did verify
 * and the voucher covering them, so the caller ([[paidgather]]) can fetch what is missing from another
 * fount. A fount that serves junk is charged for it by its own gate but never vouched, so it cuts
 * itself off after one bad parcel -- abandoning it and rerouting is exactly the right move.
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
  /**
   * The lifetime ceiling already vouched on this channel before this pull. A voucher's amount is a
   * cumulative figure for the CHANNEL, and a channel outlives one gather, so a second pull must
   * continue from where the last left off -- signing from zero would try to lower the ceiling, and
   * the fount rejects that. Zero (the default) is a fresh channel.
   */
  previouslyVouched?: number;
}

const sign = (cumulativeSompi: number, channel: ChannelRef, buyerSk: string, previouslyVouched: number): Voucher =>
  voucherForState({ cumulativeSompi } as unknown as Parameters<typeof voucherForState>[0], channel, buyerSk, previouslyVouched);

/** Pull `indices` from one credit-enforcing fount, paying per parcel; returns the parcels VERIFIED and
 *  the final voucher covering them (null if none verified). Stops early on a refusal or a bad parcel. */
export async function paidPull(opts: PaidPullOptions): Promise<{ parcels: Map<number, Uint8Array>; voucher: Voucher | null; paidSompi: number }> {
  const { fountUrl, manifest, channel, buyerSk, priceSompi, previouslyVouched = 0 } = opts;
  const parcels = new Map<number, Uint8Array>();
  let paidSompi = 0;
  let voucher: Voucher | null = null; // covers everything received so far; carried on the NEXT request

  for (const index of opts.indices) {
    const headers: Record<string, string> = voucher ? { 'x-voucher': JSON.stringify(voucher) } : {};
    const res = await fetch(`${fountUrl}/kascade/parcel?file=${manifest.fileId}&i=${index}&channel=${channel.covenantId}`, { headers });
    if (!res.ok) break; // refused (or cut off) -- keep what we verified, let the caller reroute the rest
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!verifyParcel(manifest, index, bytes)) break; // junk: this fount is now cut off; abandon it
    parcels.set(index, bytes);
    paidSompi += bytes.length * priceSompi;
    voucher = sign(paidSompi, channel, buyerSk, previouslyVouched);
  }
  if (!voucher) return { parcels, voucher: null, paidSompi: 0 }; // nothing verified from this fount

  // Settle the last parcel: send the final voucher, which no further parcel request would carry.
  // Non-fatal -- the bytes are already in hand; a failed settle costs the fount the last parcel's pay.
  await fetch(`${fountUrl}/kascade/voucher?channel=${channel.covenantId}`, { headers: { 'x-voucher': JSON.stringify(voucher) } }).catch(() => undefined);
  return { parcels, voucher, paidSompi };
}
