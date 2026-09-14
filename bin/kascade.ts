/**
 * `kascade` — run a fount, a tracker, gather a file, or watch the whole Meridian prove itself.
 *
 *   kascade demo                              a whole Meridian, live, in one process (the proof)
 *   kascade tracker [--port N]                run a tracker: who holds which parcels
 *   kascade fount <dir> --tracker <url> [--price N] [--port N]   serve a directory of files
 *   kascade get <trackerUrl> <fileId> [--out FILE] [--price N]   gather a file from the Meridian
 *   kascade wallet [--role gatherer|fount]    your address and on-chain balance
 *   kascade fund [--role ...] [--min KAS]     print the address to fund, then wait for it to arrive
 *   kascade app [--port N]                    a local browser control panel for all of the above
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fount, type FountOptions } from '../src/fount.js';
import { trackerServer, announceTo, discover } from '../src/tracker.js';
import { fetchFile } from '../src/consumer.js';
import { runDemo } from '../src/demo.js';
import { stock } from '../src/stock.js';
import { channels as openChannels } from '../src/channel.js';
import type { Network } from 'metered-protocol/rail';
import { paidFountOptions, openChannelWith, getPaid, claimStored, ensureChannels, refundChannel } from '../src/paidcli.js';
import { seed } from '../src/seed.js';
import { walletState, awaitFunds, faucetFor } from '../src/wallet.js';
import type { Role } from '../src/keys.js';
import { webapp } from '../src/webapp.js';
import { startDhtNode, holdersViaDht, dhtClient, peerOf } from '../src/dhtserver.js';
import { idFromHex } from '../src/distance.js';
import { printDemo } from '../src/demoprint.js';
import { kas } from '../src/format.js';

const argv = process.argv.slice(2);
const [command, ...rest] = argv;
const flag = (name: string, fb: string): string => { const i = argv.indexOf(`--${name}`); return i === -1 ? fb : argv[i + 1] ?? fb; };
const has = (name: string): boolean => argv.includes(`--${name}`);
const num = (name: string, fb: number): number => Number(flag(name, String(fb)));
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
const NET = flag('network', 'testnet-10') as Network;
const port = (s: { address: () => unknown }): number => (s.address() as AddressInfo).port;

async function demo(): Promise<void> { printDemo(await runDemo()); }

async function tracker(): Promise<void> {
  const t = trackerServer();
  await new Promise<void>((r) => t.server.listen(num('port', 0), '127.0.0.1', r));
  console.log(`\n  tracker on http://127.0.0.1:${port(t.server)}   (Ctrl+C to stop)\n`);
}

/** Load every non-empty file in a directory into a fount, and announce what it holds. */
async function serveFount(): Promise<void> {
  const dir = positional[0];
  const trackerUrl = flag('tracker', '');
  const dhtUrl = flag('dht', '');
  if (!dir || (!trackerUrl && !dhtUrl)) { console.error('usage: kascade fount <dir> (--tracker <url> | --dht <nodeUrl>) [--price N]'); process.exit(1); }
  const root = resolve(dir);
  const names = readdirSync(root).filter((f) => { const s = statSync(join(root, f)); return s.isFile() && s.size > 0; });
  const files = names.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(root, name))) }));
  const capBytes = num('cap', 1024) * 1024 * 1024; // --cap in MB, default 1 GB; the fount never holds more
  const price = num('price', 2);
  const base: FountOptions = has('paid')
    ? paidFountOptions(files, NET, price, capBytes)
    : { held: stock(files, capBytes, num('parcel', 64 * 1024)).held, priceSompi: price };
  const options: FountOptions = has('accept') ? { ...base, acceptBytes: num('accept', 512) * 1024 * 1024 } : base;
  const f = fount(options);
  await new Promise<void>((r) => f.server.listen(num('port', 0), '127.0.0.1', r));
  const url = `http://127.0.0.1:${port(f.server)}`;
  if (trackerUrl) for (const h of options.held) await announceTo(trackerUrl, h.manifest.fileId, url, [...h.parcels.keys()]);
  if (dhtUrl) { const c = await dhtClient(dhtUrl, `fount-${url}`); for (const h of options.held) await c.announce(idFromHex(h.manifest.fileId), url); }
  console.log(`\n  fount on ${url}  —  ${options.held.length} file(s) at ${price} sompi/byte${has('paid') ? ', PAID (a channel is required)' : ' (free)'}`);
  for (const h of options.held) console.log(`    ${h.manifest.fileId.slice(0, 16)}…  ${h.manifest.name}  (${h.parcels.size}/${h.manifest.parcels.length} parcels)`);
  console.log('');
}

