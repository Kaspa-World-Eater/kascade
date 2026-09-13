# cascade

**A paid, self-verifying delivery Meridian on Kaspa. Many devices each hold pieces of a file; you pull
them in parallel and pay each device for the pieces it served — and a device that serves junk is
caught and earns nothing.**

It is [spigot](https://github.com/kaspahttp402/spigot) — pay-per-byte file delivery — turned from one
seller into a **network**. Which is to say: it's BitTorrent with the one thing BitTorrent never had —
a way to *pay the seeders*, per piece, as the bytes arrive. The bytes move peer-to-peer over the
ordinary internet; only the money touches the chain, and it's tiny.

## Why Kaspa — not as a slogan, as the reason it can exist

Kaspa's own stated doctrine is **real-time decentralization**: censorship-resistance, permissionless
settlement, and competitive mining *in real time, not eventually* — on a fair-launched proof-of-work
network with no premine. A delivery Meridian is that doctrine made physical. It makes **thousands of tiny
payments a second** — one per babel, per consumer, per fount — and pays its participants *as they
work, continuously*. That is impossible on a chain that takes minutes to settle and costs more than the
payment itself; today's decentralized CDNs batch payments or lean on a token instead, which quietly
puts a trusted middle back. Kaspa confirms in about a second at up to ten blocks a second, so the money
keeps pace with the bytes. The Meridian is not a clever use of a fast chain — it is the thing the fast
chain is *for*.

## How a download works

1. A file is content-addressed into a **manifest** — an ordered list of babel hashes. The manifest
   names the file; each hash names a babel.
2. The consumer asks a **tracker** who holds babels of that file, and gets a list of founts.
3. It pulls every babel **in parallel from whichever founts have it**, and **verifies each babel
   against the manifest before believing or paying** — a wrong babel hashes wrong and is refused.
4. Each fount is paid for exactly the babels it served and that verified. A fount that serves
   junk is recorded as a fault, earns nothing for it, and is routed around — the file still completes.

Two guarantees fall out of the manifest for free: **you can't be paid-for junk** (a wrong babel never
verifies, so it's never billed) and **you can't be overbilled** (the amount is the babel's size from a
manifest you had before you asked). Stopping partway pays only for the babels that arrived — to the byte.

## What is here

Built test-first. Each file is small and single-purpose.

| | |
|---|---|
| `src/manifest.ts` | content addressing — the whole trust story for delivery |
| `src/fount.ts` | one node: holds a subset of babels, serves them by the byte |
| `src/tracker.ts` | discovery: who holds which babels (a central tracker — BitTorrent's honest v1) |
| `src/consumer.ts` | the Meridian: parallel pull, per-babel verify, per-fount pay, reroute, stop |
| `src/settlement.ts` | a receipt → money on the rail: pay each earner on its channel, flag junk to slash |

```bash
npm install
npm test          # 10 tests, incl. "a file reassembles byte-for-byte from three founts at once"
```

## See it work

```bash
npm install
npm run cascade demo    # a whole Meridian, live, in one process -- nothing mocked
```

`demo` starts four real HTTP founts (one of them lying), splits a real file across them, and gathers
it back through the same fount/tracker/consumer/settlement code a deployed node would run. You watch
the liar get **tried first, rejected by the manifest, and routed around**; the file come back
**byte-identical**; and each fount paid only for the babels it actually served -- the liar earning
nothing and getting slashed. It is pinned by a test, so it cannot quietly break.

The real commands are there too: `cascade tracker`, `cascade fount <dir> --tracker <url>`, and
`cascade get <trackerUrl> <fileId>` run founts and gatherers as separate processes.

## Status

The Meridian runs end to end in-process: a file reassembles byte-identical from three founts pulled at
once, each paid for its share; a fourth fount serving corrupted bytes is caught by the manifest,
paid nothing, and routed around; stopping partway pays only for what arrived. Payment amounts are real
and per-fount; on-chain settlement is spigot's rail — one kaspa-x402 channel per fount — which
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
