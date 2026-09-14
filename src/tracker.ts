/**
 * Discovery: who holds which parcels of a file. The one small piece of shared state.
 *
 * A consumer cannot pull from the meridian until it knows who is in it. The tracker answers exactly one
 * question -- "who has file X, and which parcels?" -- and holds nothing else: no content, no money, no
 * account. It is the least trusted thing in the system, because a lying tracker can only send you to a
 * fount whose parcels you will verify against the manifest anyway; the worst it can do is waste a
 * request, never corrupt a file.
 *
 * This is a plain central tracker, which is the honest v1: it is simple, and it is exactly what
 * BitTorrent shipped for years before the DHT. Replacing it with a distributed hash table so there is
 * no central list at all is a known, later step -- and a real one, noted in the README, not pretended.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Holder {
  url: string;
  indices: number[];
}

/** In-process registry of who holds what. The HTTP tracker is a thin shell over this. */
export class Tracker {
  private byFile = new Map<string, Map<string, number[]>>();

  announce(fileId: string, url: string, indices: number[]): void {
    const holders = this.byFile.get(fileId) ?? new Map<string, number[]>();
    holders.set(url, [...indices].sort((a, b) => a - b));
    this.byFile.set(fileId, holders);
  }

  holders(fileId: string): Holder[] {
    return [...(this.byFile.get(fileId) ?? new Map()).entries()].map(([url, indices]) => ({ url, indices }));
  }
}

const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

const send = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

/** Serve a Tracker over HTTP: POST /kascade/announce, GET /kascade/holders?file=<id>. */
export function trackerServer(tracker = new Tracker()): { server: Server; url: () => string; tracker: Tracker } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && u.pathname === '/kascade/announce') {
      void readJson(req).then((b) => {
        const { fileId, url, indices } = b as { fileId: string; url: string; indices: number[] };
        tracker.announce(fileId, url, indices);
        send(res, 200, { ok: true });
      }).catch(() => send(res, 400, { error: 'bad announce' }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/kascade/holders') {
      return send(res, 200, tracker.holders(u.searchParams.get('file') ?? ''));
    }
    send(res, 404, { error: 'no such route' });
  });
  const url = (): string => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, tracker };
}

/** A fount tells the tracker what it holds. */
export async function announceTo(trackerUrl: string, fileId: string, fountUrl: string, indices: number[]): Promise<void> {
  await fetch(`${trackerUrl}/kascade/announce`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileId, url: fountUrl, indices }),
  });
}

/** A consumer asks who holds a file. */
export async function discover(trackerUrl: string, fileId: string): Promise<Holder[]> {
  const res = await fetch(`${trackerUrl}/kascade/holders?file=${encodeURIComponent(fileId)}`);
  return (await res.json()) as Holder[];
}
