/**
 * The fix for an external review finding: an incomplete gather returned a zero-filled buffer while
 * its receipt honestly said "incomplete". A buffer that lies is worse than a short one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from './manifest.js';
import { assemble } from './assemble.js';

test('an incomplete gather returns the parcels it actually has, never a zero buffer', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i % 251) + 1); // no zero bytes anywhere
  const m = buildManifest('f.bin', bytes, 100); // 3 parcels
  const got = new Map([[0, bytes.subarray(0, 100)], [2, bytes.subarray(200, 300)]]); // parcel 1 missing
  const r = assemble(m, got);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, [1]);
  assert.equal(r.bytes.length, 200, 'only the two parcels that arrived');
  assert.ok(r.bytes.every((b) => b !== 0), 'real bytes, not a zero buffer');
});

test('a complete gather reassembles byte-identical at full size', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 1) % 251);
  const m = buildManifest('f.bin', bytes, 100);
  const got = new Map(m.parcels.map((p) => [p.index, bytes.subarray(p.index * 100, p.index * 100 + p.size)]));
  const r = assemble(m, got);
  assert.equal(r.complete, true);
  assert.deepEqual(r.bytes, bytes);
});
