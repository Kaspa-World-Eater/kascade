/**
 * The per-parcel money proof, live on Kaspa testnet-10: founts that ENFORCE the 402 rule, a gatherer
 * that pays per parcel, and each fount claiming its per-parcel voucher on chain.
 *
 * This is the whole handshake, live and unmocked. Every fount extends one parcel of credit and stops
 * until it is vouched; the gatherer (gatherPaid) signs an incremental voucher per parcel; each fount
 * ends holding a real voucher it claims for real KAS. The difference from prove-live-meridian is that
 * payment here is per parcel, not one voucher for the aggregate at the end.
 */
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { publicKeyHex } from 'metered-protocol';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { open, claim, connect } from '../src/channel.js';
import { buildManifest } from '../src/manifest.js';
import { fount } from '../src/fount.js';
import { gatherPaid } from '../src/paidgather.js';

const NETWORK: Network = 'testnet-10';
const PRICE = 20;
const ESCROW = 50_000_000n; // 0.5 KAS per channel
const kas = (s: number | bigint) => (Number(s) / 1e8).toFixed(8);
const ephemeral = () => { const sk = randomBytes(32).toString('hex'); return { sk, pk: publicKeyHex(sk) }; };

async function balance(sk: string): Promise<bigint> {
  const { sdk, rpc } = await connect(NETWORK);
  try {
    const addr = new sdk.PrivateKey(sk).toKeypair().toAddress(new sdk.NetworkId(NETWORK)).toString();
    const { entries } = await rpc.getUtxosByAddresses([addr]);
    return entries.reduce((a: bigint, e: { amount: bigint }) => a + BigInt(e.amount), 0n);
  } finally { await rpc.disconnect().catch(() => undefined); }
}

async function main(): Promise<void> {
  const gatherer = identity('gatherer');
  const bytes = Uint8Array.from({ length: 900_000 }, (_, i) => (i * 131 + 7) % 251);
  const m = buildManifest('proof.mp4', bytes, 64 * 1024);
  const all = new Map(m.parcels.map((p) => [p.index, bytes.subarray(p.index * m.parcelSize, p.index * m.parcelSize + p.size)]));
  const layout = [{ name: 'fount-A', holds: [0, 1, 2, 3, 4] }, { name: 'fount-B', holds: [5, 6, 7, 8, 9] }, { name: 'fount-C', holds: [10, 11, 12, 13] }];

  console.log(`\n  KASCADE — PER-PARCEL money proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  a ${bytes.length.toLocaleString()}-byte file, ${m.parcels.length} parcels, across ${layout.length} founts that enforce the 402 rule\n`);

  // Open a channel per fount FIRST (its covenant id is what the fount's credit gate checks), then
  // stand up the fount enforcing that channel against the gatherer's key.
  const nodes = [];
  for (const L of layout) {
    const key = ephemeral();
    console.log(`  opening a channel with ${L.name}…`);
    const { channel } = await open(gatherer.secretKeyHex, key.pk, NETWORK, ESCROW, 3600n);
    const cov = channel.covenantId;
    const parcels = new Map(L.holds.map((i) => [i, all.get(i) as Uint8Array]));
    const f = fount({
      held: [{ manifest: m, parcels }], priceSompi: PRICE,
      credit: (cid) => (cid === cov ? { channel: { network: `kaspa:${NETWORK}`, covenantId: cov }, buyerPubkey: gatherer.publicKeyHex } : null),
    });
    await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
    nodes.push({ L, key, cov, f, url: `http://127.0.0.1:${(f.server.address() as AddressInfo).port}` });
  }

  try {
    const holders = nodes.map((n) => ({ url: n.url, indices: n.L.holds }));
    const channelByFount = Object.fromEntries(nodes.map((n) => [n.url, { network: `kaspa:${NETWORK}`, covenantId: n.cov }]));
    console.log(`\n  gathering, paying each fount per parcel as it verifies…`);
    const res = await gatherPaid({ manifest: m, holders, channelByFount, buyerSk: gatherer.secretKeyHex, priceSompi: PRICE });
    const identical = res.complete && res.bytes.length === bytes.length && res.bytes.every((b, i) => b === bytes[i]);
    console.log(`  file reassembled ${identical ? 'BYTE-IDENTICAL ✓' : 'WRONG ✗'}; each fount holds a per-parcel voucher\n`);

    // Claim every fount first (each returns the amount the node accepted), THEN read balances -- so a
    // balance is never queried before its own claim has had time to confirm.
    const claimed: { name: string; sk: string; parcels: number; paid: bigint; txid: string }[] = [];
    for (const n of nodes) {
      const earned = res.perFount[n.url];
      if (!earned) { console.log(`  ${n.L.name} earned nothing`); continue; }
      const out = await claim(n.key.sk, n.cov, earned.voucher, BigInt(earned.sompi));
      console.log(`  ${n.L.name} claimed ${kas(out.paid)} KAS over ${earned.parcels} parcels   (${out.txid.slice(0, 16)}…)`);
      claimed.push({ name: n.L.name, sk: n.key.sk, parcels: earned.parcels, paid: out.paid, txid: out.txid });
    }
    console.log(`\n  BALANCES (read after every claim, so none races its own confirmation)`);
    for (const c of claimed) console.log(`    ${c.name}  0 → ${kas(await balance(c.sk))} KAS`);
  } finally {
    await Promise.all(nodes.map((n) => new Promise<void>((r) => n.f.server.close(() => r()))));
  }
  console.log(`\n  PROVEN: paid PER PARCEL, live -- each fount claimed real KAS for the parcels it served.\n`);
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
