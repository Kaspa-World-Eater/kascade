/**
 * Publisher-pays settlement: the market the site describes, made real in code.
 *
 * The viewer gathers a file for free, signing a [[receipt]] per verified parcel. The publisher funds a
 * budget. This turns the receipts into who-the-publisher-owes, and settles against the budget: an
 * honest fount is paid for the parcels it verifiably delivered, a fount that only served junk earns
 * nothing, a claim below the dust floor is held (KIP-9), and nothing is ever charged to the viewer.
 *
 * `settlePublisherPays` follows the shape the external review (STP-KAS) proposed, so its follow-up
 * test suite and this one describe the same behaviour. `tallyReceipts` is the trust gate in front of
 * it: a receipt counts only if it verifies for the viewer, names a real parcel of this manifest at its
 * true size, and is the first time that (fount, parcel) has been seen.
 */
import type { Manifest } from './manifest.js';
import { verifyReceipt, type Receipt } from './receipt.js';

/** Roughly the smallest payout that clears Kaspa's KIP-9 storage-mass floor; below it a claim is held. */
export const DUST_SOMPI = 2_600_000;

export interface FountTally { parcels: number; bytes: number; sompi: number }

export interface PublisherSettlement {
  pay: { url: string; sompi: number }[];
  unpaidLiar: string[];
  belowDust: { url: string; sompi: number }[];
  overBudget: { url: string; sompi: number }[];
  remaining: number;
  viewerPaidSompi: 0;
}

/** Verify and count viewer receipts into per-fount tallies. Rejected receipts (forged, wrong file,
 *  wrong size, duplicate (fount,parcel)) are counted, not trusted. */
export function tallyReceipts(manifest: Manifest, receipts: Receipt[], viewerPubkey: string, priceSompi: number): { perFount: Record<string, FountTally>; rejected: number } {
  const sizeOf = new Map(manifest.parcels.map((p) => [p.index, p.size]));
  const seen = new Set<string>();
  const perFount: Record<string, FountTally> = {};
  let rejected = 0;
  for (const r of receipts) {
    const size = sizeOf.get(r.index);
    const key = `${r.fountUrl}#${r.index}`;
    if (r.fileId !== manifest.fileId || size === undefined || r.bytes !== size || seen.has(key) || !verifyReceipt(r, viewerPubkey)) {
      rejected += 1;
      continue;
    }
    seen.add(key);
    const t = perFount[r.fountUrl] ?? { parcels: 0, bytes: 0, sompi: 0 };
    t.parcels += 1;
    t.bytes += size;
    t.sompi += size * priceSompi;
    perFount[r.fountUrl] = t;
  }
  return { perFount, rejected };
}

/** Settle the publisher's budget across founts. Viewer pays nothing; the budget is the only money. */
export function settlePublisherPays(opts: { budgetSompi: number; perFount: Record<string, FountTally>; faults: { url: string }[]; dustSompi?: number }): PublisherSettlement {
  const dust = opts.dustSompi ?? DUST_SOMPI;
  const faulted = new Set(opts.faults.map((f) => f.url));
  const pay: PublisherSettlement['pay'] = [];
  const unpaidLiar: string[] = [];
  const belowDust: PublisherSettlement['belowDust'] = [];
  const overBudget: PublisherSettlement['overBudget'] = [];
  let remaining = opts.budgetSompi;

  for (const url of [...new Set([...Object.keys(opts.perFount), ...faulted])]) {
    const earned = opts.perFount[url]?.sompi ?? 0;
    if (earned <= 0) {
      if (faulted.has(url)) unpaidLiar.push(url);
      continue;
    }
    if (earned < dust) { belowDust.push({ url, sompi: earned }); continue; }
    if (earned > remaining) { overBudget.push({ url, sompi: earned }); continue; }
    pay.push({ url, sompi: earned });
    remaining -= earned;
  }
  return { pay, unpaidLiar, belowDust, overBudget, remaining, viewerPaidSompi: 0 };
}
