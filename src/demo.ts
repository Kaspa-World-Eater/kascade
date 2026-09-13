/**
 * Proof, not promises: a whole Meridian, live, in one process.
 *
 * This starts real HTTP founts, gives one of them a lie to tell, splits a real file across them, and
 * gathers it back — using the exact same fount / tracker / consumer / settlement code the tests and a
 * deployed node would use. Nothing here is mocked. It returns what actually happened so a caller can
 * print it or a test can assert it: which fount served each babel, whether the file came back
 * byte-identical, who earned what, and who got caught.
 */
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { buildManifest } from './manifest.js';
import { fount, type Held } from './fount.js';
import { trackerServer, announceTo, discover } from './tracker.js';
import { fetchFile, type Receipt } from './consumer.js';
import { settlementFor, type MeridianSettlement } from './settlement.js';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const demoFile = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 131 + 7) % 251);
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

interface Plan { name: string; holds: number[]; honest: boolean }
export interface DemoResult {
  fileBytes: number;
  babelCount: number;
  priceSompi: number;
  founts: { name: string; holds: number[]; honest: boolean }[];
  trace: { index: number; from: string }[];
  faults: { fount: string; index: number }[];
  earnings: { fount: string; babels: number; sompi: number }[];
  byteIdentical: boolean;
  totalPaidSompi: number;
  settlement: MeridianSettlement;
}

/** The subset of babels a fount holds, drawn from the full set. */
function held(indices: number[], all: Map<number, Uint8Array>): Map<number, Uint8Array> {
  return new Map(indices.map((i) => [i, all.get(i) as Uint8Array]));
}

export async function runDemo(source?: Uint8Array, priceSompi = 2): Promise<DemoResult> {
  const bytes = source ?? demoFile(512 * 1024); // 8 babels at 64 KB
  const m = buildManifest('demo.bin', bytes, 64 * 1024);
  const all = new Map(m.babels.map((b) => [b.index, bytes.subarray(b.index * m.babelSize, b.index * m.babelSize + b.size)]));

  // The LIAR is announced first, and holds babels 2 and 6 — so it is TRIED first for those, and must
  // be caught by the manifest and routed around. Every babel is also held by an honest fount.
  const plans: Plan[] = [
    { name: 'fount-LIAR', holds: [2, 6], honest: false },
    { name: 'fount-A', holds: [0, 1, 2, 3], honest: true },
    { name: 'fount-B', holds: [2, 3, 4, 5], honest: true },
    { name: 'fount-C', holds: [4, 5, 6, 7], honest: true },
  ];
  const flip = (b: Uint8Array): Uint8Array => { const t = Uint8Array.from(b); t[0] = (t[0] ?? 0) ^ 0xff; return t; };

  const nodes = plans.map((p) => {
    const heldBabels: Held[] = [{ manifest: m, babels: held(p.holds, all) }];
    return { plan: p, f: fount({ held: heldBabels, priceSompi, ...(p.honest ? {} : { tamper: flip }) }) };
  });
  const trk = trackerServer();
  await Promise.all([...nodes.map((n) => listen(n.f.server)), listen(trk.server)]);

  const nameByUrl = new Map<string, string>();
  try {
    for (const n of nodes) {
      nameByUrl.set(n.f.url(), n.plan.name);
      await announceTo(trk.url(), m.fileId, n.f.url(), n.plan.holds);
    }
    const holders = await discover(trk.url(), m.fileId);
    const trace: DemoResult['trace'] = [];
    const { bytes: got, receipt } = await fetchFile({
      manifest: m, holders, priceSompi, concurrency: 4,
      onBabel: (index, _b, from) => trace.push({ index, from: nameByUrl.get(from) ?? from }),
    });

    const channelByFount: Record<string, string> = {};
    for (const n of nodes) channelByFount[n.f.url()] = `chan-${n.plan.name}`;
    const settlement = settlementFor(receipt, channelByFount);
    return {
      fileBytes: bytes.length, babelCount: m.babels.length, priceSompi,
      founts: plans.map((p) => ({ name: p.name, holds: p.holds, honest: p.honest })),
      trace: trace.sort((a, b) => a.index - b.index),
      faults: receipt.faults.map((f) => ({ fount: nameByUrl.get(f.url) ?? f.url, index: f.index })),
      earnings: earningsOf(receipt, nameByUrl),
      byteIdentical: got.length === bytes.length && sha(got) === sha(bytes),
      totalPaidSompi: receipt.totalSompi,
      settlement: withNames(settlement, nameByUrl),
    };
  } finally {
    await Promise.all([...nodes.map((n) => close(n.f.server)), close(trk.server)]);
  }
}

function earningsOf(receipt: Receipt, nameByUrl: Map<string, string>): DemoResult['earnings'] {
  return Object.entries(receipt.perFount).map(([url, t]) => ({ fount: nameByUrl.get(url) ?? url, babels: t.babels, sompi: t.sompi }));
}

/** Re-label a settlement's urls with fount names, for a readable proof. */
function withNames(s: MeridianSettlement, nameByUrl: Map<string, string>): MeridianSettlement {
  const nm = (u: string) => nameByUrl.get(u) ?? u;
  return {
    pay: s.pay.map((p) => ({ ...p, url: nm(p.url) })),
    slash: s.slash.map((x) => ({ ...x, url: nm(x.url) })),
    unsettleable: s.unsettleable.map((x) => ({ ...x, url: nm(x.url) })),
    totalPaidSompi: s.totalPaidSompi,
  };
}
