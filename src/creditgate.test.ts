/**
 * The per-parcel rule ENFORCED at the fount, end to end over HTTP: a gatherer that pays as it goes
 * receives the whole file; a gatherer that stops signing vouchers is cut off after ONE parcel; a
 * forged voucher or an unknown channel is refused. This is "utilizes 402 per parcel" made real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { voucherForState, publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';

const buyerSk = 'a1'.repeat(32);
const buyerPk = publicKeyHex(buyerSk);
const COV = 'cd'.repeat(32);
const channel = { network: 'kaspa:testnet-10', covenantId: COV };
const voucher = (cumulative: number) => voucherForState({ cumulativeSompi: cumulative } as unknown as Parameters<typeof voucherForState>[0], channel, buyerSk);

const file = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 1) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

function paidFount() {
  const m = buildManifest('clip.bin', file, 100); // 3 parcels of 100B, price 1 -> 100 sompi each
  const parcels = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 100, p.index * 100 + p.size)]));
  const held: Held[] = [{ manifest: m, parcels }];
  const f = fount({ held, priceSompi: 1, credit: (cid) => (cid === COV ? { channel, buyerPubkey: buyerPk } : null) });
  return { f, fileId: m.fileId };
}

async function ask(url: string, fileId: string, index: number, v?: ReturnType<typeof voucher>, cid = COV) {
  const headers: Record<string, string> = v ? { 'x-voucher': JSON.stringify(v) } : {};
  return fetch(`${url}/kascade/parcel?file=${fileId}&i=${index}&channel=${cid}`, { headers });
}

test('pay-as-you-go receives the whole file; stop paying and you are cut off after one parcel', async () => {
  const { f, fileId } = paidFount();
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await ask(url, fileId, 0)).status, 200, 'first parcel on credit');
    assert.equal((await ask(url, fileId, 1)).status, 402, 'stopped: parcel 0 not yet vouched');
    assert.equal((await ask(url, fileId, 1, voucher(100))).status, 200, 'vouch 100 -> parcel 1');
    assert.equal((await ask(url, fileId, 2, voucher(100))).status, 402, 'stale voucher covers only 100 of 200 delivered');
    assert.equal((await ask(url, fileId, 2, voucher(200))).status, 200, 'vouch 200 -> parcel 2');
  } finally { await close(f.server); }
});

test('a forged voucher is refused, and delivery halts', async () => {
  const { f, fileId } = paidFount();
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await ask(url, fileId, 0)).status, 200);
    const forged = voucherForState({ cumulativeSompi: 100 } as unknown as Parameters<typeof voucherForState>[0], channel, 'b2'.repeat(32));
    assert.equal((await ask(url, fileId, 1, forged)).status, 402, 'forged voucher buys nothing');
  } finally { await close(f.server); }
});

test('an unknown channel is refused outright', async () => {
  const { f, fileId } = paidFount();
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await ask(url, fileId, 0, undefined, 'ff'.repeat(32))).status, 402, 'a channel the fount does not accept');
  } finally { await close(f.server); }
});

test('a fount resuming a channel refuses a voucher below the channel\'s prior ceiling', async () => {
  // Simulates a RESTARTED fount: the channel was already vouched to 200 before this process began,
  // supplied as vouchedSompi. A voucher that does not resume from there must buy nothing.
  const m = buildManifest('clip.bin', file, 100);
  const parcels = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 100, p.index * 100 + p.size)]));
  const f = fount({ held: [{ manifest: m, parcels }], priceSompi: 1, credit: (cid) => (cid === COV ? { channel, buyerPubkey: buyerPk, vouchedSompi: 200 } : null) });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await ask(url, m.fileId, 0)).status, 200, 'one new parcel on resume credit');
    assert.equal((await ask(url, m.fileId, 1, voucher(100))).status, 402, 'a voucher below the resumed ceiling (200) buys nothing');
    assert.equal((await ask(url, m.fileId, 1, voucher(300))).status, 200, 'a voucher resuming to 300 (200 prior + 100 new) serves');
  } finally { await close(f.server); }
});
