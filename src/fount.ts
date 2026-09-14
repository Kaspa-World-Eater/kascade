/**
 * One node in the meridian: it holds SOME parcels of some files and serves them by the byte.
 *
 * A fount is spigot with two changes. It holds a SUBSET of a file, not the whole thing -- a phone
 * can carry a few parcels of what is popular right now -- so it publishes WHICH parcels it has. And it
 * is one of many: the consumer will pull the same file from several founts at once, so no fount
 * is the source, only a source. Everything else -- priced by the byte, counted, paid on the rail -- is
 * the same delivery spigot already proved.
 *
 * The price is carried on each parcel as a header so a consumer knows the cost before it accepts the
 * bytes; the actual per-fount settlement is the metered / kaspa-x402 rail, one channel per fount,
 * exactly as spigot opens one. This file only decides which bytes a request means and reads them.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Voucher, ChannelRef, ChannelProposal } from 'metered-protocol';
import { verifyParcel, type Manifest } from './manifest.js';
import { Creditline } from './creditline.js';
import { ParcelCache } from './cache.js';

/** What a fount physically holds: a manifest and the bytes of the parcels it actually has. */
export interface Held {
  manifest: Manifest;
  parcels: Map<number, Uint8Array>;
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
  /**
   * Enforce metered's per-parcel rule (SPEC.md 3.5): given the covenant id a request names, the
   * channel context to bill it against, or null to refuse. When absent the fount serves freely --
   * the in-process/demo path. When present it extends at most one parcel of credit per channel.
   */
  credit?: (covenantId: string) => CreditContext | null;
  /** This fount's payout public key, advertised at /kascade/identity so a gatherer knows who to open
   *  a channel with. */
  payoutPubkey?: string;
  /** Verify a channel a gatherer PROPOSES (with its pubkey) before extending it credit -- the on-chain
   *  channelVerifier in production. Returns the context to bill against, or null to refuse. When set,
   *  /kascade/propose is live and paid delivery is driven by accepted proposals. */
  verifyChannel?: (proposal: ChannelProposal, buyerPubkey: string) => Promise<CreditContext | null>;
  /** Called whenever a voucher is accepted -- how a long-running fount persists what it can later
   *  claim. The latest (highest) voucher per channel is the one to keep. */
  onVoucher?: (covenantId: string, voucher: Voucher) => void;
  /** Opt in to accepting content PUSHED to this fount (a publisher seeding it), up to this many
   *  bytes. Absent, /kascade/store is off and the fount serves only what it was given. */
  acceptBytes?: number;
}

export interface CreditContext {
  channel: ChannelRef;
  buyerPubkey: string;
  /** The channel's cumulative ceiling already vouched before this fount process saw it -- so a
   *  restarted fount rebuilds the creditline at the right point instead of extending free credit. */
  vouchedSompi?: number;
}

type Gate = { ok: true; charge: (sompi: number) => void } | { ok: false; error: string };

/** Decide whether a fount may serve one more parcel on this channel, recording any voucher sent. */
function creditGate(opts: FountOptions, paid: boolean, resolve: (covenantId: string) => CreditContext | null, lines: Map<string, Creditline>, covenantId: string, voucherHeader?: string): Gate {
  if (!paid) return { ok: true, charge: () => undefined };
  const ctx = resolve(covenantId);
  if (!ctx) return { ok: false, error: 'this fount does not accept that channel' };
  let line = lines.get(covenantId);
  if (!line) { line = new Creditline(ctx.channel, ctx.buyerPubkey, ctx.vouchedSompi ?? 0); lines.set(covenantId, line); }
  if (voucherHeader) {
    try {
      const v = JSON.parse(voucherHeader) as Voucher;
      line.recordVoucher(v);
      opts.onVoucher?.(covenantId, v);
    } catch { return { ok: false, error: 'voucher rejected' }; }
  }
  if (!line.mayServe()) return { ok: false, error: 'a voucher for the parcels already delivered is required first' };
  const l = line;
  return { ok: true, charge: (sompi) => l.served(sompi) };
}

