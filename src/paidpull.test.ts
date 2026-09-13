/**
 * The gatherer side of the per-parcel 402 handshake: paidPull pulls parcels from one credit-enforcing
 * fount, signing an incremental voucher for everything received so far and sending it with the next
 * request — and a final voucher for the last parcel. If it ever signs too little, the fount returns
 * 402 and paidPull throws; so a clean completion IS the proof the gatherer paid correctly per parcel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { paidPull } from './paidpull.js';

const buyerSk = 'a1'.repeat(32);
const buyerPk = publicKeyHex(buyerSk);
const COV = 'cd'.repeat(32);
const channel = { network: 'kaspa:testnet-10', covenantId: COV };
const file = Uint8Array.from({ length: 320 }, (_, i) => (i * 11 + 3) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('paidPull pays per parcel and receives the whole file from a credit-enforcing fount', async () => {
  const m = buildManifest('clip.bin', file, 100); // 4 parcels (100,100,100,20), price 1
  const parcels = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 100, p.index * 100 + p.size)]));
  const held: Held[] = [{ manifest: m, parcels }];
  const f = fount({ held, priceSompi: 1, credit: (cid) => (cid === COV ? { channel, buyerPubkey: buyerPk } : null) });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    const out = await paidPull({ fountUrl: url, manifest: m, indices: m.parcels.map((p) => p.index), channel, buyerSk, priceSompi: 1 });
    // every parcel, reassembled byte-identical
    const got = new Uint8Array(m.size); let at = 0;
    for (const p of m.parcels) { got.set(out.parcels.get(p.index) as Uint8Array, at); at += p.size; }
    assert.deepEqual(got, file, 'the whole file, paid for parcel by parcel');
    assert.equal(out.paidSompi, m.size, 'paid exactly the total (1 sompi/byte)');
    assert.equal(Number(out.voucher.amount), m.size, 'the final voucher covers everything delivered');
  } finally { await close(f.server); }
});
