/**
 * The publisher-pays credit bound: a free-serving fount extends at most ONE parcel before it needs a
 * receipt, and only accepts receipts that verify, name a parcel it delivered, and belong to it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicKeyHex } from 'metered-protocol';
import { signReceipt } from './receipt.js';
import { ReceiptLine, ReceiptRejected } from './receiptline.js';

const viewerSk = 'a1'.repeat(32);
const viewerPk = publicKeyHex(viewerSk);
const FILE = 'f'.repeat(64);
const URL = 'http://fount-a';
const receipt = (index: number, sk = viewerSk, fount = URL, file = FILE) =>
  signReceipt(sk, { fileId: file, index, bytes: 100, fountUrl: fount });

test('a fresh line may serve; after one parcel it must stop until a receipt arrives', () => {
  const line = new ReceiptLine(viewerPk, FILE, URL);
  assert.equal(line.mayServe(), true);
  line.served(0);
  assert.equal(line.outstanding(), 1);
  assert.equal(line.mayServe(), false, 'one un-receipted parcel outstanding');
  line.recordReceipt(receipt(0));
  assert.equal(line.mayServe(), true, 'receipt acknowledged — credit restored');
});

test('exposure never exceeds one parcel across a whole exchange', () => {
  const line = new ReceiptLine(viewerPk, FILE, URL);
  for (let n = 0; n < 5; n++) {
    assert.ok(line.outstanding() <= 1);
    line.served(n);
    assert.equal(line.mayServe(), false);
    line.recordReceipt(receipt(n));
    assert.equal(line.mayServe(), true);
  }
});

test('a receipt for a parcel that was not delivered here is refused', () => {
  const line = new ReceiptLine(viewerPk, FILE, URL);
  line.served(0);
  assert.throws(() => line.recordReceipt(receipt(5)), ReceiptRejected);
  assert.equal(line.mayServe(), false);
});

test('a receipt signed by the wrong key, or for another fount/file, is refused', () => {
  const line = new ReceiptLine(viewerPk, FILE, URL);
  line.served(0);
  assert.throws(() => line.recordReceipt(receipt(0, 'b2'.repeat(32))), ReceiptRejected, 'wrong key');
  assert.throws(() => line.recordReceipt(receipt(0, viewerSk, 'http://other')), ReceiptRejected, 'wrong fount');
  assert.throws(() => line.recordReceipt(receipt(0, viewerSk, URL, 'e'.repeat(64))), ReceiptRejected, 'wrong file');
});
