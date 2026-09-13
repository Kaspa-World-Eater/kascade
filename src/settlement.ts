/**
 * A meridian receipt becomes money on the rail: pay each fount for what it delivered, on its own
 * channel, and flag the ones that served junk to be slashed.
 *
 * cascade accrues earnings PER FOUNT as it downloads -- because in a meridian the file came from many
 * sellers, and each is owed only for the babels it actually served and that verified. This turns that
 * tally into three lists a caller can act on: who to pay (and on which channel), who to slash (and how
 * badly), and who earned but left nowhere to pay them. It stays pure -- it decides, it moves nothing --
 * so the amounts can be shown and checked before a voucher is signed. The rail itself is spigot's:
 * one kaspa-x402 channel per fount, one voucher for its earned total.
 */
import type { Receipt } from './consumer.js';

export interface MeridianSettlement {
  pay: { url: string; sompi: number; channel: string }[];
  slash: { url: string; faults: number }[];
  unsettleable: { url: string; sompi: number; reason: string }[];
  totalPaidSompi: number;
}

/** Decide the per-fount settlement from a completed (or stopped) fetch. */
export function settlementFor(receipt: Receipt, channelByFount: Record<string, string>): MeridianSettlement {
  const pay: MeridianSettlement['pay'] = [];
  const unsettleable: MeridianSettlement['unsettleable'] = [];
  let totalPaidSompi = 0;

  for (const [url, tally] of Object.entries(receipt.perFount)) {
    const channel = channelByFount[url];
    if (channel) {
      pay.push({ url, sompi: tally.sompi, channel });
      totalPaidSompi += tally.sompi;
    } else {
      unsettleable.push({ url, sompi: tally.sompi, reason: 'no channel with this fount' });
    }
  }

  const faultCount = new Map<string, number>();
  for (const f of receipt.faults) faultCount.set(f.url, (faultCount.get(f.url) ?? 0) + 1);
  const slash = [...faultCount.entries()].map(([url, faults]) => ({ url, faults }));

  return { pay, slash, unsettleable, totalPaidSompi };
}
