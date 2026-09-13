/**
 * `cascade` — run a fount, a tracker, gather a file, or watch the whole Meridian prove itself.
 *
 *   cascade demo                              a whole Meridian, live, in one process (the proof)
 *   cascade tracker [--port N]                run a tracker: who holds which babels
 *   cascade fount <dir> --tracker <url> [--price N] [--port N]   serve a directory of files
 *   cascade get <trackerUrl> <fileId> [--out FILE] [--price N]   gather a file from the Meridian
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildManifest } from '../src/manifest.js';
import { fount, type Held } from '../src/fount.js';
import { trackerServer, announceTo, discover } from '../src/tracker.js';
import { fetchFile } from '../src/consumer.js';
import { runDemo, type DemoResult } from '../src/demo.js';

const argv = process.argv.slice(2);
const [command, ...rest] = argv;
const flag = (name: string, fb: string): string => { const i = argv.indexOf(`--${name}`); return i === -1 ? fb : argv[i + 1] ?? fb; };
const num = (name: string, fb: number): number => Number(flag(name, String(fb)));
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
const kas = (sompi: number): string => (sompi / 1e8).toFixed(8);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const port = (s: { address: () => unknown }): number => (s.address() as AddressInfo).port;

function printDemo(d: DemoResult): void {
  const faultIdx = new Set(d.faults.map((f) => f.index));
  console.log(`\n  CASCADE — live proof, one machine, nothing mocked\n`);
  console.log(`  A ${d.fileBytes.toLocaleString()}-byte file, split into ${d.babelCount} babels, across ${d.founts.length} founts (one lying).\n`);
  console.log('  FOUNTS');
  for (const f of d.founts) console.log(`    ${pad(f.name, 12)} holds [${f.holds.join(',')}]${f.honest ? '' : '   ← serves corrupted bytes'}`);
  console.log('\n  GATHER  (parallel; every babel verified against the manifest before it is believed or paid)');
  for (const t of d.trace) {
    const caught = faultIdx.has(t.index) ? '   (fount-LIAR tried first, REJECTED — hash mismatch)' : '';
    console.log(`    babel ${pad(String(t.index), 2)} ← ${pad(t.from, 12)}${caught}`);
  }
  console.log(`\n  JUNK CAUGHT   fount-LIAR failed the manifest on babels [${d.faults.map((f) => f.index).join(', ')}] — rerouted, earns nothing.`);
  console.log(`\n  RESULT        file reassembled ${d.byteIdentical ? 'BYTE-IDENTICAL  ✓  (sha256 matches the source)' : 'WRONG  ✗'}`);
  console.log('\n  EARNINGS  (verified babels only)');
  for (const e of d.earnings) console.log(`    ${pad(e.fount, 12)} ${e.babels} babels   ${e.sompi.toLocaleString()} sompi`);
  console.log(`    ${pad('fount-LIAR', 12)} 0 babels   0 sompi   (caught)`);
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
  const held: Held[] = names.map((name) => {
    const bytes = new Uint8Array(readFileSync(join(root, name)));
    const manifest = buildManifest(name, bytes, num('babel', 64 * 1024));
    const babels = new Map(manifest.babels.map((b) => [b.index, bytes.subarray(b.index * manifest.babelSize, b.index * manifest.babelSize + b.size)]));
    return { manifest, babels };
  });
  const f = fount({ held, priceSompi: num('price', 2) });
  await new Promise<void>((r) => f.server.listen(num('port', 0), '127.0.0.1', r));
  const url = `http://127.0.0.1:${port(f.server)}`;
  for (const h of held) await announceTo(trackerUrl, h.manifest.fileId, url, [...h.babels.keys()]);
  console.log(`\n  fount on ${url}  —  serving ${held.length} file(s), ${num('price', 2)} sompi/byte`);
  for (const h of held) console.log(`    ${h.manifest.fileId.slice(0, 16)}…  ${h.manifest.name}  (${h.manifest.babels.length} babels)`);
  console.log('');
}

async function get(): Promise<void> {
  const [trackerUrl, fileId] = positional;
  if (!trackerUrl || !fileId) { console.error('usage: cascade get <trackerUrl> <fileId> [--out FILE]'); process.exit(1); }
  const holders = await discover(trackerUrl, fileId);
  const anyUrl = holders[0]?.url;
  if (!anyUrl) { console.error('no founts hold that file'); process.exit(1); }
  const manifest = await (await fetch(`${anyUrl}/cascade/manifest?file=${fileId}`)).json();
  const { bytes, receipt } = await fetchFile({ manifest, holders, priceSompi: num('price', 2), concurrency: 4 });
  const out = flag('out', manifest.name);
  if (receipt.complete) writeFileSync(out, bytes);
  console.log(`\n  gathered ${receipt.babelsGot}/${manifest.babels.length} babels from ${Object.keys(receipt.perFount).length} fount(s)`);
  console.log(`  ${receipt.complete ? `wrote ${out}` : 'INCOMPLETE — some babels had no honest holder'}`);
  console.log(`  owed ${receipt.totalSompi.toLocaleString()} sompi across the founts that served\n`);
  process.exit(0);
}

const COMMANDS: Record<string, () => Promise<void>> = { demo, tracker, fount: serveFount, get };
const run = COMMANDS[command ?? ''];
if (!run) { console.error('cascade: demo | tracker | fount | get'); process.exit(1); }
run().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
