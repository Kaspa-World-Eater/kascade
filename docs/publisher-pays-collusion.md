# Publisher-pays and the collusion problem — what's possible, what isn't

*Research note, 2026-09-14. Publisher-pays delivery is proven end to end and live on testnet
(`tools/prove-live-publisher.ts`): a publisher funds a budget, an unfunded viewer gathers for free
signing a receipt per verified parcel, and the fount claims from the publisher. This note is about the
one thing that mechanism does **not** solve, why it can't be solved by cryptography, and the honest
menu of things that can actually be done.*

## The problem, precisely

In viewer-pays, the person paying is the person receiving — their incentives are aligned, and the
per-parcel voucher is self-policing. **Publisher-pays breaks that alignment on purpose:** a third
party (the publisher) pays for bytes delivered to viewers it may not know. A [receipt](../src/receipt.ts)
proves the viewer *signed* for a parcel that *verified against the manifest*. It does **not** prove the
viewer is a real, distinct consumer.

So the attack: a **fount colludes with a fake viewer** (or a swarm of them — sybils, each a fresh
keypair costing nothing). The fount "serves" parcels to its own puppet, the puppet signs perfectly
valid receipts, and the fount claims them against the publisher's budget. No byte need reach a real
person. The manifest catches *corrupt* bytes; it cannot catch *fake demand*.

## Why cryptography cannot close it

The receiver is the only witness to a delivery, and in this attack the receiver **is** the attacker.
No signature, covenant, or zero-knowledge proof can certify:

- that the signer is a distinct human rather than one of a thousand keypairs, or
- that bytes actually left the fount to a genuine third party rather than to a loopback.

A receipt, a challenge-response "I sent you N bytes" proof, even a Toccata ZK proof of delivery — each
can be produced perfectly by a colluding pair. This is not a gap in our construction; it is a property
of paying a third party for a private, unobservable event. **It is an economics and reputation
problem, not a cryptography problem.**

## How the field actually handles it (grounded, not theoretical)

- **Filecoin Saturn** — the leading Web3 CDN, same publisher-pays shape — does **not** solve this with
  crypto. Its own writeups describe providers "creating fake retrieval requests to collect a bigger
  share of the rewards," handled by a **statistical fraud-detection system on retrieval logs plus
  performance metrics and penalties**, run by a semi-central payout infrastructure. Detection and
  slashing, not proof.
- **Meson Network** was demonstrably sybil-attacked — an attacker spun up ~6,000 fake nodes on a
  compromised cloud account (Sysdig). Open bandwidth markets attract exactly this.
- **BitTorrent** sidesteps it entirely by **not paying** — there is no budget to drain, so no incentive
  to fake a download. The moment you pay a third party, you inherit this problem.

The honest lesson: nobody has *solved* collusion in a paid, open delivery market. The realistic goal is
to **bound the damage, raise the cost, and detect-and-slash** — not to prove it away.

## The menu, rated honestly

| Mitigation | What it buys | What it does not |
|---|---|---|
| **Per-(viewer,file,time) budget caps** | bounds the drain from any one identity | a sybil swarm uses many identities |
| **Fount stake + reputation, slashable** | a caught fount loses a bond; raises the cost of faking | needs someone to *catch* it; see below |
| **Statistical detection** (fresh-key viewers, clique delivery graphs, impossible rates) | catches the crude attacks, like Saturn | an adaptive colluder mimics real traffic; needs an analyzer (a trusted-ish role) |
| **Challenge-response bandwidth proof** | proves bytes were actually pushed to a socket | the socket can be the colluder's; proves bandwidth spent, not a real consumer |
| **Proof-of-personhood / app attestation** | genuinely distinct viewers | heavy, centralizing, privacy-hostile; out of scope for an open mesh |
| **Publisher-authorized viewers** (below) | removes the incentive in the real use case | only applies when the publisher knows its audience |

## The recommendation for kascade

**Two honest modes, named as such — not one dishonest "solved" claim.**

1. **Publisher-authorized delivery (buildable next, and the right default).** The real publisher-pays
   use case is *a site paying to deliver **its** content to **its** users* — and it already
   authenticates those users. So let the publisher issue each viewer a short-lived **signed token**
   (publisher key over `viewer-pubkey ‖ fileId ‖ expiry`); the fount earns a receipt only when the
   viewer presents a valid token, and the publisher only settles receipts from tokens it issued.
   Collusion now requires the *publisher* to collude — against *its own* budget, which is nonsensical.
   This is a small, concrete addition to the receipt handshake (a token field alongside `?viewer=`),
   and it makes publisher-pays trustworthy for the case that actually pays.

2. **Open-network delivery (research, partly unsolvable).** When the publisher does *not* know its
   viewers, fall back to what the field does: fount **stake + reputation** with an off-chain
   **adjudicator** that runs statistical detection and can **slash** a caught fount's bond. kascade
   does not need to invent this — it is exactly [quorum](https://github.com/kaspahttp402/quorum)'s
   job (don't-trust-the-report, adaptive replication/audit, and a Toccata slashable bond, see
   quorum's `docs/covenant-bond.md`). The honest framing: bounded and deterred, never proven.

**What we will not do:** claim kascade "solves" open-network publisher-pays collusion. It doesn't, and
neither does anyone else. The verifiable, live mechanism plus publisher-authorized viewers is a real,
usable product for real buyers; the open-mesh case is a stake-and-detect problem we point at honestly.

## Sources
- Filecoin Saturn economics / fraud detection — https://medium.com/cryptoeconlab/saturn-economics-1ccc5d8b8834 · https://docs.filecoin.io/basics/how-retrieval-works/saturn
- Meson sybil incident (Sysdig) — https://www.sysdig.com/blog/cloud-threats-deploying-crypto-cdn
