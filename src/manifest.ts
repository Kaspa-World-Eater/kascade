/**
 * Content addressing: a file is its babel hashes, and nothing else.
 *
 * THIS IS THE WHOLE TRUST STORY FOR DELIVERY, and it is why delivery is verifiable where compute is
 * not. A file is split into fixed-size babels; each babel is named by its own hash; the file is named
 * by the hash of that list. Given the manifest, a delivered babel is either the bytes it claims to be
 * -- it hashes to the name the manifest already holds -- or it is not, and there is no third option
 * and no one to trust. A node cannot serve junk and be believed, because the consumer checks every
 * babel against a name it knew before it asked. (This is exactly how BitTorrent verifies pieces.)
 *
 * So a delivery meridian does NOT need [[quorum]]'s agreement-of-many, which exists for the harder case
 * where the correct answer is unknown in advance. Here the answer is known up front: the manifest is
 * the referee. quorum's bond and slash still matter -- for punishing a node that repeatedly serves
 * junk or lies about what it holds -- but the per-babel check is just a hash.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_BABEL = 64 * 1024;

export interface BabelRef {
  index: number;
  hash: string;
  size: number;
}

export interface Manifest {
  /** content id: the hash of the babel-hash list, so the manifest cannot be altered undetected */
  fileId: string;
  name: string;
  size: number;
  babelSize: number;
  babels: BabelRef[];
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Split bytes into content-addressed babels and name the whole by its babel-hash list. */
export function buildManifest(name: string, bytes: Uint8Array, babelSize = DEFAULT_BABEL): Manifest {
  if (babelSize < 1) throw new Error('babelSize must be at least 1 byte');
  const babels: BabelRef[] = [];
  for (let i = 0, index = 0; i < bytes.length || (index === 0 && bytes.length === 0); i += babelSize, index++) {
    const part = bytes.subarray(i, Math.min(i + babelSize, bytes.length));
    babels.push({ index, hash: sha(part), size: part.length });
    if (bytes.length === 0) break;
  }
  return { fileId: sha(Buffer.from(babels.map((c) => c.hash).join(''))), name, size: bytes.length, babelSize, babels };
}

/** Does this babel's bytes match the name the manifest already holds for that index? */
export function verifyBabel(manifest: Manifest, index: number, bytes: Uint8Array): boolean {
  const ref = manifest.babels[index];
  return !!ref && ref.size === bytes.length && sha(bytes) === ref.hash;
}

/** Recompute a manifest's fileId from its babel list -- a manifest whose id does not match is forged. */
export function manifestIsSound(manifest: Manifest): boolean {
  const id = sha(Buffer.from(manifest.babels.map((c) => c.hash).join('')));
  return id === manifest.fileId;
}
