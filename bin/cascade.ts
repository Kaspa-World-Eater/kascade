/**
 * `cascade` — run a fount, a tracker, gather a file, or watch the whole Meridian prove itself.
 *
 *   cascade demo                              a whole Meridian, live, in one process (the proof)
 *   cascade tracker [--port N]                run a tracker: who holds which parcels
 *   cascade fount <dir> --tracker <url> [--price N] [--port N]   serve a directory of files
 *   cascade get <trackerUrl> <fileId> [--out FILE] [--price N]   gather a file from the Meridian
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fount, type FountOptions } from '../src/fount.js';
import { trackerServer, announceTo, discover } from '../src/tracker.js';
import { fetchFile } from '../src/consumer.js';
import { runDemo, type DemoResult } from '../src/demo.js';
import { stock } from '../src/stock.js';
import { channels as openChannels } from '../src/channel.js';
import type { Network } from 'metered-protocol/rail';
import { paidFountOptions, openChannelWith, getPaid, claimStored, ensureChannels, refundChannel } from '../src/paidcli.js';
import { seed } from '../src/seed.js';

const argv = process.argv.slice(2);
const [command, ...rest] = argv;
const flag = (name: string, fb: string): string => { const i = argv.indexOf(`--${name}`); return i === -1 ? fb : argv[i + 1] ?? fb; };
const has = (name: string): boolean => argv.includes(`--${name}`);
const num = (name: string, fb: number): number => Number(flag(name, String(fb)));
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
const NET = flag('network', 'testnet-10') as Network;
const kas = (sompi: number | bigint): string => (Number(sompi) / 1e8).toFixed(8);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const port = (s: { address: () => unknown }): number => (s.address() as AddressInfo).port;

function printDemo(d: DemoResult): void {
  const faultIdx = new Set(d.faults.map((f) => f.index));
  console.log(`\n  CASCADE — live proof, one machine, nothing mocked\n`);
  console.log(`  A ${d.fileBytes.toLocaleString()}-byte file, split into ${d.parcelCount} parcels, across ${d.founts.length} founts (one lying).\n`);
  console.log('  FOUNTS');
  for (const f of d.founts) console.log(`    ${pad(f.name, 12)} holds [${f.holds.join(',')}]${f.honest ? '' : '   ← serves corrupted bytes'}`);
  console.log('\n  GATHER  (parallel; every parcel verified against the manifest before it is believed or paid)');
  for (const t of d.trace) {
    const caught = faultIdx.has(t.index) ? '   (fount-LIAR tried first, REJECTED — hash mismatch)' : '';
    console.log(`    parcel ${pad(String(t.index), 2)} ← ${pad(t.from, 12)}${caught}`);
  }
  console.log(`\n  JUNK CAUGHT   fount-LIAR failed the manifest on parcels [${d.faults.map((f) => f.index).join(', ')}] — rerouted, earns nothing.`);
  console.log(`\n  RESULT        file reassembled ${d.byteIdentical ? 'BYTE-IDENTICAL  ✓  (sha256 matches the source)' : 'WRONG  ✗'}`);
  console.log('\n  EARNINGS  (verified parcels only)');
  for (const e of d.earnings) console.log(`    ${pad(e.fount, 12)} ${e.parcels} parcels   ${e.sompi.toLocaleString()} sompi`);
  console.log(`    ${pad('fount-LIAR', 12)} 0 parcels   0 sompi   (caught)`);
  console.log(`    total: ${d.totalPaidSompi.toLocaleString()} sompi (${kas(d.totalPaidSompi)} KAS)`);
  console.log('\n  SETTLEMENT ON THE RAIL  (one voucher per fount; the liar is slashed, not paid)');
  for (const p of d.settlement.pay) console.log(`    PAY    ${pad(p.url, 12)} → ${p.channel}   ${p.sompi.toLocaleString()} sompi`);
  for (const s of d.settlement.slash) console.log(`    SLASH  ${pad(s.url, 12)} (${s.faults} fault${s.faults === 1 ? '' : 's'})`);
  console.log('');
}

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
  if (!dir || !trackerUrl) { console.error('usage: cascade fount <dir> --tracker <url> [--price N]'); process.exit(1); }
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
  for (const h of options.held) await announceTo(trackerUrl, h.manifest.fileId, url, [...h.parcels.keys()]);
  console.log(`\n  fount on ${url}  —  ${options.held.length} file(s) at ${price} sompi/byte${has('paid') ? ', PAID (a channel is required)' : ' (free)'}`);
  for (const h of options.held) console.log(`    ${h.manifest.fileId.slice(0, 16)}…  ${h.manifest.name}  (${h.parcels.size}/${h.manifest.parcels.length} parcels)`);
  console.log('');
}

async function get(): Promise<void> {
  const [trackerUrl, fileId] = positional;
  if (!trackerUrl || !fileId) { console.error('usage: cascade get <trackerUrl> <fileId> [--out FILE] [--pay]'); process.exit(1); }
  if (has('pay')) {
    if (has('auto')) {
      const urls = (await discover(trackerUrl, fileId)).map((h) => h.url);
      const opened = await ensureChannels(urls, NET, BigInt(Math.round(Number(flag('escrow', '0.5')) * 1e8)), BigInt(num('window', 3600)));
      if (opened) console.log(`\n  opened ${opened} channel(s) for this gather`);
    }
    const res = await getPaid(trackerUrl, fileId, NET, num('price', 2));
    if (res.complete) writeFileSync(flag('out', 'download.bin'), res.bytes);
    const paid = Object.values(res.perFount).reduce((n, p) => n + p.sompi, 0);
    console.log(`\n  paid gather ${res.complete ? 'complete' : 'INCOMPLETE'} across ${Object.keys(res.perFount).length} fount(s)`);
    console.log(`  paid ${paid.toLocaleString()} sompi (${kas(paid)} KAS), per parcel, over your open channels\n`);
    process.exit(0);
  }
  const holders = await discover(trackerUrl, fileId);
  const anyUrl = holders[0]?.url;
  if (!anyUrl) { console.error('no founts hold that file'); process.exit(1); }
  const manifest = await (await fetch(`${anyUrl}/cascade/manifest?file=${fileId}`)).json();
  const { bytes, receipt } = await fetchFile({ manifest, holders, priceSompi: num('price', 2), concurrency: 4 });
  if (receipt.complete) writeFileSync(flag('out', manifest.name), bytes);
  console.log(`\n  gathered ${receipt.parcelsGot}/${manifest.parcels.length} parcels; ${receipt.complete ? 'wrote it' : 'INCOMPLETE'}; owed ${receipt.totalSompi.toLocaleString()} sompi\n`);
  process.exit(0);
}

async function channel(): Promise<void> {
  if (positional[0] !== 'open' || !positional[1]) { console.error('usage: cascade channel open <fountUrl> [--escrow KAS]'); process.exit(1); }
  const escrow = BigInt(Math.round(Number(flag('escrow', '0.5')) * 1e8));
  console.log(`\n  opening a ${kas(escrow)} KAS channel with ${positional[1]}…`);
  const { covenantId, genesisTxid } = await openChannelWith(positional[1], NET, escrow, BigInt(num('window', 3600)));
  console.log(`  genesis    ${genesisTxid}\n  covenantId ${covenantId}\n  now: cascade get <tracker> <fileId> --pay\n`);
  process.exit(0);
}

async function channelsList(): Promise<void> {
  const rows = openChannels();
  if (rows.length === 0) { console.log('\n  no channels. Open one: cascade channel open <fountUrl>\n'); process.exit(0); }
  console.log('');
  for (const r of rows) console.log(`    ${r.channel.covenantId}   ${kas(r.channel.active.amount)} KAS left   with ${r.sellerPubkey.slice(0, 16)}…`);
  console.log('');
  process.exit(0);
}

async function claimCmd(): Promise<void> {
  const cov = positional[0];
  if (!cov) { console.error('usage: cascade claim <covenantId>'); process.exit(1); }
  const out = await claimStored(cov);
  console.log(`\n  claimed ${kas(out.paid)} KAS  (${out.txid})\n`);
  process.exit(0);
}

async function refundCmd(): Promise<void> {
  const cov = positional[0];
  if (!cov) { console.error('usage: cascade refund <covenantId>'); process.exit(1); }
  console.log(`\n  refunding channel ${cov.slice(0, 16)}… once its timeout passes (this waits)`);
  const out = await refundChannel(cov);
  console.log(`  ${out.txid}\n  ${kas(out.refunded)} KAS back to the gatherer\n`);
  process.exit(0);
}

async function publish(): Promise<void> {
  const filePath = positional[0];
  const to = flag('to', '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!filePath || to.length === 0) { console.error('usage: cascade publish <file> --to <fountUrl[,fountUrl...]> [--tracker <url>]'); process.exit(1); }
  const r = await seed(filePath, to, flag('tracker', '') || undefined, num('parcel', 64 * 1024));
  console.log(`
  seeded ${r.name} (${r.parcels} parcels) to ${to.length} fount(s)`);
  console.log(`  fileId ${r.fileId}
  now: cascade get <tracker> ${r.fileId}
`);
  process.exit(0);
}

const COMMANDS: Record<string, () => Promise<void>> = { demo, tracker, fount: serveFount, get, publish, channel, channels: channelsList, claim: claimCmd, refund: refundCmd };
const run = COMMANDS[command ?? ''];
if (!run) { console.error('cascade: demo | tracker | fount [--paid] [--accept MB] | publish <file> --to <urls> | get [--pay] | channel open | channels | claim | refund'); process.exit(1); }
run().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
