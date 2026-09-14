/**
 * The tracker, gone. A network of DHT nodes over real HTTP sockets; founts announce what they hold
 * into it; a gatherer that knows only one bootstrap node resolves a file's providers by walking the
 * DHT, then reassembles the file byte-identical. No central list is consulted anywhere.
 *
 * This is the in-process/local proof (the DHT is off-chain, so no testnet is needed); real
 * phone-to-phone reach still needs the NAT layer, which is not built.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { idFromHex } from '../src/distance.js';
import { KadNode } from '../src/kadnode.js';
import { startDhtNode, httpRpc, peerOf, holdersViaDht } from '../src/dhtserver.js';
import { buildManifest } from '../src/manifest.js';
import { fount, type Held } from '../src/fount.js';
import { fetchFile } from '../src/consumer.js';

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));

async function main(): Promise<void> {
  console.log('\n  KASCADE — DHT proof: discovery with NO central tracker\n');

  // A file, cut into 8 parcels, split unevenly across three founts.
  const bytes = Uint8Array.from({ length: 8000 }, (_, i) => (i * 37 + 11) % 251);
  const m = buildManifest('movie.bin', bytes, 1000); // 8 parcels of 1000
  const cut = (i: number) => bytes.subarray(i * 1000, i * 1000 + 1000);
  const layout = [{ holds: [0, 1, 2] }, { holds: [3, 4, 5] }, { holds: [6, 7] }];

  // Stand up a DHT of 10 nodes over HTTP, all bootstrapped through node 0.
  const boot = await startDhtNode();
  const others = await Promise.all(Array.from({ length: 9 }, () => startDhtNode([peerOf(boot.url)])));
  const dht = [boot, ...others];
  for (const n of others) await n.node.join(peerOf(boot.url));
  console.log(`  DHT: ${dht.length} nodes over HTTP, bootstrapped through ${boot.url}`);

  // Stand up the founts (free path), and each announces its held file into the DHT.
  const founts = layout.map((L) => ({ f: fount({ held: [{ manifest: m, parcels: new Map(L.holds.map((i) => [i, cut(i)])) }] as Held[], priceSompi: 0 }), url: '', holds: L.holds }));
  await Promise.all(founts.map((n) => listen(n.f.server)));
  for (const n of founts) {
    n.url = `http://127.0.0.1:${(n.f.server.address() as AddressInfo).port}`;
    const announcer = new KadNode(`fount-${n.url}`, httpRpc(), [peerOf(boot.url)]);
    await announcer.join(peerOf(boot.url));
    const stored = await announcer.announce(idFromHex(m.fileId), n.url);
    console.log(`  fount ${n.url}  holds [${n.holds.join(',')}]  announced to ${stored} DHT node(s)`);
  }

  // A gatherer that knows ONLY the bootstrap node resolves the file through the DHT.
  console.log(`\n  gatherer knows only one node (${boot.url}); resolving via the DHT…`);
  const seeker = new KadNode('seeker', httpRpc(), [peerOf(boot.url)]);
  await seeker.join(peerOf(boot.url));
  const holders = await holdersViaDht(seeker, m.fileId);
  console.log(`  DHT returned ${holders.length} founts holding parcels [${holders.flatMap((h) => h.indices).sort((a, b) => a - b).join(',')}]`);

  const { bytes: got, receipt } = await fetchFile({ manifest: m, holders, priceSompi: 0, concurrency: 4 });
  const identical = receipt.complete && got.length === bytes.length && got.every((b, i) => b === bytes[i]);
  console.log(`\n  RESULT: reassembled ${identical ? 'BYTE-IDENTICAL ✓ — discovered with no central list' : 'WRONG ✗'}\n`);

  await Promise.all([...dht.map((n) => n.close()), ...founts.map((n) => new Promise<void>((r) => n.f.server.close(() => r())))]);
  process.exit(identical ? 0 : 1);
}

main().catch((e: unknown) => { console.error(`\n  ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
