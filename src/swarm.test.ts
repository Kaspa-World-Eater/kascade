/**
 * What cascade promises, pinned:
 *   - a file reassembles BYTE-IDENTICAL from several providers pulled at once;
 *   - each provider is paid for exactly the babels IT served, and the parts sum to the whole price;
 *   - a provider that serves JUNK is caught against the manifest, paid nothing for it, and routed
 *     around -- the file still completes;
 *   - if no honest holder has a babel, the file is honestly INCOMPLETE, never corrupted;
 *   - stopping partway pays only for the babels that arrived.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { buildManifest, verifyBabel, manifestIsSound, type Manifest } from './manifest.js';
import { provider, type Held } from './provider.js';
import { trackerServer, announceTo, discover, type Holder } from './tracker.js';
import { fetchFile } from './consumer.js';

const PRICE = 2;
const file = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 251);

/** Every babel's bytes, by index, cut from the source the same way buildManifest cut it. */
function cut(bytes: Uint8Array, m: Manifest): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const c of m.babels) out.set(c.index, bytes.subarray(c.index * m.babelSize, c.index * m.babelSize + c.size));
  return out;
}

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('a manifest is content-addressed: it is sound, and a tampered babel fails to verify', () => {
  const bytes = file(200_000);
  const m = buildManifest('data.bin', bytes, 64 * 1024);
  assert.equal(m.babels.length, 4);
  assert.equal(manifestIsSound(m), true);
  const babel0 = cut(bytes, m).get(0) as Uint8Array;
  assert.equal(verifyBabel(m, 0, babel0), true);
  const tampered = Uint8Array.from(babel0); tampered[0] = (tampered[0] ?? 0) ^ 0xff;
  assert.equal(verifyBabel(m, 0, tampered), false, 'one flipped bit is caught');
});

test('THE SWARM: a file reassembles byte-for-byte from three providers, each paid for its share', async () => {
  const bytes = file(500_000); // 8 babels at 64 KB
  const m = buildManifest('movie.bin', bytes, 64 * 1024);
  const all = cut(bytes, m);
  // three providers, overlapping subsets whose union is every babel.
  const subsets = [[0, 1, 2, 3, 4], [3, 4, 5, 6], [0, 6, 7]];
  const held = (idx: number[]): Held[] => [{ manifest: m, babels: new Map(idx.map((i) => [i, all.get(i) as Uint8Array])) }];
  const provs = subsets.map((idx) => provider({ held: held(idx), priceSompi: PRICE }));
  const { server: trk, url: trkUrl, tracker } = trackerServer();
  await Promise.all([...provs.map((p) => listen(p.server)), listen(trk)]);
  try {
    for (const [i, p] of provs.entries()) await announceTo(trkUrl(), m.fileId, p.url(), subsets[i] as number[]);
    const holders = await discover(trkUrl(), m.fileId);
    assert.equal(holders.length, 3, 'the tracker knows all three');

    const { bytes: got, receipt } = await fetchFile({ manifest: m, holders, priceSompi: PRICE, concurrency: 4 });
    assert.deepEqual(got, bytes, 'every byte, in order, from three sources at once');
    assert.equal(receipt.complete, true);
    assert.equal(receipt.babelsGot, 8);
    assert.equal(receipt.totalSompi, 500_000 * PRICE, 'the whole price, once');
    // the parts sum to the whole, and more than one provider actually earned.
    const earners = Object.keys(receipt.perProvider);
    assert.ok(earners.length >= 2, `several providers served, got ${earners.length}`);
    const summed = Object.values(receipt.perProvider).reduce((n, t) => n + t.sompi, 0);
    assert.equal(summed, receipt.totalSompi, 'per-provider pay sums to the total');
    assert.equal(receipt.faults.length, 0);
  } finally {
    await Promise.all([...provs.map((p) => close(p.server)), close(trk)]);
  }
});

