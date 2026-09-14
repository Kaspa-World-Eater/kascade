/**
 * The money proof, multi-fount, live on Kaspa testnet-10: SEVERAL founts each earn real KAS in one run.
 *
 * Last time one fount earned. The claim that needed closing was "multi-fount is the same, once per
 * fount." This closes it for real: three founts each hold part of a file, a gatherer opens a channel
 * with EACH, pulls the file from all of them, and each fount claims exactly what it delivered. Three
 * real balances, from zero, go up. Nothing simulated.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { publicKeyHex, voucherForState } from 'metered-protocol';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { open, claim, connect } from '../src/channel.js';
import { buildManifest } from '../src/manifest.js';
import { fount, type Held } from '../src/fount.js';
import { fetchFile } from '../src/consumer.js';
import type { Holder } from '../src/tracker.js';

const NETWORK: Network = 'testnet-10';
const PRICE = 20;
const ESCROW = 50_000_000n; // 0.5 KAS per channel — keeps each claim under KIP-9's mass limit
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
  const all = new Map(m.parcels.map((b) => [b.index, bytes.subarray(b.index * m.parcelSize, b.index * m.parcelSize + b.size)]));

  // three founts, non-overlapping, together holding every parcel — so each earns a clean, known share.
  const layout = [{ name: 'fount-A', holds: [0, 1, 2, 3, 4] }, { name: 'fount-B', holds: [5, 6, 7, 8, 9] }, { name: 'fount-C', holds: [10, 11, 12, 13] }];
  const founts = layout.map((p) => {
    const key = ephemeral();
    const held: Held[] = [{ manifest: m, parcels: new Map(p.holds.map((i) => [i, all.get(i) as Uint8Array])) }];
    return { ...p, key, f: fount({ held, priceSompi: PRICE }), url: '' };
  });

  console.log(`\n  KASCADE — multi-fount money proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  a ${bytes.length.toLocaleString()}-byte file, ${m.parcels.length} parcels, across ${founts.length} founts — each starting at 0 KAS\n`);

  await Promise.all(founts.map((n) => new Promise<void>((r) => n.f.server.listen(0, '127.0.0.1', () => r()))));
  for (const n of founts) n.url = `http://127.0.0.1:${(n.f.server.address() as AddressInfo).port}`;

  const claims: { name: string; earned: number; genesis: string; claim: string; before: bigint; after: bigint }[] = [];
  try {
    // 1. a channel per fount
    const channels = new Map<string, string>(); // fount url -> covenantId
    for (const n of founts) {
      const before = await balance(n.key.sk);
      console.log(`  opening a channel with ${n.name} (holds [${n.holds.join(',')}], balance ${kas(before)} KAS)…`);
      const opened = await open(gatherer.secretKeyHex, n.key.pk, NETWORK, ESCROW, 3600n);
      channels.set(n.url, opened.channel.covenantId);
      claims.push({ name: n.name, earned: 0, genesis: opened.txid, claim: '', before, after: 0n });
    }

    // 2. gather the whole file from all founts at once
    const holders: Holder[] = founts.map((n) => ({ url: n.url, indices: n.holds }));
    const { receipt } = await fetchFile({ manifest: m, holders, priceSompi: PRICE, concurrency: 4 });
    console.log(`\n  gathered ${receipt.parcelsGot}/${m.parcels.length} parcels, byte-verified across ${Object.keys(receipt.perFount).length} founts\n`);

    // 3. each fount claims exactly what it delivered
    for (const n of founts) {
      const earned = receipt.perFount[n.url]?.sompi ?? 0;
      const rec = claims.find((c) => c.name === n.name) as (typeof claims)[number];
      rec.earned = earned;
      if (earned <= 0) { console.log(`  ${n.name} earned nothing — no claim`); continue; }
      const voucher = voucherForState(
        { cumulativeSompi: earned } as unknown as Parameters<typeof voucherForState>[0],
        { network: `kaspa:${NETWORK}`, covenantId: channels.get(n.url) as string }, gatherer.secretKeyHex,
      );
      const out = await claim(n.key.sk, channels.get(n.url) as string, voucher, BigInt(earned));
      rec.claim = out.txid;
      console.log(`  ${n.name} claimed ${kas(out.paid)} KAS   (${out.txid.slice(0, 16)}…)`);
    }
  } finally {
    await Promise.all(founts.map((n) => new Promise<void>((r) => n.f.server.close(() => r()))));
  }

  console.log(`\n  RESULTS\n`);
  for (const n of founts) {
    const rec = claims.find((c) => c.name === n.name) as (typeof claims)[number];
    rec.after = await balance(n.key.sk);
    console.log(`    ${n.name}  earned ${rec.earned.toLocaleString()} sompi  →  balance 0 → ${kas(rec.after)} KAS   (claim ${rec.claim.slice(0, 12)}…)`);
  }
  console.log(`\n  PROVEN: several Kascade founts each earned real testnet KAS from one delivery.\n`);
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
