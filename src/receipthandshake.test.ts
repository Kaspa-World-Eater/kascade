/**
 * Publisher-pays slice 2: the receipt handshake enforced at the fount. A free-serving fount extends at
 * most ONE parcel before it needs the viewer's signed receipt for it -- the receipt twin of the
 * per-parcel voucher credit. A viewer that stops acknowledging is cut off; a forged receipt buys
 * nothing; and a cooperating viewer completes the file paying zero while the publisher settles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { signReceipt } from './receipt.js';
import { receiptPull } from './receiptgather.js';
import { tallyReceipts, settlePublisherPays } from './publisherpays.js';

const viewerSk = 'a1'.repeat(32);
const viewerPk = publicKeyHex(viewerSk);
const file = Uint8Array.from({ length: 400 }, (_, i) => (i * 7 + 1) % 251); // 4 parcels of 100
const m = buildManifest('clip.bin', file, 100);
const parcels = () => new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 100, p.index * 100 + p.size)]));
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));
const ask = (url: string, i: number, viewer: string, receipt?: unknown) =>
  fetch(`${url}/kascade/parcel?file=${m.fileId}&i=${i}&viewer=${viewer}`, { headers: receipt ? { 'x-receipt': JSON.stringify(receipt) } : {} });

test('a publisher-pays fount serves one parcel, then stops until the receipt for it arrives', async () => {
  const f = fount({ held: [{ manifest: m, parcels: parcels() }] as Held[], priceSompi: 0, publisherPays: true });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  const r = (i: number, sk = viewerSk) => signReceipt(sk, { fileId: m.fileId, index: i, bytes: 100, fountUrl: url });
  try {
    assert.equal((await ask(url, 0, viewerPk)).status, 200, 'first parcel on credit');
    assert.equal((await ask(url, 1, viewerPk)).status, 402, 'stopped: parcel 0 not yet acknowledged');
    assert.equal((await ask(url, 1, viewerPk, r(0))).status, 200, 'receipt for 0 -> parcel 1');
    assert.equal((await ask(url, 2, viewerPk, r(1, 'b2'.repeat(32)))).status, 402, 'a forged receipt buys nothing');
    assert.equal((await ask(url, 2, viewerPk, r(1))).status, 200, 'a real receipt for 1 -> parcel 2');
  } finally { await close(f.server); }
});

test('a cooperating viewer completes the file paying ZERO; the publisher settles the fount', async () => {
  const kept: unknown[] = [];
  const f = fount({ held: [{ manifest: m, parcels: parcels() }] as Held[], priceSompi: 0, publisherPays: true, onReceipt: (rec) => kept.push(rec) });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    const out = await receiptPull({ fountUrl: url, manifest: m, indices: [0, 1, 2, 3], viewerSk, viewerPubkey: viewerPk });
    assert.equal(out.parcels.size, 4, 'the whole file, via the receipt handshake');
    assert.equal(out.receipts.length, 4, 'one receipt per verified parcel');

    const { perFount } = tallyReceipts(m, out.receipts, viewerPk, 2);
    const s = settlePublisherPays({ budgetSompi: 10_000, perFount, faults: [], dustSompi: 0 });
    assert.equal(s.viewerPaidSompi, 0, 'the viewer paid nothing');
    assert.deepEqual(s.pay, [{ url, sompi: 400 * 2 }], 'the publisher pays the fount for the bytes it delivered');
  } finally { await close(f.server); }
});

test('a require-auth fount serves only publisher-authorized viewers', async () => {
  const { signAuthToken } = await import('./authtoken.js');
  const publisherSk = 'c3'.repeat(32);
  const publisherPk = publicKeyHex(publisherSk);
  const f = fount({ held: [{ manifest: m, parcels: parcels() }] as Held[], priceSompi: 0, publisherPays: true, requireAuth: publisherPk });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    // No token -> the fount earns the viewer nothing.
    const bare = await receiptPull({ fountUrl: url, manifest: m, indices: [0, 1, 2, 3], viewerSk, viewerPubkey: viewerPk });
    assert.equal(bare.parcels.size, 0, 'an unauthorized viewer is refused');

    // A publisher-signed token for THIS viewer and file -> served.
    const token = signAuthToken(publisherSk, { viewerPubkey: viewerPk, fileId: m.fileId, expiry: Date.now() + 60_000 });
    const ok = await receiptPull({ fountUrl: url, manifest: m, indices: [0, 1, 2, 3], viewerSk, viewerPubkey: viewerPk, authToken: token });
    assert.equal(ok.parcels.size, 4, 'an authorized viewer gets the whole file');
  } finally { await close(f.server); }
});
