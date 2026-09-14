/**
 * A buyer's on-ramp: where is my money, and has it arrived yet?
 *
 * kascade auto-creates a key the first time a role is used (see keys.ts), and that key IS a wallet.
 * But a fresh key holds nothing, so the first paid request dies with an unhelpful "nothing to spend".
 * This closes that gap without custodying anything: it turns the key into the one address a person
 * funds, reads the balance from chain, and (for `fund`) waits until coins land. It creates no money.
 */
import { identity, type Role } from './keys.js';
import { connect } from './channel.js';
import type { Network, Any } from 'metered-protocol/rail';

export interface WalletState {
  role: Role;
  file: string;
  address: string;
  balanceSompi: bigint;
  utxos: number;
}

const FAUCETS: Partial<Record<Network, string>> = { 'testnet-10': 'https://faucet.kaspanet.io/' };

/** The public faucet for a testnet, or undefined on a network you must fund yourself. */
export const faucetFor = (network: Network): string | undefined => FAUCETS[network];

/** Derive the funding address for a secret key. Pure given the sdk. */
export const addressFor = (sdk: Any, sk: string, network: Network): string =>
  new sdk.PrivateKey(sk).toKeypair().toAddress(new sdk.NetworkId(network)).toString();

/** This role's address and on-chain balance, read live. */
export async function walletState(role: Role, network: Network): Promise<WalletState> {
  const { secretKeyHex, file } = identity(role);
  const { sdk, rpc } = await connect(network);
  try {
    const address = addressFor(sdk, secretKeyHex, network);
    const { entries } = await rpc.getUtxosByAddresses([address]);
    const balanceSompi = entries.reduce((n: bigint, e: Any) => n + e.amount, 0n);
    return { role, file, address, balanceSompi, utxos: entries.length };
  } finally {
    await rpc.disconnect();
  }
}

/** Poll until the address holds at least `minSompi`, then return the funded state. */
export async function awaitFunds(role: Role, network: Network, minSompi: bigint, everyMs = 4000): Promise<WalletState> {
  for (;;) {
    const w = await walletState(role, network);
    if (w.balanceSompi >= minSompi) return w;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
