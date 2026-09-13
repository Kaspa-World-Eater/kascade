/**
 * Content addressing: a file is its parcel hashes, and nothing else.
 *
 * THIS IS THE WHOLE TRUST STORY FOR DELIVERY, and it is why delivery is verifiable where compute is
 * not. A file is split into fixed-size parcels; each parcel is named by its own hash; the file is named
 * by the hash of that list. Given the manifest, a delivered parcel is either the bytes it claims to be
 * -- it hashes to the name the manifest already holds -- or it is not, and there is no third option
 * and no one to trust. A node cannot serve junk and be believed, because the consumer checks every
 * parcel against a name it knew before it asked. (This is exactly how BitTorrent verifies pieces.)
 *
 * So a delivery meridian does NOT need [[quorum]]'s agreement-of-many, which exists for the harder case
 * where the correct answer is unknown in advance. Here the answer is known up front: the manifest is
 * the referee. quorum's bond and slash still matter -- for punishing a node that repeatedly serves
 * junk or lies about what it holds -- but the per-parcel check is just a hash.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_PARCEL = 64 * 1024;

export interface ParcelRef {
  index: number;
  hash: string;
  size: number;
}

export interface Manifest {
  /** content id: the hash of the parcel-hash list, so the manifest cannot be altered undetected */
  fileId: string;
  name: string;
  size: number;
  parcelSize: number;
  parcels: ParcelRef[];
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Split bytes into content-addressed parcels and name the whole by its parcel-hash list. */
export function buildManifest(name: string, bytes: Uint8Array, parcelSize = DEFAULT_PARCEL): Manifest {
  if (parcelSize < 1) throw new Error('parcelSize must be at least 1 byte');
  const parcels: ParcelRef[] = [];
  for (let i = 0, index = 0; i < bytes.length || (index === 0 && bytes.length === 0); i += parcelSize, index++) {
    const part = bytes.subarray(i, Math.min(i + parcelSize, bytes.length));
    parcels.push({ index, hash: sha(part), size: part.length });
    if (bytes.length === 0) break;
  }
  return { fileId: sha(Buffer.from(parcels.map((c) => c.hash).join(''))), name, size: bytes.length, parcelSize, parcels };
}

/** Does this parcel's bytes match the name the manifest already holds for that index? */
export function verifyParcel(manifest: Manifest, index: number, bytes: Uint8Array): boolean {
  const ref = manifest.parcels[index];
  return !!ref && ref.size === bytes.length && sha(bytes) === ref.hash;
}

/** Recompute a manifest's fileId from its parcel list -- a manifest whose id does not match is forged. */
export function manifestIsSound(manifest: Manifest): boolean {
  const id = sha(Buffer.from(manifest.parcels.map((c) => c.hash).join('')));
  return id === manifest.fileId;
}