async function get(): Promise<void> {
  const dhtUrl = flag('dht', '');
  const [p0, p1] = positional;
  const fileId = (dhtUrl ? p0 : p1) ?? '';
  const trackerUrl = (dhtUrl ? '' : p0) ?? '';
  if (!fileId || (!dhtUrl && !trackerUrl)) { console.error('usage: kascade get <trackerUrl> <fileId>  |  kascade get --dht <nodeUrl> <fileId>  [--pay [--auto]] [--out FILE]'); process.exit(1); }

  const dhtHolders = dhtUrl ? await holdersViaDht(await dhtClient(dhtUrl, 'seeker'), fileId) : undefined;
  if (dhtHolders && dhtHolders.length === 0) { console.error('no founts hold that file (per the DHT)'); process.exit(1); }

  if (has('pay')) {
    if (has('auto')) {
      const urls = (dhtHolders ?? await discover(trackerUrl, fileId)).map((h) => h.url);
      const opened = await ensureChannels(urls, NET, BigInt(Math.round(Number(flag('escrow', '0.5')) * 1e8)), BigInt(num('window', 3600)));
      if (opened) console.log(`
  opened ${opened} channel(s) for this gather`);
    }
    const res = await getPaid(trackerUrl, fileId, NET, num('price', 2), dhtHolders);
    if (res.complete) writeFileSync(flag('out', 'download.bin'), res.bytes);
    const paid = Object.values(res.perFount).reduce((n, p) => n + p.sompi, 0);
    console.log(`
  paid gather ${res.complete ? 'complete' : 'INCOMPLETE'} across ${Object.keys(res.perFount).length} fount(s)`);
    console.log(`  paid ${paid.toLocaleString()} sompi (${kas(paid)} KAS), per parcel${dhtUrl ? ', discovered via the DHT' : ''}
`);
    process.exit(0);
  }
  const holders = dhtHolders ?? await discover(trackerUrl, fileId);
  const anyUrl = holders[0]?.url;
  if (!anyUrl) { console.error('no founts hold that file'); process.exit(1); }
  const manifest = await (await fetch(`${anyUrl}/kascade/manifest?file=${fileId}`)).json();
  const { bytes, receipt } = await fetchFile({ manifest, holders, priceSompi: num('price', 2), concurrency: 4 });
  if (receipt.complete) writeFileSync(flag('out', manifest.name), bytes);
  console.log(`
  gathered ${receipt.parcelsGot}/${manifest.parcels.length} parcels; ${receipt.complete ? 'wrote it' : 'INCOMPLETE'}${dhtUrl ? ' (via DHT)' : ''}
`);
  process.exit(0);
}

async function channel(): Promise<void> {
  if (positional[0] !== 'open' || !positional[1]) { console.error('usage: kascade channel open <fountUrl> [--escrow KAS]'); process.exit(1); }
  const escrow = BigInt(Math.round(Number(flag('escrow', '0.5')) * 1e8));
  console.log(`\n  opening a ${kas(escrow)} KAS channel with ${positional[1]}…`);
  const { covenantId, genesisTxid } = await openChannelWith(positional[1], NET, escrow, BigInt(num('window', 3600)));
  console.log(`  genesis    ${genesisTxid}\n  covenantId ${covenantId}\n  now: kascade get <tracker> <fileId> --pay\n`);
  process.exit(0);
}

async function channelsList(): Promise<void> {
  const rows = openChannels();
  if (rows.length === 0) { console.log('\n  no channels. Open one: kascade channel open <fountUrl>\n'); process.exit(0); }
  console.log('');
  for (const r of rows) console.log(`    ${r.channel.covenantId}   ${kas(r.channel.active.amount)} KAS left   with ${r.sellerPubkey.slice(0, 16)}…`);
  console.log('');
  process.exit(0);
}

