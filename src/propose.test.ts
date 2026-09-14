/**
 * A real paid fount advertises WHO to pay and only extends credit on a channel it has ACCEPTED.
 * A gatherer proposes its channel (verified by the fount before a byte is served); until it does,
 * paid delivery is refused. This is the handshake a `cascade channel open` will drive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { publicKeyHex } from 'metered-protocol';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { paidPull } from './paidpull.js';

const buyerSk = 'a1'.repeat(32);
const buyerPk = publicKeyHex(buyerSk);
const NET = 'kaspa:testnet-10';
const COV = 'cd'.repeat(32);
const channel = { network: NET, covenantId: COV };
const payout = publicKeyHex('c3'.repeat(32));
const file = Uint8Array.from({ length: 200 }, (_, i) => (i * 7 + 1) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

function proposedFount() {
  const m = buildManifest('clip.bin', file, 100); // 2 parcels
  const parcels = new Map(m.parcels.map((p) => [p.index, file.subarray(p.index * 100, p.index * 100 + p.size)]));
  const held: Held[] = [{ manifest: m, parcels }];
  // verifyChannel stands in for the on-chain channelVerifier; here it accepts and echoes the id.
  const f = fount({
    held, priceSompi: 1, payoutPubkey: payout,
    verifyChannel: async (p, bpk) => ({ channel: { network: NET, covenantId: p.covenantId }, buyerPubkey: bpk }),
  });
  return { f, fileId: m.fileId, m };
}

test('a fount advertises its payout identity', async () => {
  const { f } = proposedFount();
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    const id = await (await fetch(`${url}/cascade/identity`)).json();
    assert.equal(id.payoutPubkey, payout);
  } finally { await close(f.server); }
});

test('paid delivery is refused until the channel is proposed, then it works', async () => {
  const { f, fileId, m } = proposedFount();
  await listen(f.server);
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(
      () => paidPull({ fountUrl: url, manifest: m, indices: [0, 1], channel, buyerSk, priceSompi: 1 }),
      /402/, 'no credit before the channel is accepted',
    );
    const res = await fetch(`${url}/cascade/propose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposal: { covenantId: COV }, buyerPubkey: buyerPk }) });
    assert.equal(res.status, 200, 'the fount accepts the proposal');
    const out = await paidPull({ fountUrl: url, manifest: m, indices: [0, 1], channel, buyerSk, priceSompi: 1 });
    assert.equal(out.parcels.size, 2, 'now it serves, paid per parcel');
  } finally { await close(f.server); }
});
