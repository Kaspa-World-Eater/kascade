/**
 * A publisher's authorization for a viewer — the honest answer to publisher-pays collusion.
 *
 * A receipt proves a viewer verified a parcel, but not that the viewer is a real, distinct person; a
 * fount and a fake viewer can mint receipts against a budget (see docs/publisher-pays-collusion.md).
 * This closes that in the case that actually pays — a publisher delivering ITS content to ITS users —
 * by having the publisher sign a short-lived token binding a viewer key to a file. A fount that
 * requires authorization earns a receipt only from a token-bearing viewer, and the publisher settles
 * only receipts from tokens it issued. Collusion would then require the publisher to collude against
 * its own budget, which is nonsensical. It does NOT help the open mesh where the publisher does not
 * know its viewers — that stays a stake-and-detect problem.
 */
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface AuthToken {
  viewerPubkey: string;
  fileId: string;
  expiry: number; // ms epoch after which the token is dead
  signature: string;
}

const digest = (t: Omit<AuthToken, 'signature'>): Uint8Array =>
  sha256(utf8ToBytes(`kascade-auth:v1|${t.viewerPubkey}|${t.fileId}|${t.expiry}`));

/** The publisher signs, authorizing this viewer to be served this file until `expiry`. */
export function signAuthToken(publisherSk: string, t: Omit<AuthToken, 'signature'>): AuthToken {
  return { ...t, signature: bytesToHex(schnorr.sign(digest(t), hexToBytes(publisherSk))) };
}

/** Does this token authorize this viewer for this file, signed by this publisher, still in date? */
export function verifyAuthToken(token: AuthToken, publisherPubkey: string, viewerPubkey: string, fileId: string, now = Date.now()): boolean {
  try {
    if (token.viewerPubkey !== viewerPubkey || token.fileId !== fileId || token.expiry <= now) return false;
    return schnorr.verify(hexToBytes(token.signature), digest(token), hexToBytes(publisherPubkey));
  } catch {
    return false;
  }
}

/** The fount's gate: true if no publisher is set (auth not required), else the header must be a valid token. */
export function authOk(publisherPubkey: string | undefined, header: string | undefined, viewerPubkey: string, fileId: string, now = Date.now()): boolean {
  if (!publisherPubkey) return true;
  if (!header) return false;
  try {
    return verifyAuthToken(JSON.parse(header) as AuthToken, publisherPubkey, viewerPubkey, fileId, now);
  } catch {
    return false;
  }
}