interface HoldingSummary {
  fileId: string;
  name: string;
  size: number;
  parcelSize: number;
  indices: number[];
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

/** Start a fount serving what it holds. Returns the server and the url it is reachable at. */
export function fount(opts: FountOptions): { server: Server; url: () => string; summary: () => HoldingSummary[] } {
  const byId = new Map(opts.held.map((h) => [h.manifest.fileId, h]));
  const store = opts.acceptBytes ? new ParcelCache(opts.acceptBytes) : null;
  const pushed = new Map<string, Manifest>(); // manifests of files pushed to this fount
  const manifestOf = (fileId: string): Manifest | undefined => byId.get(fileId)?.manifest ?? pushed.get(fileId);
  const parcelOf = (fileId: string, index: number): Uint8Array | undefined => byId.get(fileId)?.parcels.get(index) ?? store?.get(fileId, index);

  const summary = (): HoldingSummary[] => {
    const rows: HoldingSummary[] = opts.held.map((h) => ({
      fileId: h.manifest.fileId, name: h.manifest.name, size: h.manifest.size,
      parcelSize: h.manifest.parcelSize, indices: [...h.parcels.keys()].sort((a, b) => a - b),
    }));
    for (const [fileId, m] of pushed) {
      const indices = (store?.holdings() ?? []).filter((x) => x.fileId === fileId).map((x) => x.index).sort((a, b) => a - b);
      rows.push({ fileId, name: m.name, size: m.size, parcelSize: m.parcelSize, indices });
    }
    return rows;
  };

  const lines = new Map<string, Creditline>();
  const proposals = new Map<string, CreditContext>();
  const paid = Boolean(opts.credit || opts.verifyChannel);
  const resolveCredit = (cid: string): CreditContext | null => (opts.credit ? opts.credit(cid) : proposals.get(cid) ?? null);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/kascade/have') return json(res, 200, summary());
    if (u.pathname === '/kascade/identity') return json(res, 200, { payoutPubkey: opts.payoutPubkey ?? null });
    if (u.pathname === '/kascade/propose') {
      if (!opts.verifyChannel) return json(res, 404, { error: 'this fount does not take channel proposals' });
      const verify = opts.verifyChannel;
      void readBody(req).then(async (body) => {
        const { proposal, buyerPubkey } = body as { proposal: ChannelProposal; buyerPubkey: string };
        const ctx = await verify(proposal, buyerPubkey);
        if (!ctx) return json(res, 402, { error: 'channel not accepted' });
        proposals.set(proposal.covenantId, ctx);
        json(res, 200, { ok: true });
      }).catch(() => json(res, 400, { error: 'bad proposal' }));
      return;
    }
    if (u.pathname === '/kascade/voucher') {
      // record a voucher without serving -- how a gatherer pays for the LAST parcel it pulled.
      const vh = req.headers['x-voucher'];
      const g = creditGate(opts, paid, resolveCredit, lines, u.searchParams.get('channel') ?? '', typeof vh === 'string' ? vh : undefined);
      return json(res, g.ok ? 200 : 402, g.ok ? { ok: true } : { error: g.error });
    }
    if (u.pathname === '/kascade/store') {
      if (!store) return json(res, 404, { error: 'this fount does not accept pushed content' });
      void readBody(req).then((body) => {
        const { manifest, index, bytesB64 } = body as { manifest: Manifest; index: number; bytesB64: string };
        const bytes = new Uint8Array(Buffer.from(bytesB64, 'base64'));
        if (!verifyParcel(manifest, index, bytes)) return json(res, 422, { error: 'parcel does not match the manifest' });
        store.put(manifest.fileId, index, bytes, { pinned: false });
        pushed.set(manifest.fileId, manifest);
        json(res, 200, { ok: true });
      }).catch(() => json(res, 400, { error: 'bad store request' }));
      return;
    }
    const manifest = manifestOf(u.searchParams.get('file') ?? '');
    if (!manifest) return json(res, 404, { error: 'file not held here' });
    if (u.pathname === '/kascade/manifest') return json(res, 200, manifest);
    if (u.pathname === '/kascade/parcel') {
      const index = Number(u.searchParams.get('i'));
      const bytes = parcelOf(manifest.fileId, index);
      if (!bytes) return json(res, 404, { error: `parcel ${index} not held here` });
      const vh = req.headers['x-voucher'];
      const gate = creditGate(opts, paid, resolveCredit, lines, u.searchParams.get('channel') ?? '', typeof vh === 'string' ? vh : undefined);
      if (!gate.ok) return json(res, 402, { error: gate.error });
      const out = opts.tamper ? opts.tamper(bytes, manifest.fileId, index) : bytes;
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': out.length,
        'x-price-sompi': String(bytes.length * opts.priceSompi),
      });
      res.end(Buffer.from(out));
      gate.charge(bytes.length * opts.priceSompi);
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
