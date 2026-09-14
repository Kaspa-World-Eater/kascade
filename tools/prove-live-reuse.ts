/**
 * Channel-reuse money proof, live on Kaspa testnet-10.
 *
 * ONE channel, TWO gathers. The first buys some parcels; the second buys the rest OVER THE SAME
 * CHANNEL, resuming the cumulative voucher ceiling instead of restarting it. Then the fount makes a
 * SINGLE on-chain claim of the final voucher and we check it collected for BOTH gathers at once.
 *
 * Before the fix, the second gather signed a ceiling below the first and the fount rejected it; a
 * reused channel was dead money. This driver is that scenario, unmocked, settling on chain.
 */
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { publicKeyHex } from 'metered-protocol';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { open, claim, CLAIM_FEE } from '../src/channel.js';
import { buildManifest } from '../src/manifest.js';
import { fount } from '../src/fount.js';
import { gatherPaid } from '../src/paidgather.js';

const NETWORK: Network = 'testnet-10';
const PRICE = 20;
const ESCROW = 50_000_000n; // 0.5 KAS
const kas = (s: number | bigint) => (Number(s) / 1e8).toFixed(8);

async function main(): Promise<void> {
  const gatherer = identity('gatherer');
  const bytes = Uint8Array.from({ length: 900_000 }, (_, i) => (i * 131 + 7) % 251);
  const m = buildManifest('proof.mp4', bytes, 64 * 1024); // ~14 parcels
  const all = new Map(m.parcels.map((p) => [p.index, bytes.subarray(p.index * m.parcelSize, p.index * m.parcelSize + p.size)]));
  const half = Math.ceil(m.parcels.length / 2);
  const firstHalf = m.parcels.slice(0, half).map((p) => p.index);
  const secondHalf = m.parcels.slice(half).map((p) => p.index);

  console.log(`\n  KASCADE — CHANNEL-REUSE money proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  one ${bytes.length.toLocaleString()}-byte file over ONE channel, gathered in two passes\n`);

  const sk = randomBytes(32).toString('hex');
  const fountPk = publicKeyHex(sk);
  console.log(`  opening one channel with the fount…`);
  const { channel } = await open(gatherer.secretKeyHex, fountPk, NETWORK, ESCROW, 3600n);
  const cov = channel.covenantId;
  const f = fount({
    held: [{ manifest: m, parcels: all }], priceSompi: PRICE,
    credit: (cid) => (cid === cov ? { channel: { network: `kaspa:${NETWORK}`, covenantId: cov }, buyerPubkey: gatherer.publicKeyHex } : null),
  });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  const channelByFount = { [url]: { network: `kaspa:${NETWORK}`, covenantId: cov } };

  try {
    console.log(`  gather 1: parcels [${firstHalf.join(',')}]…`);
    const g1 = await gatherPaid({ manifest: m, holders: [{ url, indices: firstHalf }], channelByFount, buyerSk: gatherer.secretKeyHex, priceSompi: PRICE });
    const spent1 = g1.perFount[url]?.sompi ?? 0;
    console.log(`    vouched ${Number(g1.perFount[url]?.voucher.amount)} sompi (${kas(spent1)} KAS)`);

    console.log(`  gather 2 on the SAME channel: parcels [${secondHalf.join(',')}]…`);
    const g2 = await gatherPaid({ manifest: m, holders: [{ url, indices: secondHalf }], channelByFount, buyerSk: gatherer.secretKeyHex, priceSompi: PRICE, vouchedByFount: { [url]: spent1 } });
    const finalVoucher = g2.perFount[url]?.voucher;
    const ceiling = Number(finalVoucher?.amount);
    console.log(`    resumed to ${ceiling} sompi (${kas(ceiling)} KAS) — cumulative, not restarted`);

    const expected = spent1 + (g2.perFount[url]?.sompi ?? 0);
    const resumed = ceiling === expected;
    console.log(`\n  ceiling is cumulative over both gathers: ${resumed ? 'YES ✓' : 'NO ✗'} (${ceiling} vs ${expected})`);

    console.log(`  fount claims the single final voucher on chain…`);
    const out = await claim(sk, cov, finalVoucher!, BigInt(ceiling));
    console.log(`    claimed ${kas(out.paid)} KAS in one settlement, net of the ${kas(CLAIM_FEE)} KAS claim fee  (${out.txid})`);
    const oneClaimCoversBoth = out.paid === BigInt(ceiling) - CLAIM_FEE;
    console.log(`\n  RESULT: reuse ${resumed && oneClaimCoversBoth ? 'PROVEN — one channel, two gathers, one cumulative claim ✓' : 'FAILED ✗'}\n`);
    process.exit(resumed && oneClaimCoversBoth ? 0 : 1);
  } finally {
    await new Promise<void>((r) => f.server.close(() => r()));
  }
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
