/**
 * The money proof, live on Kaspa testnet-10: a fount earns real KAS for parcels it delivered.
 *
 * Nothing here is simulated. A gatherer opens a real kaspa-x402 channel with a fount, pulls a real
 * file over HTTP, verifies every parcel against the manifest, signs a voucher for exactly what the
 * fount delivered, and the fount CLAIMS it on chain. The reward is a transaction id and a balance
 * that went up. This is Cascade's delivery feeding the same rail spigot and flume proved.
 *
 * Multi-fount is this, once per fount -- the gatherer holds one channel per fount it pulls from.
 */
import type { AddressInfo } from 'node:net';
import { voucherForState } from 'metered-protocol';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { open, claim, connect } from '../src/channel.js';
import { buildManifest } from '../src/manifest.js';
import { fount, type Held } from '../src/fount.js';
import { fetchFile } from '../src/consumer.js';
import type { Holder } from '../src/tracker.js';

const NETWORK: Network = 'testnet-10';
const PRICE = 20;                // sompi per byte
const ESCROW = 50_000_000n;      // 0.5 KAS channel -- large float keeps the claim under KIP-9's mass limit
const kas = (s: number | bigint) => (Number(s) / 1e8).toFixed(8);

async function balance(addressSk: string): Promise<bigint> {
  const { sdk, rpc } = await connect(NETWORK);
  try {
    const addr = new sdk.PrivateKey(addressSk).toKeypair().toAddress(new sdk.NetworkId(NETWORK)).toString();
    const { entries } = await rpc.getUtxosByAddresses([addr]);
    return entries.reduce((a: bigint, e: { amount: bigint }) => a + BigInt(e.amount), 0n);
  } finally { await rpc.disconnect().catch(() => undefined); }
}

async function main(): Promise<void> {
  const gatherer = identity('gatherer');
  const fountId = identity('fount');
  const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 131 + 7) % 251);
  const m = buildManifest('proof.mp4', bytes, 64 * 1024);
  const all = new Map(m.parcels.map((b) => [b.index, bytes.subarray(b.index * m.parcelSize, b.index * m.parcelSize + b.size)]));
  const owed = bytes.length * PRICE; // what the fount will have earned, in sompi

  console.log(`\n  CASCADE — money proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  gatherer ${gatherer.publicKeyHex.slice(0, 16)}…   fount ${fountId.publicKeyHex.slice(0, 16)}…`);
  const before = await balance(fountId.secretKeyHex);
  console.log(`  fount balance before: ${kas(before)} KAS\n`);

  // 1. a real fount serving the file
  const held: Held[] = [{ manifest: m, parcels: all }];
  const f = fount({ held, priceSompi: PRICE });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;

  try {
    // 2. the gatherer opens a real channel with the fount
    console.log(`  opening a ${kas(ESCROW)} KAS channel with the fount…`);
    const { channel, txid: genesis } = await open(gatherer.secretKeyHex, fountId.publicKeyHex, NETWORK, ESCROW, 3600n);
    console.log(`  genesis    ${genesis}\n  covenantId ${channel.covenantId}`);

    // 3. gather the file, verifying every parcel
    const holders: Holder[] = [{ url, indices: m.parcels.map((b) => b.index) }];
    const { receipt } = await fetchFile({ manifest: m, holders, priceSompi: PRICE, concurrency: 3 });
    const earned = receipt.perFount[url]?.sompi ?? 0;
    console.log(`\n  delivered ${receipt.parcelsGot}/${m.parcels.length} parcels, byte-verified; fount earned ${earned.toLocaleString()} sompi (${kas(earned)} KAS)`);
    if (earned !== owed) throw new Error(`accounting mismatch: earned ${earned}, expected ${owed}`);

    // 4. sign a voucher for exactly what was delivered
    const voucher = voucherForState(
      { cumulativeSompi: earned } as unknown as Parameters<typeof voucherForState>[0],
      { network: `kaspa:${NETWORK}`, covenantId: channel.covenantId },
      gatherer.secretKeyHex,
    );
    console.log(`  voucher signed for ${voucher.amount} sompi`);

    // 5. the fount claims it on chain
    console.log(`\n  fount claiming…`);
    const claimed = await claim(fountId.secretKeyHex, channel.covenantId, voucher, BigInt(earned));
    console.log(`  claim      ${claimed.txid}\n  paid to the fount: ${kas(claimed.paid)} KAS (the earning less the claim fee)`);
  } finally {
    await new Promise<void>((r) => f.server.close(() => r()));
  }

  const after = await balance(fountId.secretKeyHex);
  console.log(`\n  fount balance after:  ${kas(after)} KAS   (+${kas(after - before)} KAS)`);
  console.log(`\n  PROVEN: a Cascade fount delivered a file and earned real testnet KAS for it.\n`);
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
