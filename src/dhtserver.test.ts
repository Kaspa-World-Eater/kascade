/**
 * The DHT over real HTTP sockets, and doing the tracker's whole job with no tracker: founts announce
 * what they hold into the DHT, and a gatherer discovers which founts serve a file — and which parcels
 * each holds — then reassembles it byte-identical. No central list anywhere in this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { idOf, idFromHex } from './distance.js';
import { KadNode } from './kadnode.js';
import { startDhtNode, httpRpc, peerOf, holdersViaDht } from './dhtserver.js';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { fetchFile } from './consumer.js';

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('DHT nodes route over HTTP: a provider announced on one is found by a distant one', async () => {
  const boot = await startDhtNode();
  const rest = await Promise.all(Array.from({ length: 8 }, () => startDhtNode([peerOf(boot.url)])));
  const all = [boot, ...rest];
  try {
    for (const n of rest) await n.node.join(peerOf(boot.url));
    await all[2]!.node.announce(idOf('film'), 'http://fount-x');
    const found = await all[7]!.node.findProviders(idOf('film'));
    assert.ok(found.includes('http://fount-x'), 'resolved across real sockets');
  } finally {
    await Promise.all(all.map((n) => n.close()));
  }
});

test('founts announce into the DHT and a gatherer reassembles a file with no tracker', async () => {
  const bytes = Uint8Array.from({ length: 500 }, (_, i) => (i * 13 + 5) % 251);
  const m = buildManifest('clip.bin', bytes, 100); // 5 parcels
  const cut = (i: number) => bytes.subarray(i * 100, i * 100 + 100);

  // Two founts, each holding part of the file, served over HTTP (free path).
  const mk = (idx: number[]): { f: ReturnType<typeof fount>; url: string } => {
    const parcels = new Map(idx.map((i) => [i, cut(i)]));
    const held: Held[] = [{ manifest: m, parcels }];
    return { f: fount({ held, priceSompi: 0 }), url: '' };
  };
  const a = mk([0, 1, 2]);
  const b = mk([3, 4]);
  const dht = await startDhtNode();
  await Promise.all([listen(a.f.server), listen(b.f.server)]);
  a.url = `http://127.0.0.1:${(a.f.server.address() as AddressInfo).port}`;
  b.url = `http://127.0.0.1:${(b.f.server.address() as AddressInfo).port}`;

  try {
    // Each fount announces the files it holds into the DHT (a client node bootstrapped to it).
    for (const node of [a, b]) {
      const client = new KadNode(`announce-${node.url}`, httpRpc(), [peerOf(dht.url)]);
      await client.join(peerOf(dht.url));
      await client.announce(idFromHex(m.fileId), node.url);
    }

    // A gatherer resolves the file THROUGH THE DHT — not a tracker — then fetches it.
    const seeker = new KadNode('seeker', httpRpc(), [peerOf(dht.url)]);
    await seeker.join(peerOf(dht.url));
    const holders = await holdersViaDht(seeker, m.fileId);
    assert.equal(holders.length, 2, 'both founts discovered via the DHT');

    const { bytes: got, receipt } = await fetchFile({ manifest: m, holders, priceSompi: 0, concurrency: 4 });
    assert.equal(receipt.complete, true);
    assert.deepEqual(got, bytes, 'reassembled byte-identical, discovered with no central list');
  } finally {
    await Promise.all([close(a.f.server), close(b.f.server), dht.close()]);
  }
});
