/**
 * A fount holds only what it's told to, and no more, pinned FIRST (test-driven):
 *   - it caches babels up to a byte capacity the operator sets, and never past it;
 *   - over capacity, it evicts the LEAST-RECENTLY-USED cached babel to make room;
 *   - a PINNED babel (one a publisher is paying to keep available) is never evicted, even under
 *     pressure -- that is the difference between "cached because popular" and "kept because paid";
 *   - reading a babel marks it recently used, so a hot babel is not the one dropped;
 *   - a babel larger than the whole capacity is refused, not allowed to blow the budget.
 *
 * This is what lets Cascade drop into a Kaspa node: the operator sets a cap, and the cache lives
 * inside it, forever. No cap, no drop-in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BabelCache, OverCapacity } from './cache.js';

const bytes = (n: number, fill = 1): Uint8Array => new Uint8Array(n).fill(fill);

test('it holds babels and reads them back, up to the capacity it was given', () => {
  const c = new BabelCache(1000);
  c.put('f', 0, bytes(300), { pinned: false });
  c.put('f', 1, bytes(300), { pinned: false });
  assert.equal(c.has('f', 0), true);
  assert.deepEqual(c.get('f', 1), bytes(300));
  assert.equal(c.usedBytes(), 600);
});

test('over capacity, it evicts the least-recently-used cached babel', () => {
  const c = new BabelCache(1000);
  c.put('f', 0, bytes(400), { pinned: false }); // oldest
  c.put('f', 1, bytes(400), { pinned: false });
  c.put('f', 2, bytes(400), { pinned: false }); // pushes total to 1200 > 1000 -> evict f:0
  assert.equal(c.has('f', 0), false, 'the oldest cached babel was dropped');
  assert.equal(c.has('f', 1), true);
  assert.equal(c.has('f', 2), true);
  assert.ok(c.usedBytes() <= 1000);
});

test('reading a babel makes it recently used, so it survives the next eviction', () => {
  const c = new BabelCache(1000);
  c.put('f', 0, bytes(400), { pinned: false });
  c.put('f', 1, bytes(400), { pinned: false });
  c.get('f', 0); // touch f:0 -> now f:1 is least-recently-used
  c.put('f', 2, bytes(400), { pinned: false }); // evicts f:1, not f:0
  assert.equal(c.has('f', 0), true, 'the recently-read babel stayed');
  assert.equal(c.has('f', 1), false, 'the untouched one was dropped');
});

test('a pinned babel is never evicted, even when the cache is under pressure', () => {
  const c = new BabelCache(1000);
  c.put('f', 0, bytes(400), { pinned: true }); // paid to keep -- protected
  c.put('f', 1, bytes(400), { pinned: false });
  c.put('f', 2, bytes(400), { pinned: false }); // must evict a CACHED one, i.e. f:1, not f:0
  assert.equal(c.has('f', 0), true, 'the pinned babel is kept');
  assert.equal(c.has('f', 1), false, 'the evictable one went instead');
  assert.equal(c.has('f', 2), true);
});

test('if only pinned babels remain and there is no room, the new babel is refused', () => {
  const c = new BabelCache(1000);
  c.put('f', 0, bytes(500), { pinned: true });
  c.put('f', 1, bytes(400), { pinned: true });
  assert.throws(() => c.put('f', 2, bytes(400), { pinned: false }), OverCapacity, 'cannot evict paid content for cache');
  assert.equal(c.has('f', 2), false);
});

test('a babel larger than the whole capacity is refused outright', () => {
  const c = new BabelCache(1000);
  assert.throws(() => c.put('f', 0, bytes(1500), { pinned: false }), OverCapacity);
});

test('holdings() lists what the fount holds, for announcing to the Meridian', () => {
  const c = new BabelCache(1000);
  c.put('a', 0, bytes(100), { pinned: true });
  c.put('a', 3, bytes(100), { pinned: false });
  c.put('b', 7, bytes(100), { pinned: false });
  const h = c.holdings().sort((x, y) => (x.fileId + x.index).localeCompare(y.fileId + y.index));
  assert.deepEqual(h, [
    { fileId: 'a', index: 0, size: 100, pinned: true },
    { fileId: 'a', index: 3, size: 100, pinned: false },
    { fileId: 'b', index: 7, size: 100, pinned: false },
  ]);
});
