/**
 * The publish flow: a fount that opts in accepts content PUSHED to it (up to a byte budget), verifies
 * each parcel against the manifest before holding it, and then serves it like anything else. This is
 * how a publisher seeds a file across the Meridian instead of running the only node that has it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildManifest } from './manifest.js';
import { fount } from './fount.js';
import { fetchFile } from './consumer.js';

const file = Uint8Array.from({ length: 350 }, (_, i) => (i * 9 + 2) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

async function push(url: string, manifest: ReturnType<typeof buildManifest>, index: number, bytes: Uint8Array): Promise<number> {
  const res = await fetch(`${url}/kascade/store`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest, index, bytesB64: Buffer.from(bytes).toString('base64') }),
  });
  return res.status;
}

test('an accepting fount takes pushed parcels, verifies them, and serves the file', async () => {
  const m = buildManifest('doc.pdf', file, 100); // 4 parcels
  const f = fount({ held: [], priceSompi: 1, acceptBytes: 1_000_000 });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    for (const p of m.parcels) {
      const ok = await push(url, m, p.index, file.subarray(p.index * 100, p.index * 100 + p.size));
      assert.equal(ok, 200, `parcel ${p.index} accepted`);
    }
    const holders = [{ url, indices: m.parcels.map((p) => p.index) }];
    const { bytes, receipt } = await fetchFile({ manifest: m, holders, priceSompi: 1 });
    assert.equal(receipt.complete, true);
    assert.deepEqual(bytes, file, 'the seeded file serves byte-for-byte');
  } finally { await close(f.server); }
});

test('a fount that has not opted in refuses pushed content', async () => {
  const m = buildManifest('doc.pdf', file, 100);
  const f = fount({ held: [], priceSompi: 1 }); // no acceptBytes
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    assert.equal(await push(url, m, 0, file.subarray(0, 100)), 404, 'store is off unless opted in');
  } finally { await close(f.server); }
});

test('a corrupted pushed parcel is rejected, not held', async () => {
  const m = buildManifest('doc.pdf', file, 100);
  const f = fount({ held: [], priceSompi: 1, acceptBytes: 1_000_000 });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    const junk = Uint8Array.from(file.subarray(0, 100)); junk[0] = (junk[0] ?? 0) ^ 0xff;
    assert.equal(await push(url, m, 0, junk), 422, 'does not match the manifest -- refused');
  } finally { await close(f.server); }
});
