/**
 * A receipt: the viewer's signed proof that a fount delivered a verified parcel.
 *
 * This is the heart of PUBLISHER-PAYS. In viewer-pays, the viewer signs money vouchers against its own
 * channel. Here the viewer spends nothing — it signs a *receipt* that says "fount F handed me parcel i
 * of file X, and it verified." A fount collects these and claims against the PUBLISHER's budget, not
 * the viewer's wallet. A receipt is only ever signed after the parcel has passed the manifest, so a
 * fount cannot earn one for junk.
 *
 * HONEST LIMIT (the open problem, named): a receipt proves the viewer *says* it received the parcel.
 * It does not prove the viewer is a real, distinct person. A fount colluding with a fake viewer can
 * sign receipts for parcels it never truly served to a real consumer and drain a budget. Covenants and
 * signatures cannot tell a real viewer from a sock puppet; that is a reputation/sybil problem, not one
 * this file solves. What it does solve: no payment for a parcel that fails its hash, no double-count of
 * the same (fount, parcel), and the viewer never pays.
 */
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface Receipt {
  fileId: string;
  index: number;
  bytes: number;
  fountUrl: string;
  signature: string;
}

const digest = (r: Omit<Receipt, 'signature'>): Uint8Array =>
  sha256(utf8ToBytes(`kascade-receipt:v1|${r.fileId}|${r.index}|${r.bytes}|${r.fountUrl}`));

/** The viewer signs, with the same BIP340 key that is its wallet, after verifying the parcel. */
export function signReceipt(viewerSk: string, r: Omit<Receipt, 'signature'>): Receipt {
  return { ...r, signature: bytesToHex(schnorr.sign(digest(r), hexToBytes(viewerSk))) };
}

/** Does this receipt verify for the named viewer? Any tampered field breaks the signature. */
export function verifyReceipt(r: Receipt, viewerPubkey: string): boolean {
  try {
    return schnorr.verify(hexToBytes(r.signature), digest(r), hexToBytes(viewerPubkey));
  } catch {
    return false;
  }
}
