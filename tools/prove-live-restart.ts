/**
 * Fount-restart survival, live on Kaspa testnet-10.
 *
 * A channel is opened and half a file gathered from a PAID fount (paidFountOptions). Then the fount
 * is RESTARTED — a fresh fount instance with empty in-memory maps, on a new port — and the second
 * half is gathered over the SAME channel, then claimed in one settlement.
 *
 * This proves the persistence added for reuse: accepted channels are stored on disk (so a restarted
 * fount still serves them), and the per-parcel creditline resumes from the channel's stored voucher
 * ceiling (so a restarted fount is not tricked into extending free credit). Nothing mocked.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Network } from 'metered-protocol/rail';
import { identity } from '../src/keys.js';
import { stock, type StockFile } from '../src/stock.js';
import { fount } from '../src/fount.js';
import { paidFountOptions, openChannelWith } from '../src/paidcli.js';
import { gatherPaid } from '../src/paidgather.js';
import { claim, bumpVouched, vouchedOn, CLAIM_FEE } from '../src/channel.js';

const NETWORK: Network = 'testnet-10';
const PRICE = 20;
const ESCROW = 50_000_000n; // 0.5 KAS
const CAP = 64 * 1024 * 1024;
const kas = (s: number | bigint) => (Number(s) / 1e8).toFixed(8);

function startFount(files: StockFile[]): Promise<{ f: { server: Server }; url: string }> {
  const f = fount(paidFountOptions(files, NETWORK, PRICE, CAP));
  return new Promise((res) => f.server.listen(0, '127.0.0.1', () => res({ f, url: `http://127.0.0.1:${(f.server.address() as AddressInfo).port}` })));
}

async function main(): Promise<void> {
  const gathererSk = identity('gatherer').secretKeyHex;
  const fountSk = identity('fount').secretKeyHex;
  const bytes = Uint8Array.from({ length: 900_000 }, (_, i) => (i * 131 + 7) % 251);
  const files: StockFile[] = [{ name: 'proof.mp4', bytes }];
  const m = stock(files, CAP).held[0]?.manifest;
  if (!m) throw new Error('nothing stocked');
  const half = Math.ceil(m.parcels.length / 2);
  const firstHalf = m.parcels.slice(0, half).map((p) => p.index);
  const secondHalf = m.parcels.slice(half).map((p) => p.index);
  const netTag = `kaspa:${NETWORK}`;

  console.log(`\n  KASCADE — FOUNT-RESTART survival proof, live on Kaspa ${NETWORK}\n`);
  console.log(`  ${m.parcels.length} parcels; gather half, RESTART the fount, gather the rest on the same channel\n`);

  let { f, url } = await startFount(files);
  console.log(`  fount up on ${url}; opening a channel…`);
  const { covenantId: cov } = await openChannelWith(url, NETWORK, ESCROW, 3600n);

  console.log(`  gather 1 (parcels [${firstHalf.join(',')}])…`);
  const g1 = await gatherPaid({ manifest: m, holders: [{ url, indices: firstHalf }], channelByFount: { [url]: { network: netTag, covenantId: cov } }, buyerSk: gathererSk, priceSompi: PRICE });
  const spent1 = g1.perFount[url]?.sompi ?? 0;
  bumpVouched(cov, spent1);
  console.log(`    vouched ${spent1} sompi; now RESTARTING the fount (new process, empty memory)…`);

  await new Promise<void>((r) => f.server.close(() => r()));
  ({ f, url } = await startFount(files)); // fresh instance, new port, only the DISK survives
  console.log(`  fount back up on ${url} (a different port — nothing in memory carried over)`);

  console.log(`  gather 2 on the SAME channel (parcels [${secondHalf.join(',')}])…`);
  const g2 = await gatherPaid({ manifest: m, holders: [{ url, indices: secondHalf }], channelByFount: { [url]: { network: netTag, covenantId: cov } }, buyerSk: gathererSk, priceSompi: PRICE, vouchedByFount: { [url]: vouchedOn(cov) } });
  const finalVoucher = g2.perFount[url]?.voucher;
  const ceiling = Number(finalVoucher?.amount);
  const expected = spent1 + (g2.perFount[url]?.sompi ?? 0);
  const resumed = ceiling === expected;
  console.log(`    resumed to ${ceiling} sompi across the restart: ${resumed ? 'YES ✓' : 'NO ✗'} (expected ${expected})`);

  console.log(`  fount claims the cumulative voucher on chain…`);
  const out = await claim(fountSk, cov, finalVoucher!, BigInt(ceiling));
  console.log(`    claimed ${kas(out.paid)} KAS, net of the ${kas(CLAIM_FEE)} KAS claim fee  (${out.txid})`);
  const claimOk = out.paid === BigInt(ceiling) - CLAIM_FEE;

  await new Promise<void>((r) => f.server.close(() => r()));
  const ok = resumed && claimOk;
  console.log(`\n  RESULT: restart survival ${ok ? 'PROVEN — a restarted fount served and claimed a channel opened before the restart ✓' : 'FAILED ✗'}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
