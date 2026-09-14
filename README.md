# kascade

**A paid, self-verifying delivery Meridian on Kaspa. Many devices each hold pieces of a file; you pull
them in parallel and pay each device for the pieces it served — and a device that serves junk is
caught and earns nothing.**

It is [spigot](https://github.com/kaspahttp402/spigot) — pay-per-byte file delivery — turned from one
seller into a **network**. Which is to say: it's BitTorrent with the one thing BitTorrent never had —
a way to *pay the seeders*, per piece, as the bytes arrive. The bytes move peer-to-peer over the
ordinary internet; only the money touches the chain, and it's tiny.

**→ [Read what Kascade is, in one page](https://kaspahttp402.github.io/kascade/)** — what it is, what it replaces, why Kaspa, and why it matters for sovereignty.

## Why Kaspa — not as a slogan, as the reason it can exist

Kaspa's own stated doctrine is **real-time decentralization**: censorship-resistance, permissionless
settlement, and competitive mining *in real time, not eventually* — on a fair-launched proof-of-work
network with no premine. A delivery Meridian is that doctrine made physical. It makes **thousands of tiny
payments a second** — one per parcel, per consumer, per fount — and pays its participants *as they
work, continuously*. That is impossible on a chain that takes minutes to settle and costs more than the
payment itself; today's decentralized CDNs batch payments or lean on a token instead, which quietly
puts a trusted middle back. Kaspa confirms in about a second at up to ten blocks a second, so the money
keeps pace with the bytes. The Meridian is not a clever use of a fast chain — it is the thing the fast
chain is *for*.

## How a download works

1. A file is content-addressed into a **manifest** — an ordered list of parcel hashes. The manifest
   names the file; each hash names a parcel.
2. The consumer asks a **tracker** who holds parcels of that file, and gets a list of founts.
3. It pulls every parcel **in parallel from whichever founts have it**, and **verifies each parcel
   against the manifest before believing or paying** — a wrong parcel hashes wrong and is refused.
4. Each fount is paid for exactly the parcels it served and that verified. A fount that serves
   junk is recorded as a fault, earns nothing for it, and is routed around — the file still completes.

Two guarantees fall out of the manifest for free: **you can't be paid-for junk** (a wrong parcel never
verifies, so it's never billed) and **you can't be overbilled** (the amount is the parcel's size from a
manifest you had before you asked). Stopping partway pays only for the parcels that arrived — to the byte.

## What is here

Built test-first. Each file is small and single-purpose.

| | |
|---|---|
| `src/manifest.ts` | content addressing — the whole trust story for delivery |
| `src/fount.ts` | one node: holds a subset of parcels, serves them by the byte |
| `src/tracker.ts` | discovery: who holds which parcels (a central tracker — BitTorrent's honest v1) |
| `src/consumer.ts` | the Meridian: parallel pull, per-parcel verify, per-fount pay, reroute, stop |
| `src/settlement.ts` | a receipt → money on the rail: pay each earner on its channel, flag junk to slash |

```bash
npm install
npm test          # 10 tests, incl. "a file reassembles byte-for-byte from three founts at once"
```

## See it work

```bash
npm install
npm run kascade demo    # a whole Meridian, live, in one process -- nothing mocked
```

`demo` starts four real HTTP founts (one of them lying), splits a real file across them, and gathers
it back through the same fount/tracker/consumer/settlement code a deployed node would run. You watch
the liar get **tried first, rejected by the manifest, and routed around**; the file come back
**byte-identical**; and each fount paid only for the parcels it actually served -- the liar earning
nothing and getting slashed. It is pinned by a test, so it cannot quietly break.

**The money is proven on chain, too.** `npx tsx tools/prove-live.ts` runs it live on Kaspa
testnet-10: a fount starts at 0 KAS, delivers a real file, and **claims real testnet KAS** for exactly
the parcels it served (genesis `1216fcf1…`, claim `8af4c616…`, +0.055 KAS to the fount). Same
kaspa-x402 rail spigot and flume settle on; multi-fount is this once per fount.

**The whole Meridian is proven too.** `npx tsx tools/prove-live-meridian.ts`: three founts each hold part of a
file, a gatherer opens a channel with each, pulls it from all of them, and **each fount claims its own
share of real testnet KAS** (0 → 0.061 / 0.061 / 0.044 KAS; claims `c76b04d4…`, `b5fdc420…`, `0f528347…`).
One honest constraint surfaced and is documented: a fount cannot claim **dust** — a claim whose payout is
below roughly 0.02 KAS trips Kaspa's KIP-9 storage-mass limit (a tiny output is expensive), so a fount
accumulates earnings and settles in meaningful amounts, the way a Lightning channel is not closed over pennies.

The real commands are there too: `kascade tracker`, `kascade fount <dir> --tracker <url>`, and
`kascade get <trackerUrl> <fileId>` run founts and gatherers as separate processes.

## Onboarding a buyer

There is no sign-up and no seed phrase to write down. The first time you run any role, kascade
creates a secp256k1 key at `~/.kascade/<role>.key` (mode 0600) — **that key is the wallet.** To find
out where to put money and whether it has arrived:

```
kascade wallet          # your address and live on-chain balance
kascade fund            # prints the address, then waits until funded (testnet faucet linked)
```

Funding itself is manual — kascade never takes custody and there is no fiat on-ramp. On testnet the
faucet fills the address in seconds; then `kascade channel open <fountUrl>` locks escrow and paid
`get`s draw against it.

## The app

`kascade app` serves a **local browser control panel** on `127.0.0.1`: your wallet and balance, your
open channels, and buttons to open a channel or gather a file — the same code the CLI runs, behind a
page. It is the buyer/operator's face, run on your own machine with your own keys.

It is **not** the passive, phone-to-phone "download in the background" app the project is aiming at.
That one needs WebRTC/NAT traversal that is not built (see the honest hard parts below), and the page
says so. What ships today is real and works against the live network; the passive mobile app does not
exist yet.

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
