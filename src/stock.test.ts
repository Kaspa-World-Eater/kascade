/**
 * A fount holds only what fits its budget, pinned FIRST (test-driven): stocking more than the cap
 * keeps what fits and drops the rest, and everything a fount ends up serving still verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stock } from './stock.js';
import { verifyParcel } from './manifest.js';

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);

test('a file within budget is stocked whole', () => {
  const { held, cache } = stock([{ name: 'a.bin', bytes: bytes(500) }], 10_000, 100);
  assert.equal(held.length, 1);
  assert.equal(held[0]?.parcels.size, held[0]?.manifest.parcels.length, 'every parcel is held');
  assert.equal(cache.usedBytes(), 500);
});

test('over budget, only what fits is stocked — and every stocked parcel still verifies', () => {
  const files = [{ name: 'a.bin', bytes: bytes(500, 1) }, { name: 'b.bin', bytes: bytes(500, 9) }];
  const { held, cache } = stock(files, 600, 100); // 10 parcels of 100B exist; only 6 fit
  assert.ok(cache.usedBytes() <= 600, 'never exceeds the cap');
  const totalHeld = held.reduce((n, h) => n + h.parcels.size, 0);
  assert.ok(totalHeld > 0 && totalHeld < 10, `holds a bounded subset, got ${totalHeld}`);
  for (const h of held) for (const [i, b] of h.parcels) assert.equal(verifyParcel(h.manifest, i, b), true, 'served parcels are real');
});

test('a parcel larger than the whole budget is skipped, not fatal', () => {
  const { held } = stock([{ name: 'big.bin', bytes: bytes(2000) }], 1000, 64 * 1024); // one 2000B parcel > 1000 cap
  assert.deepEqual(held, [], 'nothing stockable, but no crash');
});
