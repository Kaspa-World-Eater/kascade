/**
 * The metric a Kademlia DHT is built on: XOR distance over 256-bit ids. Everything the routing
 * table and lookup do reduces to "which id is closer to this target", so this is pinned first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idOf, idFromHex, toHex, distanceHex, closerOf, bucketIndex } from './distance.js';

test('an id is the sha256 of its seed: stable, 32 bytes, and different seeds differ', () => {
  const a = idOf('http://fount-a');
  assert.equal(a.length, 32);
  assert.deepEqual(idOf('http://fount-a'), a, 'same seed, same id');
  assert.notDeepEqual(idOf('http://fount-b'), a);
});

test('distance is XOR: zero to itself, symmetric, and a single differing bit is a small distance', () => {
  const a = idFromHex('00'.repeat(32));
  const b = idFromHex('00'.repeat(31) + '01');
  assert.equal(distanceHex(a, a), '00'.repeat(32), 'nothing is distance 0 from itself');
  assert.equal(distanceHex(a, b), distanceHex(b, a), 'symmetric');
  assert.equal(distanceHex(a, b), '00'.repeat(31) + '01', 'one flipped low bit');
});

test('closerOf picks the id nearer the target under XOR', () => {
  const target = idFromHex('ff'.repeat(32));
  const near = idFromHex('ff'.repeat(31) + 'f0'); // differs only in low nibble
  const far = idFromHex('00'.repeat(32)); // differs everywhere
  assert.deepEqual(closerOf(target, near, far), near);
  assert.deepEqual(closerOf(target, far, near), near, 'order of arguments does not matter');
});

test('bucketIndex is the highest differing bit: 255 at the top, low for near ids, -1 for identical', () => {
  const self = idFromHex('00'.repeat(32));
  assert.equal(bucketIndex(self, idFromHex('80' + '00'.repeat(31))), 255, 'top bit differs -> highest bucket');
  assert.equal(bucketIndex(self, idFromHex('00'.repeat(31) + '01')), 0, 'only the lowest bit differs -> bucket 0');
  assert.equal(bucketIndex(self, self), -1, 'no bit differs');
});
