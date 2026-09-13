/**
 * Content addressing: a file is its chunk hashes, and nothing else.
 *
 * THIS IS THE WHOLE TRUST STORY FOR DELIVERY, and it is why delivery is verifiable where compute is
 * not. A file is split into fixed-size chunks; each chunk is named by its own hash; the file is named
 * by the hash of that list. Given the manifest, a delivered chunk is either the bytes it claims to be
 * -- it hashes to the name the manifest already holds -- or it is not, and there is no third option
 * and no one to trust. A node cannot serve junk and be believed, because the consumer checks every
 * chunk against a name it knew before it asked. (This is exactly how BitTorrent verifies pieces.)
 *
 * So a delivery swarm does NOT need [[quorum]]'s agreement-of-many, which exists for the harder case
 * where the correct answer is unknown in advance. Here the answer is known up front: the manifest is
 * the referee. quorum's bond and slash still matter -- for punishing a node that repeatedly serves
 * junk or lies about what it holds -- but the per-chunk check is just a hash.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_CHUNK = 64 * 1024;

export interface ChunkRef {
  index: number;
  hash: string;
  size: number;
}

export interface Manifest {
  /** content id: the hash of the chunk-hash list, so the manifest cannot be altered undetected */
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
  chunks: ChunkRef[];
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Split bytes into content-addressed chunks and name the whole by its chunk-hash list. */
export function buildManifest(name: string, bytes: Uint8Array, chunkSize = DEFAULT_CHUNK): Manifest {
  if (chunkSize < 1) throw new Error('chunkSize must be at least 1 byte');
  const chunks: ChunkRef[] = [];
  for (let i = 0, index = 0; i < bytes.length || (index === 0 && bytes.length === 0); i += chunkSize, index++) {
    const part = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push({ index, hash: sha(part), size: part.length });
    if (bytes.length === 0) break;
  }
  return { fileId: sha(Buffer.from(chunks.map((c) => c.hash).join(''))), name, size: bytes.length, chunkSize, chunks };
}

/** Does this chunk's bytes match the name the manifest already holds for that index? */
export function verifyChunk(manifest: Manifest, index: number, bytes: Uint8Array): boolean {
  const ref = manifest.chunks[index];
  return !!ref && ref.size === bytes.length && sha(bytes) === ref.hash;
}

/** Recompute a manifest's fileId from its chunk list -- a manifest whose id does not match is forged. */
export function manifestIsSound(manifest: Manifest): boolean {
  const id = sha(Buffer.from(manifest.chunks.map((c) => c.hash).join('')));
  return id === manifest.fileId;
}
