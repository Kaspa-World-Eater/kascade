/**
 * kascade's face in a browser — a local control panel, NOT the passive phone app.
 *
 * The passive, mass-download, phone-to-phone app the project is aiming at needs WebRTC/NAT traversal
 * that is not built, and the page says so plainly. THIS is the honest, working slice of "the app": a
 * page served on localhost by the process that already holds the keys and the SDK, so a person can
 * see their wallet, open a channel, and gather a file by clicking instead of memorising CLI flags.
 * It binds to 127.0.0.1 only and drives the exact same functions the CLI does — no new trust, no
 * custody, nothing it can do that `kascade` on the command line cannot.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Network } from 'metered-protocol/rail';
import { walletState, faucetFor } from './wallet.js';
import { channels } from './channel.js';
import { getPaid, openChannelWith } from './paidcli.js';

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../web/app.html'), 'utf8');

type Res = ServerResponse;
const json = (res: Res, code: number, body: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? `${v}` : v)));
};
const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
};

type Handler = (req: IncomingMessage, res: Res) => Promise<void> | void;

/** One handler per "METHOD /path". Keeping routing a lookup keeps this file's branching flat. */
function routes(network: Network): Record<string, Handler> {
  return {
    'GET /': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); },
    'GET /api/wallet': async (_q, res) => {
      const w = await walletState('gatherer', network);
      json(res, 200, { ...w, network, faucet: faucetFor(network) });
    },
    'GET /api/channels': (_q, res) =>
      json(res, 200, channels().map((r) => ({ covenantId: r.channel.covenantId, leftSompi: r.channel.active.amount, seller: r.sellerPubkey }))),
    'POST /api/channel': async (req, res) => {
      const b = await body(req);
      const o = await openChannelWith(String(b.fountUrl), network, BigInt(Number(b.escrowSompi)), BigInt(Number(b.windowDaa ?? 3600)));
      json(res, 200, o);
    },
    'POST /api/gather': async (req, res) => {
      const b = await body(req);
      const r = await getPaid(String(b.trackerUrl), String(b.fileId), network, Number(b.priceSompi ?? 2));
      if (r.complete) writeFileSync(`download-${String(b.fileId).slice(0, 12)}.bin`, r.bytes);
      json(res, 200, { complete: r.complete, founts: Object.keys(r.perFount).length });
    },
  };
}

export function webapp(network: Network): { server: Server } {
  const table = routes(network);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const handler = table[`${req.method} ${url.pathname}`];
    try {
      if (handler) await handler(req, res);
      else json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return { server };
}
