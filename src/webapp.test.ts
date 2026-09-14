import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { webapp } from './webapp.js';

// These prove the routing and the page without touching the chain: the SDK-backed routes are not
// called here (they need a live node), but the server serving its page and rejecting unknown paths
// is pure and worth pinning.
async function start() {
  const { server } = webapp('testnet-10');
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('the app serves its control-panel page at the root', async () => {
  const { url, close } = await start();
  try {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<title>kascade<\/title>/);
    assert.match(html, /not built/); // the honest disclaimer about the phone app must be present
  } finally {
    await close();
  }
});

test('an unknown route is a clean 404, not a crash', async () => {
  const { url, close } = await start();
  try {
    const res = await fetch(`${url}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  } finally {
    await close();
  }
});
