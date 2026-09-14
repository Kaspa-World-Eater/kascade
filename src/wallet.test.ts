import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressFor, faucetFor } from './wallet.js';

// A stand-in for the WASM sdk: it records what it was asked to derive and returns a stable string,
// so we can prove addressFor threads the key and network through the keypair chain without the SDK.
const fakeSdk = {
  PrivateKey: class {
    constructor(private sk: string) {}
    toKeypair() {
      return { toAddress: (n: { id: string }) => ({ toString: () => `kaspatest:${n.id}:${this.sk.slice(0, 4)}` }) };
    }
  },
  NetworkId: class {
    constructor(public id: string) {}
  },
};

test('addressFor derives an address from the key and network through the sdk keypair chain', () => {
  const addr = addressFor(fakeSdk as never, 'deadbeefcafe', 'testnet-10');
  assert.equal(addr, 'kaspatest:testnet-10:dead');
});

test('faucetFor offers a faucet on testnet and nothing on mainnet (fund it yourself)', () => {
  assert.equal(faucetFor('testnet-10'), 'https://faucet.kaspanet.io/');
  assert.equal(faucetFor('mainnet'), undefined);
});
