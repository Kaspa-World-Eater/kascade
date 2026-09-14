/**
 * The paid flow, as a person runs it: open a channel with a fount, gather paying per parcel, and (for
 * a fount operator) claim what the vouchers cover. Everything here reuses the proven pieces -- the
 * vendored kaspa-x402 channel, the fount's proposal/voucher handshake, and gatherPaid -- and adds only
 * the small glue a command line needs: read a fount's advertised identity, remember channels, and
 * persist the latest voucher a fount receives so a separate `claim` command can spend it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Voucher } from 'metered-protocol';
import { proposalFor, type Network } from 'metered-protocol/rail';
import { identity } from './keys.js';
import { open, claim, recall, channelWith, sellerChannels, refund } from './channel.js';
import { stock, type StockFile } from './stock.js';
import type { FountOptions } from './fount.js';
import type { Manifest } from './manifest.js';
import { discover } from './tracker.js';
import { gatherPaid, type PaidGatherResult } from './paidgather.js';

const VDIR = join(homedir(), '.kascade', 'vouchers');

/** Keep the highest voucher a fount has received on each channel -- that is what it later claims. */
function saveVoucher(covenantId: string, v: Voucher): void {
  mkdirSync(VDIR, { recursive: true });
  const f = join(VDIR, `${covenantId}.json`);
  const prev = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Voucher) : null;
  if (!prev || BigInt(v.amount) > BigInt(prev.amount)) writeFileSync(f, JSON.stringify(v), { mode: 0o600 });
}
const loadVoucher = (covenantId: string): Voucher | null => {
  const f = join(VDIR, `${covenantId}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Voucher) : null;
};

/** Fount options for PAID mode: advertise identity, verify a proposed channel on chain, persist vouchers. */
export function paidFountOptions(files: StockFile[], network: Network, priceSompi: number, capBytes: number): FountOptions {
  const payout = identity('fount');
  const { held } = stock(files, capBytes);
  const verify = sellerChannels(payout.publicKeyHex, network, 0);
  return {
    held, priceSompi, payoutPubkey: payout.publicKeyHex,
    verifyChannel: async (proposal, buyerPubkey) => {
      const ok = await verify(buyerPubkey, proposal);
      return ok ? { channel: { network: `kaspa:${network}`, covenantId: proposal.covenantId }, buyerPubkey } : null;
    },
    onVoucher: (cov, v) => saveVoucher(cov, v),
  };
}

const fetchJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;

/** GATHERER: open a channel with a fount and propose it, so the fount will serve on credit. */
export async function openChannelWith(fountUrl: string, network: Network, escrowSompi: bigint, windowDaa: bigint): Promise<{ covenantId: string; genesisTxid: string }> {
  const me = identity('gatherer');
  const { payoutPubkey } = await fetchJson<{ payoutPubkey: string | null }>(`${fountUrl}/kascade/identity`);
  if (!payoutPubkey) throw new Error('that fount advertises no payout identity -- it does not take paid channels');
  const { channel, txid } = await open(me.secretKeyHex, payoutPubkey, network, escrowSompi, windowDaa);
  const res = await fetch(`${fountUrl}/kascade/propose`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposal: proposalFor(channel), buyerPubkey: me.publicKeyHex }),
  });
  if (!res.ok) throw new Error(`the fount rejected the channel proposal: ${res.status}`);
  return { covenantId: channel.covenantId, genesisTxid: txid };
}

/** GATHERER: gather a file, paying each fount per parcel over the channel already open with it. */
export async function getPaid(trackerUrl: string, fileId: string, network: Network, priceSompi: number): Promise<PaidGatherResult> {
  const me = identity('gatherer');
  const holders = await discover(trackerUrl, fileId);
  if (holders.length === 0) throw new Error('no founts hold that file');
  const manifest = await fetchJson<Manifest>(`${holders[0]?.url}/kascade/manifest?file=${fileId}`);
  const channelByFount: Record<string, { network: string; covenantId: string }> = {};
  for (const h of holders) {
    const { payoutPubkey } = await fetchJson<{ payoutPubkey: string | null }>(`${h.url}/kascade/identity`);
    const rec = payoutPubkey ? channelWith(payoutPubkey) : null;
    if (rec) channelByFount[h.url] = { network: `kaspa:${network}`, covenantId: rec.channel.covenantId };
  }
  return gatherPaid({ manifest, holders, channelByFount, buyerSk: me.secretKeyHex, priceSompi });
}

/** GATHERER: open a channel with any fount in this list it does not already have one with. */
export async function ensureChannels(fountUrls: string[], network: Network, escrowSompi: bigint, windowDaa: bigint): Promise<number> {
  let opened = 0;
  for (const url of fountUrls) {
    const { payoutPubkey } = await fetchJson<{ payoutPubkey: string | null }>(`${url}/kascade/identity`);
    if (payoutPubkey && !channelWith(payoutPubkey)) { await openChannelWith(url, network, escrowSompi, windowDaa); opened += 1; }
  }
  return opened;
}

/** GATHERER: reclaim the unspent remainder of a channel after its timeout has passed (this waits). */
export async function refundChannel(covenantId: string): Promise<{ txid: string; refunded: bigint }> {
  return refund(identity('gatherer').secretKeyHex, covenantId);
}

/** FOUNT: claim what the stored voucher for a channel covers. */
export async function claimStored(covenantId: string): Promise<{ txid: string; paid: bigint }> {
  const me = identity('fount');
  const voucher = loadVoucher(covenantId);
  if (!voucher) throw new Error(`no voucher stored for ${covenantId} -- has anyone paid on it?`);
  const rec = recall(covenantId);
  const claimSompi = BigInt(voucher.amount) - rec.channel.settledTotal;
  if (claimSompi <= 0n) throw new Error(`nothing new to claim (settled ${rec.channel.settledTotal} already covers ${voucher.amount})`);
  const out = await claim(me.secretKeyHex, covenantId, voucher, claimSompi);
  return { txid: out.txid, paid: out.paid };
}
