/**
 * One node in the meridian: it holds SOME babels of some files and serves them by the byte.
 *
 * A fount is spigot with two changes. It holds a SUBSET of a file, not the whole thing -- a phone
 * can carry a few babels of what is popular right now -- so it publishes WHICH babels it has. And it
 * is one of many: the consumer will pull the same file from several founts at once, so no fount
 * is the source, only a source. Everything else -- priced by the byte, counted, paid on the rail -- is
 * the same delivery spigot already proved.
 *
 * The price is carried on each babel as a header so a consumer knows the cost before it accepts the
 * bytes; the actual per-fount settlement is the metered / kaspa-x402 rail, one channel per fount,
 * exactly as spigot opens one. This file only decides which bytes a request means and reads them.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Manifest } from './manifest.js';

/** What a fount physically holds: a manifest and the bytes of the babels it actually has. */
export interface Held {
  manifest: Manifest;
  babels: Map<number, Uint8Array>;
}

export interface FountOptions {
  held: Held[];
  /** sompi per byte delivered */
  priceSompi: number;
  /**
   * Corrupt what this fount serves. An HONEST fount never sets this. It exists so a test can
   * build a node that serves junk and watch the consumer catch it against the manifest.
   */
  tamper?: (bytes: Uint8Array, fileId: string, index: number) => Uint8Array;
}

interface HoldingSummary {
  fileId: string;
  name: string;
  size: number;
  babelSize: number;
  indices: number[];
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

/** Start a fount serving what it holds. Returns the server and the url it is reachable at. */
export function fount(opts: FountOptions): { server: Server; url: () => string; summary: () => HoldingSummary[] } {
  const byId = new Map(opts.held.map((h) => [h.manifest.fileId, h]));
  const summary = (): HoldingSummary[] =>
    opts.held.map((h) => ({
      fileId: h.manifest.fileId, name: h.manifest.name, size: h.manifest.size,
      babelSize: h.manifest.babelSize, indices: [...h.babels.keys()].sort((a, b) => a - b),
    }));

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/cascade/have') return json(res, 200, summary());
    const held = byId.get(u.searchParams.get('file') ?? '');
    if (!held) return json(res, 404, { error: 'file not held here' });
    if (u.pathname === '/cascade/manifest') return json(res, 200, held.manifest);
    if (u.pathname === '/cascade/babel') {
      const index = Number(u.searchParams.get('i'));
      const bytes = held.babels.get(index);
      if (!bytes) return json(res, 404, { error: `babel ${index} not held here` });
      const out = opts.tamper ? opts.tamper(bytes, held.manifest.fileId, index) : bytes;
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': out.length,
        'x-price-sompi': String(bytes.length * opts.priceSompi),
      });
      res.end(Buffer.from(out));
      return;
    }
    json(res, 404, { error: 'no such route' });
  });

  const url = (): string => {
    const a = server.address() as AddressInfo;
    return `http://127.0.0.1:${a.port}`;
  };
  return { server, url, summary };
}
