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
| `src/settlement.ts` | a receipt → money on the rail: pay each earner on its channel; junk earns nothing (fault recorded) |

```bash
npm install
npm test          # 60 tests, incl. "a file reassembles byte-for-byte from three founts at once"
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
nothing (a recorded fault -- seizing a bond on-chain is designed in quorum, not built). It is pinned by a test, so it cannot quietly break.

**The money is proven on chain — per parcel, and independently verifiable.** Each claim below is a
full transaction id anyone can check on a public testnet-10 node:

```bash
curl -s https://api-tn10.kaspa.org/transactions/<txid> | grep -o '"is_accepted":[a-z]*'   # -> "is_accepted":true
```

`npx tsx tools/prove-live-paid.ts` runs the **paid per-parcel handshake** live: three founts each hold
part of a 900 KB file and enforce the 402 rule; a gatherer opens a channel with each and **pays per
parcel as each verifies**; each fount then claims its share of real KAS.

| fount | earned | verifiable claim txid |
|---|---|---|
| A | 0.06053600 KAS (5 parcels) | `5c9c391131200f839b8549dfadd1fab260a03c6e2bc47d8bdd151c1a65b3058a` |
| B | 0.06053600 KAS (5 parcels) | `cedc523c2f399fe2ea07690f47b7aa9d0ad6de1434d9e020691334b951601465` |
| C | 0.04392800 KAS (4 parcels) | `b20cba8953cac1fd4f135cab9aecd0e7fd13f9a3f218f58afa5947ed2b1fa1df` |

(A single fount start-to-finish is `tools/prove-live.ts`, which prints its own full genesis and claim ids.)

**Channel reuse and fount-restart survival are proven on chain too.** `tools/prove-live-reuse.ts`
gathers a file over **one** channel in two passes and settles the cumulative total in a single claim —
`ccce1de7b0b607e4a7d96a76dea412f1398d89abf72f44157568a286aa9843ab` (0.175 KAS). `tools/prove-live-restart.ts`
kills the fount mid-channel, restarts it, finishes the gather over the same channel, and claims —
`436afd3149f5b9f7e5a6b69305a91c291a6ca1f379fceb67003f31388bcfd254` (0.175 KAS).

One honest constraint is documented: a fount cannot claim **dust** — a payout below roughly 0.02 KAS
trips Kaspa's KIP-9 storage-mass limit (a tiny output is expensive) — so a fount accumulates earnings and
settles in meaningful amounts, the way a Lightning channel is not closed over pennies.

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

## Publisher-pays: the viewer watches for free

The market the one-pager describes — a publisher funds delivery, the crowd earns, the viewer never
pays — now exists in code, not just on the page. The viewer gathers a file for **free** and signs a
**receipt** (`src/receipt.ts`) for each parcel it verifies against the manifest; founts collect those
receipts and are settled from the **publisher's budget** (`src/publisherpays.ts`), never from the
viewer. A fount that serves junk earns no receipt; a claim below the KIP-9 dust floor is held; nothing
exceeds the budget. Proven end to end in-process (`src/receiptgather.test.ts`): three real founts, one
lying, a viewer that pays **zero**, the liar unpaid, the file byte-identical.

**The honest limit, named:** a receipt proves the viewer *says* it received a parcel — not that the
viewer is a real, distinct person. A fount colluding with a fake viewer can mint receipts for a budget.
Signatures and covenants cannot separate a real consumer from a sock puppet; that is a sybil/reputation
problem, still open. What is closed: no pay for junk, no double-count of a parcel, and the viewer pays nothing.

## Finding founts without a tracker (the DHT)

The tracker is a single list of who-holds-what. kascade also has a Kademlia **DHT** that distributes
that list — each node keeps only the records nearest its own id, and any node finds a file's providers
by walking toward the file's id. Run one and point founts and gatherers at it:

```
kascade dhtnode                                  # a DHT node (add --bootstrap <url> to join an existing one)
kascade fount <dir> --dht <nodeUrl> --price 0    # a fount that announces what it holds into the DHT
kascade get  --dht <nodeUrl> <fileId> [--pay]    # resolve providers via the DHT, no tracker
```

Proven with no central list: `tools/prove-dht.ts` stands up a DHT of HTTP nodes and founts, and a
gatherer that knows only one bootstrap node resolves every fount and reassembles the file
byte-identical. (The DHT is off-chain, so this needs no testnet.)

## Status

The Meridian runs end to end: a file reassembles byte-identical from several founts pulled at once,
each paid for its share; a fount serving corrupted bytes is caught by the manifest, paid nothing, and
routed around; stopping partway pays only for what arrived. Payment is real and per-fount on the
kaspa-x402 rail — one channel per fount — and a channel is **reused** across gathers and **survives a
fount restart** (both proven live on testnet-10). Discovery runs either through the tracker or the DHT.

**The honest hard parts, named not faked:**
- **Getting bytes between phones.** Carrier-grade NAT hides mobile devices; two phones can't just
  connect. This needs relays or hole-punching and is the single biggest engineering risk. PCs, routers
  and relays likely carry the early network; phones start as consumers and Wi-Fi cache-holders.
- **A DHT that survives churn.** The DHT works (above), but production needs record expiry/republish,
  liveness eviction from full buckets, and the NAT layer so nodes on real networks can reach each other.
- **Supply needs demand** — one real buyer matters more than a thousand idle nodes.

Part of the suite: [metered](https://github.com/kaspahttp402/metered-protocol) (the rail) ·
[spigot](https://github.com/kaspahttp402/spigot) (one seller) ·
[flume](https://github.com/kaspahttp402/flume) (streaming) ·
[quorum](https://github.com/kaspahttp402/quorum) (trust for compute). Testnet only.

## Licence

MIT.
