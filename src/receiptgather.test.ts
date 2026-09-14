/**
 * The publisher-pays vertical, end to end and in one process: real founts (one lying) serve a viewer
 * for FREE; the viewer verifies each parcel and signs a receipt; the file comes back byte-identical;
 * and the publisher's budget settles to the honest founts only — the liar unpaid, the viewer at zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { gatherWithReceipts } from './receiptgather.js';
import { tallyReceipts, settlePublisherPays } from './publisherpays.js';

const viewerSk = 'a1'.repeat(32);
const viewerPk = publicKeyHex(viewerSk);
const file = Uint8Array.from({ length: 400 }, (_, i) => (i * 7 + 1) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('viewer gathers free + signs receipts; publisher pays the honest founts, liar unpaid, viewer zero', async () => {
  const m = buildManifest('clip.bin', file, 100); // 4 parcels of 100
  const cut = (i: number) => file.subarray(i * 100, i * 100 + 100);

  // Honest A holds [0,1], honest B holds [2,3]. Liar L also claims parcel 0 but serves junk.
  const A = fount({ held: [{ manifest: m, parcels: new Map([[0, cut(0)], [1, cut(1)]]) }] as Held[], priceSompi: 0 });
  const B = fount({ held: [{ manifest: m, parcels: new Map([[2, cut(2)], [3, cut(3)]]) }] as Held[], priceSompi: 0 });
  const L = fount({ held: [{ manifest: m, parcels: new Map([[0, cut(0)]]) }] as Held[], priceSompi: 0, tamper: (b) => b.map((x) => x ^ 0xff) });
  await Promise.all([listen(A.server), listen(B.server), listen(L.server)]);
  const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const [ua, ub, ul] = [url(A.server), url(B.server), url(L.server)];

  try {
    // The liar is listed FIRST for parcel 0, so it is tried, caught, and routed to A.
    const holders = [{ url: ul, indices: [0] }, { url: ua, indices: [0, 1] }, { url: ub, indices: [2, 3] }];
    const g = await gatherWithReceipts({ manifest: m, holders, viewerSk });

    assert.equal(g.complete, true);
    assert.deepEqual(g.bytes, file, 'byte-identical, gathered for free');
    assert.deepEqual(g.faults, [{ url: ul, index: 0 }], 'the liar was caught on parcel 0');

    const { perFount } = tallyReceipts(m, g.receipts, viewerPk, 2);
    const s = settlePublisherPays({ budgetSompi: 10_000, perFount, faults: [{ url: ul }], dustSompi: 0 });

    assert.equal(s.viewerPaidSompi, 0, 'the viewer paid nothing');
    assert.deepEqual(s.pay.sort((x, y) => x.sompi - y.sompi), [{ url: ua, sompi: 400 }, { url: ub, sompi: 400 }], 'both honest founts paid from the budget');
    assert.deepEqual(s.unpaidLiar, [ul], 'the liar earned no receipt and is unpaid');
    assert.equal(s.remaining, 10_000 - 800, 'budget drawn down by exactly the honest earnings');
  } finally {
    await Promise.all([close(A.server), close(B.server), close(L.server)]);
  }
});
