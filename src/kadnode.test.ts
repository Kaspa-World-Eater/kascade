/**
 * The DHT doing the tracker's job WITHOUT a tracker: a provider announced on one node is found by a
 * node that never knew it, purely by walking the network toward the file's id. This is the property
 * that lets kascade drop its central list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idOf, type Peer } from './distance.js';
import { KadNode, inProcessNetwork } from './kadnode.js';

async function ring(size: number): Promise<KadNode[]> {
  const net = inProcessNetwork();
  const boot: Peer = { id: idOf('node-0'), url: 'node-0' };
  const nodes: KadNode[] = [];
  for (let i = 0; i < size; i++) {
    const n = new KadNode(`node-${i}`, net.rpc, i === 0 ? [] : [boot]);
    net.register(n);
    nodes.push(n);
  }
  for (let i = 1; i < size; i++) await (nodes[i] as KadNode).join(boot);
  return nodes;
}

test('a provider announced on one node is found by a distant node — no central list', async () => {
  const nodes = await ring(24);
  const fileId = idOf('big-movie.mp4');
  const stored = await (nodes[3] as KadNode).announce(fileId, 'http://fount-3');
  assert.ok(stored > 0, 'the record was stored on the nodes closest to the file id');

  const found = await (nodes[19] as KadNode).findProviders(fileId);
  assert.ok(found.includes('http://fount-3'), 'a node that never knew fount-3 resolved it through the DHT');
});

test('many providers of one file all surface through a lookup', async () => {
  const nodes = await ring(24);
  const fileId = idOf('popular.iso');
  await (nodes[5] as KadNode).announce(fileId, 'http://fount-5');
  await (nodes[11] as KadNode).announce(fileId, 'http://fount-11');
  await (nodes[20] as KadNode).announce(fileId, 'http://fount-20');

  const found = await (nodes[1] as KadNode).findProviders(fileId);
  for (const url of ['http://fount-5', 'http://fount-11', 'http://fount-20']) {
    assert.ok(found.includes(url), `${url} surfaced`);
  }
});

test('a file nobody announced resolves to no providers', async () => {
  const nodes = await ring(16);
  const found = await (nodes[7] as KadNode).findProviders(idOf('never-seeded'));
  assert.deepEqual(found, []);
});
