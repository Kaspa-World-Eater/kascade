/**
 * The live proof, pinned: the whole Meridian in one process delivers byte-identical and catches the
 * liar. If this ever goes red, `kascade demo` is lying, and the project's central claim is broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDemo } from './demo.js';

test('the live Meridian delivers byte-identical, pays per fount, and catches the liar', async () => {
  const d = await runDemo();
  assert.equal(d.byteIdentical, true, 'the file came back exactly as it went out');
  assert.deepEqual(d.faults.map((f) => f.index).sort((a, b) => a - b), [2, 6], 'the liar was caught on its two parcels');
  assert.equal(d.faults.every((f) => f.fount === 'fount-LIAR'), true, 'only the liar faulted');
  assert.equal(d.earnings.some((e) => e.fount === 'fount-LIAR'), false, 'the liar earned nothing — junk never bills');
  assert.equal(d.totalPaidSompi, 8 * 64 * 1024 * 2, 'the whole file, once, at the price');
  assert.equal(d.settlement.pay.length, 3, 'the three honest founts are paid');
  assert.deepEqual(d.settlement.faulted, [{ url: 'fount-LIAR', faults: 2 }], 'the liar is faulted, not paid');
});
