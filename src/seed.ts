/**
 * Publishing: seed a file across the Meridian by pushing its parcels to founts that accept content.
 *
 * A publisher content-addresses a file into a manifest and pushes each parcel to one or more founts
 * (verified against the manifest on arrival), then announces where it lives. After this the file is
 * available to gather from the crowd, not just from whoever happened to run a node over it. Who pays
 * a fount to KEEP holding it -- the retention economics -- is a layer on top of this and is not here.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildManifest, DEFAULT_PARCEL } from './manifest.js';
import { announceTo } from './tracker.js';

/** Push a file's parcels to each fount, and (optionally) announce it to a tracker. */
export async function seed(filePath: string, fountUrls: string[], trackerUrl?: string, parcelSize = DEFAULT_PARCEL): Promise<{ fileId: string; name: string; parcels: number }> {
  const bytes = new Uint8Array(readFileSync(filePath));
  const manifest = buildManifest(basename(filePath), bytes, parcelSize);
  for (const url of fountUrls) {
    for (const p of manifest.parcels) {
      const bytesB64 = Buffer.from(bytes.subarray(p.index * manifest.parcelSize, p.index * manifest.parcelSize + p.size)).toString('base64');
      const res = await fetch(`${url}/cascade/store`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest, index: p.index, bytesB64 }) });
      if (!res.ok) throw new Error(`${url} rejected parcel ${p.index}: ${res.status} ${await res.text()}`);
    }
    if (trackerUrl) await announceTo(trackerUrl, manifest.fileId, url, manifest.parcels.map((p) => p.index));
  }
  return { fileId: manifest.fileId, name: manifest.name, parcels: manifest.parcels.length };
}
