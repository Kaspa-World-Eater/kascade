/**
 * A viewer gathering a file for FREE, signing a [[receipt]] for each verified parcel.
 *
 * This is the publisher-pays hot path from the viewer's side. Founts serve parcels without charging
 * the viewer; in return the viewer signs a receipt naming the fount and the parcel it verified. The
 * founts later claim those receipts against the publisher's budget ([[publisherpays]]). A parcel that
 * fails the manifest is recorded as a fault and earns no receipt — junk is caught here, for free, the
 * same way the paid path catches it. The viewer never signs a money voucher and never pays.
 *
 * (Hardening left for the next slice: a fount withholding the next parcel until the previous receipt
 * arrives — the receipt equivalent of the per-parcel credit bound the paid path already enforces.)
 */
import { verifyParcel, type Manifest } from './manifest.js';
import { assemble } from './assemble.js';
import { signReceipt, type Receipt } from './receipt.js';
import type { Holder } from './tracker.js';

export interface ReceiptGather {
  bytes: Uint8Array;
  complete: boolean;
  receipts: Receipt[];
  faults: { url: string; index: number }[];
}

async function fetchParcel(url: string, fileId: string, index: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${url}/kascade/parcel?file=${fileId}&i=${index}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Pull each parcel from a holder that has it, verify, and sign a receipt for the fount that served it. */
export async function gatherWithReceipts(opts: { manifest: Manifest; holders: Holder[]; viewerSk: string }): Promise<ReceiptGather> {
  const { manifest, holders, viewerSk } = opts;
  const byIndex = new Map<number, string[]>();
  for (const h of holders) for (const i of h.indices) byIndex.set(i, [...(byIndex.get(i) ?? []), h.url]);

  const got = new Map<number, Uint8Array>();
  const receipts: Receipt[] = [];
  const faults: { url: string; index: number }[] = [];

  for (const p of manifest.parcels) {
    for (const url of byIndex.get(p.index) ?? []) {
      const bytes = await fetchParcel(url, manifest.fileId, p.index);
      if (!bytes) continue;
      if (!verifyParcel(manifest, p.index, bytes)) { faults.push({ url, index: p.index }); continue; }
      got.set(p.index, bytes);
      receipts.push(signReceipt(viewerSk, { fileId: manifest.fileId, index: p.index, bytes: bytes.length, fountUrl: url }));
      break; // a good copy is enough; move to the next parcel
    }
  }

  const { bytes, complete } = assemble(manifest, got);
  return { bytes, complete, receipts, faults };
}
