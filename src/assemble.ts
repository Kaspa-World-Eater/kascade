/**
 * Turning the parcels a gather actually collected into bytes — honestly, whether or not it finished.
 *
 * The subtle bug this fixes: an INCOMPLETE gather must not hand back a buffer of zeros. Callers used
 * to size a buffer to the bytes received but only fill it when the file was complete, so a partial
 * download returned zeros with an "incomplete" receipt — a buffer that lies. Here the parcels we hold
 * are always placed, in index order; a complete gather fills the whole file, and an incomplete one
 * returns exactly the bytes that arrived (packed in order) plus the list of what is missing.
 */
import type { Manifest } from './manifest.js';

export function assemble(manifest: Manifest, got: Map<number, Uint8Array>): { bytes: Uint8Array; complete: boolean; missing: number[] } {
  const missing = manifest.parcels.filter((p) => !got.has(p.index)).map((p) => p.index);
  const complete = missing.length === 0;
  const size = complete ? manifest.size : manifest.parcels.reduce((n, p) => n + (got.get(p.index)?.length ?? 0), 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of manifest.parcels) {
    const part = got.get(p.index);
    if (!part) continue;
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, complete, missing };
}
