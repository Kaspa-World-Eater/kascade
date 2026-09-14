/**
 * The per-parcel 402 rule, pinned FIRST (test-driven): a fount extends at most ONE parcel of credit,
 * then refuses to serve more until the gatherer has signed a voucher covering what it already got.
 * This is what makes Kascade trustless PER PARCEL rather than only at the final settlement — a fount
 * can lose at most one parcel to a gatherer that stops paying, and a gatherer signs only for parcels
 * it has already received and verified. Uses metered's REAL voucher crypto, no mocks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voucherForState, publicKeyHex } from 'metered-protocol';
import { Creditline, VoucherRejected } from './creditline.js';

const buyerSk = 'a1'.repeat(32);
const buyerPk = publicKeyHex(buyerSk);
const channel = { network: 'kaspa:testnet-10', covenantId: 'ab'.repeat(32) };
const voucher = (cumulative: number) => voucherForState({ cumulativeSompi: cumulative } as unknown as Parameters<typeof voucherForState>[0], channel, buyerSk);

test('a fresh creditline may serve — nothing is owed yet', () => {
  const c = new Creditline(channel, buyerPk);
  assert.equal(c.mayServe(), true);
  assert.equal(c.outstanding(), 0);
});

test('after serving a parcel it must STOP until that parcel is vouched', () => {
  const c = new Creditline(channel, buyerPk);
  c.served(1000);
  assert.equal(c.outstanding(), 1000);
  assert.equal(c.mayServe(), false, 'one unvouched parcel outstanding — no more credit');
  c.recordVoucher(voucher(1000));
  assert.equal(c.outstanding(), 0);
  assert.equal(c.mayServe(), true, 'paid — credit restored');
});

test('exposure is never more than a single parcel across a whole exchange', () => {
  const c = new Creditline(channel, buyerPk);
  for (let paid = 0, n = 1; n <= 5; n++) {
    assert.ok(c.outstanding() <= 1000, `never more than one parcel at risk (was ${c.outstanding()})`);
    c.served(1000);
    assert.equal(c.mayServe(), false);
    paid += 1000;
    c.recordVoucher(voucher(paid));
    assert.equal(c.mayServe(), true);
  }
});

test('a voucher signed by the wrong key is refused', () => {
  const c = new Creditline(channel, buyerPk);
  c.served(1000);
  const forged = voucherForState({ cumulativeSompi: 1000 } as unknown as Parameters<typeof voucherForState>[0], channel, 'b2'.repeat(32));
  assert.throws(() => c.recordVoucher(forged), VoucherRejected);
  assert.equal(c.mayServe(), false, 'still unpaid — the forgery bought nothing');
});

test('a voucher may never go down — the ceiling only rises', () => {
  const c = new Creditline(channel, buyerPk);
  c.served(2000);
  c.recordVoucher(voucher(2000));
  assert.throws(() => c.recordVoucher(voucher(1000)), VoucherRejected);
});