async function claimCmd(): Promise<void> {
  const cov = positional[0];
  if (!cov) { console.error('usage: kascade claim <covenantId>'); process.exit(1); }
  const out = await claimStored(cov);
  console.log(`\n  claimed ${kas(out.paid)} KAS  (${out.txid})\n`);
  process.exit(0);
}

async function refundCmd(): Promise<void> {
  const cov = positional[0];
  if (!cov) { console.error('usage: kascade refund <covenantId>'); process.exit(1); }
  console.log(`\n  refunding channel ${cov.slice(0, 16)}… once its timeout passes (this waits)`);
  const out = await refundChannel(cov);
  console.log(`  ${out.txid}\n  ${kas(out.refunded)} KAS back to the gatherer\n`);
  process.exit(0);
}

async function publish(): Promise<void> {
  const filePath = positional[0];
  const to = flag('to', '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!filePath || to.length === 0) { console.error('usage: kascade publish <file> --to <fountUrl[,fountUrl...]> [--tracker <url>]'); process.exit(1); }
  const r = await seed(filePath, to, flag('tracker', '') || undefined, num('parcel', 64 * 1024));
  console.log(`
  seeded ${r.name} (${r.parcels} parcels) to ${to.length} fount(s)`);
  console.log(`  fileId ${r.fileId}
  now: kascade get <tracker> ${r.fileId}
`);
  process.exit(0);
}

async function walletCmd(): Promise<void> {
  const role = flag('role', 'gatherer') as Role;
  const w = await walletState(role, NET);
  console.log(`
  ${role} wallet`);
  console.log(`  key      ${w.file}`);
  console.log(`  address  ${w.address}`);
  console.log(`  balance  ${kas(w.balanceSompi)} KAS  (${w.utxos} utxo${w.utxos === 1 ? '' : 's'})`);
  const f = faucetFor(NET);
  if (w.balanceSompi === 0n && f) console.log(`  empty — fund it: ${f}`);
  console.log('');
  process.exit(0);
}

async function fundCmd(): Promise<void> {
  const role = flag('role', 'gatherer') as Role;
  const min = BigInt(Math.round(Number(flag('min', '0.5')) * 1e8));
  const w0 = await walletState(role, NET);
  console.log(`
  fund the ${role}:

    ${w0.address}
`);
  const f = faucetFor(NET);
  if (f) console.log(`  testnet faucet: ${f}
`);
  if (w0.balanceSompi >= min) { console.log(`  already funded: ${kas(w0.balanceSompi)} KAS
`); process.exit(0); }
  console.log(`  waiting for at least ${kas(min)} KAS to arrive (Ctrl+C to stop)…`);
  const w = await awaitFunds(role, NET, min);
  console.log(`  funded: ${kas(w.balanceSompi)} KAS
`);
  process.exit(0);
}

async function appCmd(): Promise<void> {
  const a = webapp(NET);
  await new Promise<void>((r) => a.server.listen(num('port', 4173), '127.0.0.1', r));
  console.log(`
  kascade app on http://127.0.0.1:${port(a.server)}   (Ctrl+C to stop)`);
  console.log(`  buyer/operator panel on ${NET}. The passive phone app is not built.
`);
}

async function dhtnode(): Promise<void> {
  const boot = flag('bootstrap', '');
  const { url, node } = await startDhtNode(boot ? [peerOf(boot)] : [], num('port', 0));
  if (boot) await node.join(peerOf(boot));
  console.log(`
  DHT node on ${url}${boot ? `  (joined via ${boot})` : '  (bootstrap)'}   (Ctrl+C to stop)
`);
}

const COMMANDS: Record<string, () => Promise<void>> = { demo, tracker, fount: serveFount, get, publish, channel, channels: channelsList, claim: claimCmd, refund: refundCmd, wallet: walletCmd, fund: fundCmd, app: appCmd, dhtnode };
const run = COMMANDS[command ?? ''];
if (!run) { console.error('kascade: demo | tracker | fount [--paid] | publish <file> --to <urls> | get [--pay] | wallet | fund | app | dhtnode | channel open | channels | claim | refund'); process.exit(1); }
run().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
