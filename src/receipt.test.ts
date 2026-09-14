/**
 * A receipt is the viewer's signed word that a fount delivered a verified parcel. It must verify only
 * for the viewer that signed it, and any tampering with what it attests must break it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicKeyHex } from 'metered-protocol';
import { signReceipt, verifyReceipt } from './receipt.js';

const viewerSk = 'a1'.repeat(32);
const viewerPk = publicKeyHex(viewerSk);
const base = { fileId: 'f'.repeat(64), index: 3, bytes: 65536, fountUrl: 'http://fount-a' };

test('a receipt signed by the viewer verifies for the viewer', () => {
  const r = signReceipt(viewerSk, base);
  assert.equal(verifyReceipt(r, viewerPk), true);
});

test('a receipt does not verify for a different viewer', () => {
  const r = signReceipt(viewerSk, base);
  assert.equal(verifyReceipt(r, publicKeyHex('b2'.repeat(32))), false);
});

test('tampering with any attested field breaks the receipt', () => {
  const r = signReceipt(viewerSk, base);
  assert.equal(verifyReceipt({ ...r, index: 4 }, viewerPk), false, 'index');
  assert.equal(verifyReceipt({ ...r, bytes: 1 }, viewerPk), false, 'bytes');
  assert.equal(verifyReceipt({ ...r, fountUrl: 'http://evil' }, viewerPk), false, 'fount');
  assert.equal(verifyReceipt({ ...r, fileId: 'e'.repeat(64) }, viewerPk), false, 'fileId');
});
