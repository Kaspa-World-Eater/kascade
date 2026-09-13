# shoal

**A paid, self-verifying delivery swarm on Kaspa. Many devices each hold pieces of a file; you pull
them in parallel and pay each device for the pieces it served — and a device that serves junk is
caught and earns nothing.**

It is [spigot](https://github.com/kaspahttp402/spigot) — pay-per-byte file delivery — turned from one
seller into a **network**. Which is to say: it's BitTorrent with the one thing BitTorrent never had —
a way to *pay the seeders*, per piece, as the bytes arrive. The bytes move peer-to-peer over the
ordinary internet; only the money touches the chain, and it's tiny.

## Why Kaspa — not as a slogan, as the reason it can exist

Kaspa's own stated doctrine is **real-time decentralization**: censorship-resistance, permissionless
settlement, and competitive mining *in real time, not eventually* — on a fair-launched proof-of-work
network with no premine. A delivery swarm is that doctrine made physical. It makes **thousands of tiny
payments a second** — one per chunk, per consumer, per provider — and pays its participants *as they
work, continuously*. That is impossible on a chain that takes minutes to settle and costs more than the
payment itself; today's decentralized CDNs batch payments or lean on a token instead, which quietly
puts a trusted middle back. Kaspa confirms in about a second at up to ten blocks a second, so the money
keeps pace with the bytes. The swarm is not a clever use of a fast chain — it is the thing the fast
chain is *for*.

## How a download works

1. A file is content-addressed into a **manifest** — an ordered list of chunk hashes. The manifest
   names the file; each hash names a chunk.
2. The consumer asks a **tracker** who holds chunks of that file, and gets a list of providers.
3. It pulls every chunk **in parallel from whichever providers have it**, and **verifies each chunk
   against the manifest before believing or paying** — a wrong chunk hashes wrong and is refused.
4. Each provider is paid for exactly the chunks it served and that verified. A provider that serves
   junk is recorded as a fault, earns nothing for it, and is routed around — the file still completes.

Two guarantees fall out of the manifest for free: **you can't be paid-for junk** (a wrong chunk never
verifies, so it's never billed) and **you can't be overbilled** (the amount is the chunk's size from a
manifest you had before you asked). Stopping partway pays only for the chunks that arrived — to the byte.

## What is here

Built test-first. Each file is small and single-purpose.

| | |
|---|---|
| `src/manifest.ts` | content addressing — the whole trust story for delivery |
| `src/provider.ts` | one node: holds a subset of chunks, serves them by the byte |
| `src/tracker.ts` | discovery: who holds which chunks (a central tracker — BitTorrent's honest v1) |
| `src/consumer.ts` | the swarm: parallel pull, per-chunk verify, per-provider pay, reroute, stop |
| `src/settlement.ts` | a receipt → money on the rail: pay each earner on its channel, flag junk to slash |

```bash
npm install
npm test          # 10 tests, incl. "a file reassembles byte-for-byte from three providers at once"
```

## Status

The swarm runs end to end in-process: a file reassembles byte-identical from three providers pulled at
once, each paid for its share; a fourth provider serving corrupted bytes is caught by the manifest,
paid nothing, and routed around; stopping partway pays only for what arrived. Payment amounts are real
and per-provider; on-chain settlement is spigot's rail — one kaspa-x402 channel per provider — which
`settlement.ts` produces the plan for.

**The honest hard parts, named not faked:**
- **Getting bytes between phones.** Carrier-grade NAT hides mobile devices; two phones can't just
  connect. This needs relays or hole-punching and is the single biggest engineering risk. PCs, routers
  and relays likely carry the early network; phones start as consumers and Wi-Fi cache-holders.
- **A real DHT** to replace the central tracker, so there's no central list at all.
- **Supply needs demand** — one real buyer matters more than a thousand idle nodes.

Part of the suite: [metered](https://github.com/kaspahttp402/metered-protocol) (the rail) ·
[spigot](https://github.com/kaspahttp402/spigot) (one seller) ·
[flume](https://github.com/kaspahttp402/flume) (streaming) ·
[quorum](https://github.com/kaspahttp402/quorum) (trust for compute). Testnet only.

## Licence

MIT.
