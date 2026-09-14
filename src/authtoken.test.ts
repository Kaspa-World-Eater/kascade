import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicKeyHex } from 'metered-protocol';
import { signAuthToken, verifyAuthToken, authOk } from './authtoken.js';

const pubSk = 'c3'.repeat(32);
const pubPk = publicKeyHex(pubSk);
const viewerPk = publicKeyHex('a1'.repeat(32));
const FILE = 'f'.repeat(64);
const soon = () => Date.now() + 60_000;

test('a publisher token verifies for the viewer and file it names, until expiry', () => {
  const t = signAuthToken(pubSk, { viewerPubkey: viewerPk, fileId: FILE, expiry: soon() });
  assert.equal(verifyAuthToken(t, pubPk, viewerPk, FILE), true);
});

test('a token is refused for the wrong publisher, viewer, file, or once expired', () => {
  const t = signAuthToken(pubSk, { viewerPubkey: viewerPk, fileId: FILE, expiry: soon() });
  assert.equal(verifyAuthToken(t, publicKeyHex('b2'.repeat(32)), viewerPk, FILE), false, 'wrong publisher');
  assert.equal(verifyAuthToken(t, pubPk, publicKeyHex('d4'.repeat(32)), FILE), false, 'wrong viewer');
  assert.equal(verifyAuthToken(t, pubPk, viewerPk, 'e'.repeat(64)), false, 'wrong file');
  const dead = signAuthToken(pubSk, { viewerPubkey: viewerPk, fileId: FILE, expiry: Date.now() - 1 });
  assert.equal(verifyAuthToken(dead, pubPk, viewerPk, FILE), false, 'expired');
});

test('authOk is open when no publisher is set, gated when one is', () => {
  const t = signAuthToken(pubSk, { viewerPubkey: viewerPk, fileId: FILE, expiry: soon() });
  assert.equal(authOk(undefined, undefined, viewerPk, FILE), true, 'no auth required');
  assert.equal(authOk(pubPk, undefined, viewerPk, FILE), false, 'required but no token');
  assert.equal(authOk(pubPk, JSON.stringify(t), viewerPk, FILE), true, 'required, valid token');
});
