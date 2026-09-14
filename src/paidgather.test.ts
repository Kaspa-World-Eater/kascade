/**
 * A whole file, paid across the Meridian: one paidPull per fount, in parallel, one channel each.
 * The file reassembles byte-identical, and each fount is paid — with a valid final voucher — for
 * exactly the parcels it served.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { gatherPaid } from './paidgather.js';

const buyerSk = 'a1'.repeat(32);
const buyerPk = publicKeyHex(buyerSk);
const NET = 'kaspa:testnet-10';
const file = Uint8Array.from({ length: 320 }, (_, i) => (i * 11 + 3) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('gatherPaid pulls a file across three founts, paying each per parcel', async () => {
  const m = buildManifest('movie.bin', file, 64); // 5 parcels (64,64,64,64,64) = 320
  const all = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 64, p.index * 64 + p.size)]));
  const layout = [
    { cov: '11'.repeat(32), holds: [0, 1] },
    { cov: '22'.repeat(32), holds: [2, 3] },
    { cov: '33'.repeat(32), holds: [4] },
  ];
  const nodes = layout.map((L) => {
    const parcels = new Map(L.holds.map((i) => [i, all.get(i) as Uint8Array]));
    const held: Held[] = [{ manifest: m, parcels }];
    const f = fount({ held, priceSompi: 1, credit: (cid) => (cid === L.cov ? { channel: { network: NET, covenantId: L.cov }, buyerPubkey: buyerPk } : null) });
    return { L, f, url: '' };
  });
  await Promise.all(nodes.map((n) => listen(n.f.server)));
  for (const n of nodes) n.url = `http://127.0.0.1:${(n.f.server.address() as AddressInfo).port}`;
  try {
    const holders = nodes.map((n) => ({ url: n.url, indices: n.L.holds }));
    const channelByFount = Object.fromEntries(nodes.map((n) => [n.url, { network: NET, covenantId: n.L.cov }]));
    const res = await gatherPaid({ manifest: m, holders, channelByFount, buyerSk, priceSompi: 1 });
    assert.equal(res.complete, true);
    assert.deepEqual(res.bytes, file, 'byte-identical, paid across three founts');
    const paid = Object.values(res.perFount).reduce((n, p) => n + p.sompi, 0);
    assert.equal(paid, 320, 'the whole price, split across the founts');
    assert.equal(Object.keys(res.perFount).length, 3, 'all three earned');
    for (const p of Object.values(res.perFount)) assert.ok(Number(p.voucher.amount) === p.sompi, 'each fount holds a voucher for its share');
  } finally { await Promise.all(nodes.map((n) => close(n.f.server))); }
});

test('a second gather reuses the same channel and its voucher resumes the cumulative ceiling', async () => {
  const m = buildManifest('movie.bin', file, 64); // 5 parcels of 64
  const all = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 64, p.index * 64 + p.size)]));
  const COV = '44'.repeat(32);
  const held: Held[] = [{ manifest: m, parcels: new Map(all) }];
  const f = fount({ held, priceSompi: 1, credit: (cid) => (cid === COV ? { channel: { network: NET, covenantId: COV }, buyerPubkey: buyerPk } : null) });
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  const channelByFount = { [url]: { network: NET, covenantId: COV } };
  try {
    // First gather takes parcels 0-2 (192 sompi).
    const g1 = await gatherPaid({ manifest: m, holders: [{ url, indices: [0, 1, 2] }], channelByFount, buyerSk, priceSompi: 1 });
    const first = g1.perFount[url]?.sompi ?? 0;
    // Second gather on the SAME channel takes 3-4; it must resume from the first gather's ceiling.
    const g2 = await gatherPaid({ manifest: m, holders: [{ url, indices: [3, 4] }], channelByFount, buyerSk, priceSompi: 1, vouchedByFount: { [url]: first } });
    assert.equal(Number(g2.perFount[url]?.voucher.amount), 320, 'the reused channel vouches the whole file cumulatively, not just the second gather');
  } finally { await close(f.server); }
});
