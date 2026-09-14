/**
 * Rendering a live demo run for a terminal — presentation only, kept out of the CLI dispatcher so
 * bin/kascade.ts stays a thin command table.
 */
import type { DemoResult } from './demo.js';
import { kas } from './format.js';

const pad = (str: string, n: number): string => (str.length >= n ? str : str + ' '.repeat(n - str.length));

export function printDemo(d: DemoResult): void {
  const faultIdx = new Set(d.faults.map((f) => f.index));
  console.log(`\n  KASCADE — live proof, one machine, nothing mocked\n`);
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
  for (const s of d.settlement.faulted) console.log(`    FAULT  ${pad(s.url, 12)} (${s.faults} fault${s.faults === 1 ? '' : 's'}) -- earns nothing`);
  console.log('');
}
