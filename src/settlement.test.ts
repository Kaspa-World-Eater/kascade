/**
 * Turning a swarm receipt into money on the rail, pinned FIRST (test-driven):
 *   - every provider that earned and has a channel is paid exactly what it earned, on that channel;
 *   - a provider that earned but registered no channel is reported unsettleable, never dropped;
 *   - a provider that served junk is flagged to slash -- and if it also served good chunks, it is
 *     BOTH paid for the good and slashed for the junk, because the two are counted per chunk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Receipt } from './consumer.js';
import { settlementFor } from './settlement.js';

const receipt = (over: Partial<Receipt>): Receipt => ({
  perProvider: {}, totalSompi: 0, chunksGot: 0, bytesGot: 0, complete: true, faults: [], ...over,
});

test('each earner with a channel is paid exactly what it earned, on that channel', () => {
  const r = receipt({
    perProvider: { 'http://a': { chunks: 3, bytes: 300, sompi: 600 }, 'http://b': { chunks: 1, bytes: 100, sompi: 200 } },
    totalSompi: 800,
  });
  const s = settlementFor(r, { 'http://a': 'chan-a', 'http://b': 'chan-b' });
  assert.deepEqual(
    s.pay.sort((x, y) => x.url.localeCompare(y.url)),
    [{ url: 'http://a', sompi: 600, channel: 'chan-a' }, { url: 'http://b', sompi: 200, channel: 'chan-b' }],
  );
  assert.equal(s.totalPaidSompi, 800);
  assert.equal(s.slash.length, 0);
  assert.equal(s.unsettleable.length, 0);
});

test('an earner with no channel is reported unsettleable, not silently dropped', () => {
  const r = receipt({ perProvider: { 'http://a': { chunks: 1, bytes: 100, sompi: 200 } }, totalSompi: 200 });
  const s = settlementFor(r, {}); // no channels registered
  assert.equal(s.pay.length, 0);
  assert.deepEqual(s.unsettleable, [{ url: 'http://a', sompi: 200, reason: 'no channel with this provider' }]);
  assert.equal(s.totalPaidSompi, 0);
});

test('a junk provider is flagged to slash, with its fault count', () => {
  const r = receipt({ faults: [{ url: 'http://liar', index: 2 }, { url: 'http://liar', index: 5 }] });
  const s = settlementFor(r, { 'http://liar': 'chan-liar' });
  assert.deepEqual(s.slash, [{ url: 'http://liar', faults: 2 }]);
  assert.equal(s.pay.length, 0, 'it earned nothing, so it is paid nothing');
});

test('a mixed provider is BOTH paid for good chunks and slashed for junk', () => {
  const r = receipt({
    perProvider: { 'http://m': { chunks: 2, bytes: 200, sompi: 400 } },
    faults: [{ url: 'http://m', index: 9 }],
    totalSompi: 400,
  });
  const s = settlementFor(r, { 'http://m': 'chan-m' });
  assert.deepEqual(s.pay, [{ url: 'http://m', sompi: 400, channel: 'chan-m' }]);
  assert.deepEqual(s.slash, [{ url: 'http://m', faults: 1 }]);
});

test('an empty receipt settles to nothing', () => {
  const s = settlementFor(receipt({}), {});
  assert.deepEqual(s, { pay: [], slash: [], unsettleable: [], totalPaidSompi: 0 });
});
