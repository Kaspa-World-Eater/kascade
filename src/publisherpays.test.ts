/**
 * Publisher-pays: the viewer gathers for free and signs receipts; the publisher's budget is the only
 * money that moves. These pin the trust gate (which receipts count) and the settlement (who the
 * publisher owes), including the same properties the external review's follow-up suite describes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { signReceipt } from './receipt.js';
import { tallyReceipts, settlePublisherPays, DUST_SOMPI } from './publisherpays.js';

const viewerSk = 'a1'.repeat(32);
const viewerPk = publicKeyHex(viewerSk);
const file = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 1) % 251);
const m = buildManifest('clip.bin', file, 100); // 3 parcels of 100
const receiptFor = (index: number, fountUrl: string, sk = viewerSk) =>
  signReceipt(sk, { fileId: m.fileId, index, bytes: m.parcels[index]!.size, fountUrl });

test('only receipts that verify, name a real parcel, and are unique per (fount,parcel) count', () => {
  const receipts = [
    receiptFor(0, 'http://a'),
    receiptFor(1, 'http://a'),
    receiptFor(0, 'http://a'), // duplicate (fount,parcel) -> ignored
    receiptFor(2, 'http://b', 'b2'.repeat(32)), // forged: signed by someone else
    { fileId: m.fileId, index: 9, bytes: 100, fountUrl: 'http://a', signature: 'deadbeef' }, // no such parcel
  ];
  const { perFount, rejected } = tallyReceipts(m, receipts, viewerPk, 2);
  assert.equal(perFount['http://a']?.parcels, 2, 'two distinct verified parcels from a');
  assert.equal(perFount['http://a']?.sompi, 200 * 2, '2 sompi/byte over 200 bytes');
  assert.equal(perFount['http://b'], undefined, 'the forged receipt bought b nothing');
  assert.equal(rejected, 3, 'duplicate + forged + non-existent parcel');
});

test('the publisher budget is the only money that moves; the viewer pays zero', () => {
  const perFount = { 'http://a': { parcels: 2, bytes: 200_000, sompi: 4_000_000 }, 'http://b': { parcels: 1, bytes: 150_000, sompi: 3_000_000 } };
  const s = settlePublisherPays({ budgetSompi: 8_000_000, perFount, faults: [] });
  assert.equal(s.viewerPaidSompi, 0);
  assert.equal(s.pay.length, 2);
  assert.equal(s.remaining, 1_000_000);
});

test('an over-budget fount is held, not paid from the viewer', () => {
  const s = settlePublisherPays({ budgetSompi: 3_000_000, perFount: { 'http://a': { parcels: 2, bytes: 200_000, sompi: 4_000_000 } }, faults: [] });
  assert.deepEqual(s.pay, []);
  assert.deepEqual(s.overBudget, [{ url: 'http://a', sompi: 4_000_000 }]);
  assert.equal(s.remaining, 3_000_000);
});

test('a liar that produced no verified parcel is listed unpaid; a below-dust earner is held', () => {
  const perFount = { 'http://honest': { parcels: 40, bytes: 1_400_000, sompi: 2_800_000 }, 'http://small': { parcels: 1, bytes: 1000, sompi: 2_000 } };
  const s = settlePublisherPays({ budgetSompi: 10_000_000, perFount, faults: [{ url: 'http://liar' }] });
  assert.deepEqual(s.pay, [{ url: 'http://honest', sompi: 2_800_000 }]);
  assert.deepEqual(s.unpaidLiar, ['http://liar']);
  assert.deepEqual(s.belowDust, [{ url: 'http://small', sompi: 2_000 }]);
});

test('the dust floor matches the KIP-9 constraint kascade documents', () => {
  assert.equal(DUST_SOMPI, 2_600_000);
});
