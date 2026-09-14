/**
 * The routing table: k-buckets keyed by XOR distance, and the one query a lookup needs — "give me
 * the peers closest to this target." No network here; a table is just what a node remembers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idFromHex, idOf } from './distance.js';
import { RoutingTable } from './routing.js';

const self = idFromHex('00'.repeat(32));

test('closest returns peers nearest the target by XOR, nearest first', () => {
  const t = new RoutingTable(self);
  t.add({ id: idFromHex('01' + '00'.repeat(31)), url: 'p1' });
  t.add({ id: idFromHex('ff' + '00'.repeat(31)), url: 'p2' });
  t.add({ id: idFromHex('08' + '00'.repeat(31)), url: 'p3' });
  const near = t.closest(idFromHex('00'.repeat(32)), 2);
  assert.deepEqual(near.map((p) => p.url), ['p1', 'p3'], 'nearest two to 0x00.. are p1 (0x01) then p3 (0x08)');
});

test('the node never stores or returns itself', () => {
  const t = new RoutingTable(self);
  t.add({ id: self, url: 'me' });
  assert.equal(t.size(), 0);
  assert.equal(t.closest(idFromHex('ff'.repeat(32)), 10).length, 0);
});

test('a peer added twice is stored once (dedup by id)', () => {
  const t = new RoutingTable(self);
  t.add({ id: idOf('x'), url: 'http://x' });
  t.add({ id: idOf('x'), url: 'http://x-moved' });
  assert.equal(t.size(), 1, 'same id is the same peer');
});

test('closest never returns more than asked, even with many peers', () => {
  const t = new RoutingTable(self);
  for (let i = 1; i <= 50; i++) t.add({ id: idOf(`peer-${i}`), url: `p${i}` });
  assert.equal(t.closest(idOf('target'), 8).length, 8);
});
