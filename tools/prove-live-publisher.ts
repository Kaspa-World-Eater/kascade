/**
 * Publisher-pays, live on Kaspa testnet-10 — the market the site describes, on chain.
 *
 * A PUBLISHER funds a budget (a channel with the fount). A VIEWER with an ephemeral key and NO funds
 * gathers the file for free over the receipt handshake, signing a receipt per verified parcel. The
 * publisher checks those receipts and signs one voucher for what the fount earned; the fount claims it
 * on chain. The viewer never opens a channel and never pays a sompi — the budget is the only money.
 *
 * Honest limit (see receipt.ts): this proves the mechanism, not sybil-resistance. A colluding fount +
 * fake viewer could mint receipts against a budget; signatures cannot tell a real consumer apart.
 */
import { randomBytes } from 'node:crypto';
import { voucherForState, publicKeyHex } from 'metered-protocol';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { open, claim, CLAIM_FEE } from '../src/channel.js';
import { buildManifest } from '../src/manifest.js';
import { fount } from '../src/fount.js';
import { receiptPull } from '../src/receiptgather.js';
import { tallyReceipts, settlePublisherPays } from '../src/publisherpays.js';
import type { AddressInfo } from 'node:net';

const NETWORK: Network = 'testnet-10';
const PRICE = 20; // sompi/byte
const BUDGET = 50_000_000n; // 0.5 KAS locked by the publisher
const kas = (s: number | bigint) => (Number(s) / 1e8).toFixed(8);


async function main(): Promise<void> {
  const publisher = identity('gatherer'); // the funded key plays the PUBLISHER here
  const fountKey = randomBytes(32).toString('hex');
  const fountPk = publicKeyHex(fountKey);
  const viewerSk = randomBytes(32).toString('hex'); // ephemeral, UNFUNDED -- it never pays
  const viewerPk = publicKeyHex(viewerSk);

  const bytes = Uint8Array.from({ length: 900_000 }, (_, i) => (i * 131 + 7) % 251);
  const m = buildManifest('proof.mp4', bytes, 64 * 1024);
  const all = new Map(m.parcels.map((p) => [p.index, bytes.subarray(p.index * m.parcelSize, p.index * m.parcelSize + p.size)]));

  console.log(`\n  KASCADE — PUBLISHER-PAYS money proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  publisher funds a budget; an UNFUNDED viewer gathers free; the fount claims from the publisher\n`);

  // A publisher-pays fount: free to the viewer, receipts collected.
  const f = fount({ held: [{ manifest: m, parcels: all }], priceSompi: PRICE, publisherPays: true });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;

  try {
    console.log(`  publisher opens a ${kas(BUDGET)} KAS budget channel with the fount…`);
    const { channel } = await open(publisher.secretKeyHex, fountPk, NETWORK, BUDGET, 3600n);
    const cov = channel.covenantId;

    console.log(`  viewer (${viewerPk.slice(0, 12)}…, no wallet) gathers ${m.parcels.length} parcels over the receipt handshake…`);
    const pulled = await receiptPull({ fountUrl: url, manifest: m, indices: m.parcels.map((p) => p.index), viewerSk, viewerPubkey: viewerPk });
    const identical = pulled.parcels.size === m.parcels.length;
    console.log(`  got ${pulled.parcels.size}/${m.parcels.length} parcels, ${pulled.receipts.length} receipts; file ${identical ? 'complete ✓' : 'INCOMPLETE ✗'}`);

    // The publisher verifies the receipts and signs ONE voucher for what the fount earned.
    const { perFount } = tallyReceipts(m, pulled.receipts, viewerPk, PRICE);
    const plan = settlePublisherPays({ budgetSompi: Number(BUDGET), perFount, faults: [], dustSompi: 0 });
    const earned = plan.pay[0]?.sompi ?? 0;
    console.log(`  publisher owes the fount ${earned} sompi (${kas(earned)} KAS); viewer paid ${kas(plan.viewerPaidSompi)} KAS`);
    const voucher = voucherForState({ cumulativeSompi: earned } as never, { network: `kaspa:${NETWORK}`, covenantId: cov }, publisher.secretKeyHex);

    console.log(`  fount claims the publisher's voucher on chain…`);
    const out = await claim(fountKey, cov, voucher, BigInt(earned));
    console.log(`    claimed ${kas(out.paid)} KAS, net of the ${kas(CLAIM_FEE)} KAS fee  (${out.txid})`);

    const ok = identical && plan.viewerPaidSompi === 0 && out.paid === BigInt(earned) - CLAIM_FEE;
    console.log(`\n  RESULT: publisher-pays ${ok ? 'PROVEN — viewer paid zero; the fount was paid from the publisher on chain ✓' : 'FAILED ✗'}\n`);
    process.exit(ok ? 0 : 1);
  } finally {
    await new Promise<void>((r) => f.server.close(() => r()));
  }
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