test('a JUNK provider is caught and routed around; the file still completes and it earns nothing for junk', async () => {
  const bytes = file(300_000); // 5 babels
  const m = buildManifest('data.bin', bytes, 64 * 1024);
  const all = cut(bytes, m);
  const honest = provider({ held: [{ manifest: m, babels: new Map(m.babels.map((c) => [c.index, all.get(c.index) as Uint8Array])) }], priceSompi: PRICE });
  // a liar that holds every babel too, but flips a byte in whatever it serves.
  const liar = provider({
    held: [{ manifest: m, babels: new Map(m.babels.map((c) => [c.index, all.get(c.index) as Uint8Array])) }],
    priceSompi: PRICE,
    tamper: (b) => { const t = Uint8Array.from(b); t[0] = (t[0] ?? 0) ^ 0x01; return t; },
  });
  await Promise.all([listen(honest.server), listen(liar.server)]);
  try {
    const holders: Holder[] = [
      { url: liar.url(), indices: m.babels.map((c) => c.index) },   // listed first, tried first
      { url: honest.url(), indices: m.babels.map((c) => c.index) },
    ];
    const { bytes: got, receipt } = await fetchFile({ manifest: m, holders, priceSompi: PRICE, concurrency: 1 });
    assert.deepEqual(got, bytes, 'the file is correct despite the liar');
    assert.equal(receipt.complete, true);
    assert.ok(receipt.faults.length >= 1, 'the liar was caught at least once');
    assert.equal(receipt.faults.every((f) => f.url === liar.url()), true, 'only the liar is faulted');
    assert.equal(receipt.perProvider[liar.url()], undefined, 'the liar earned nothing -- junk is never billed');
    assert.equal(receipt.perProvider[honest.url()]?.sompi, 300_000 * PRICE, 'the honest provider earned it all');
  } finally {
    await Promise.all([close(honest.server), close(liar.server)]);
  }
});

test('if no honest holder has a babel, the file is honestly incomplete, not corrupted', async () => {
  const bytes = file(200_000); // 4 babels
  const m = buildManifest('data.bin', bytes, 64 * 1024);
  const all = cut(bytes, m);
  // one provider that holds only babels 0 and 1 -- 2 and 3 exist nowhere.
  const p = provider({ held: [{ manifest: m, babels: new Map([[0, all.get(0) as Uint8Array], [1, all.get(1) as Uint8Array]]) }], priceSompi: PRICE });
  await listen(p.server);
  try {
    const holders: Holder[] = [{ url: p.url(), indices: [0, 1] }];
    const { receipt } = await fetchFile({ manifest: m, holders, priceSompi: PRICE });
    assert.equal(receipt.complete, false, 'missing babels means incomplete');
    assert.equal(receipt.babelsGot, 2);
    assert.equal(receipt.totalSompi, receipt.bytesGot * PRICE, 'paid only for the two real babels');
  } finally {
    await close(p.server);
  }
});

test('stopping partway pays only for the babels that arrived', async () => {
  const bytes = file(640_000); // 10 babels
  const m = buildManifest('big.bin', bytes, 64 * 1024);
  const all = cut(bytes, m);
  const p = provider({ held: [{ manifest: m, babels: new Map(m.babels.map((c) => [c.index, all.get(c.index) as Uint8Array])) }], priceSompi: PRICE });
  await listen(p.server);
  try {
    let got = 0;
    const holders: Holder[] = [{ url: p.url(), indices: m.babels.map((c) => c.index) }];
    const { receipt } = await fetchFile({
      manifest: m, holders, priceSompi: PRICE, concurrency: 1,
      onBabel: () => { got += 1; }, stop: () => got >= 3,
    });
    assert.equal(receipt.complete, false);
    assert.ok(receipt.babelsGot >= 3 && receipt.babelsGot < 10, `stopped promptly, at ${receipt.babelsGot}`);
    assert.equal(receipt.totalSompi, receipt.bytesGot * PRICE, 'paid for exactly what arrived');
  } finally {
    await close(p.server);
  }
});
