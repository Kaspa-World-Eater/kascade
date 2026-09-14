/**
 * The publish flow end to end, in process: write a real file, seed it to an accepting fount, and
 * gather it back byte-identical -- proving `seed` pushes, the fount holds, and delivery serves it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fount } from './fount.js';
import { fetchFile } from './consumer.js';
import { seed } from './seed.js';

test('seed pushes a file to an accepting fount, and it gathers back byte-identical', async () => {
  const original = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 3 + 1) % 251);
  const tmp = join(tmpdir(), `kascade-seed-${Date.now()}.bin`);
  writeFileSync(tmp, Buffer.from(original));
  const f = fount({ held: [], priceSompi: 1, acceptBytes: 1_000_000 });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    const r = await seed(tmp, [url]); // default 64 KB parcels -> 4 parcels
    assert.ok(r.parcels >= 3, 'split into parcels');
    const manifest = await (await fetch(`${url}/kascade/manifest?file=${r.fileId}`)).json();
    const have = (await (await fetch(`${url}/kascade/have`)).json()) as { fileId: string; indices: number[] }[];
    const indices = have.find((h) => h.fileId === r.fileId)?.indices ?? [];
    const { bytes, receipt } = await fetchFile({ manifest, holders: [{ url, indices }], priceSompi: 1 });
    assert.equal(receipt.complete, true, 'the seeded fount serves the whole file');
    assert.deepEqual(bytes, original, 'byte-identical after a round trip through publish + gather');
  } finally {
    await new Promise<void>((r) => f.server.close(() => r()));
    rmSync(tmp, { force: true });
  }
});
