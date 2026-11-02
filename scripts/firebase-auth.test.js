import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { verifyFirebaseIdToken } from '../functions/_lib/firebase.js';

const PROJECT_ID = 'ant05-efa02';
const KEY_ID = 'test-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: KEY_ID, use: 'sig' };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), {
  headers: { 'cache-control': 'public, max-age=3600' },
});

function makeToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }))
    .toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: 'firebase-user-1',
    iat: now,
    exp: now + 3600,
    email: 'person@example.com',
    email_verified: true,
    name: 'Test User',
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  })).toString('base64url');
  const payload = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(payload).end().sign(privateKey, 'base64url');
  return `${payload}.${signature}`;
}

test('accepts a valid, verified Google Firebase ID token', async () => {
  const identity = await verifyFirebaseIdToken(makeToken(), PROJECT_ID);
  assert.deepEqual(identity, {
    uid: 'firebase-user-1',
    email: 'person@example.com',
    displayName: 'Test User',
  });
});

test('rejects a token issued for another Firebase project', async () => {
  await assert.rejects(
    verifyFirebaseIdToken(makeToken({ aud: 'other-project' }), PROJECT_ID),
    /không thuộc tài khoản Google hợp lệ/
  );
});

test('rejects unverified email and non-Google providers', async () => {
  await assert.rejects(
    verifyFirebaseIdToken(makeToken({ email_verified: false }), PROJECT_ID),
    /không thuộc tài khoản Google hợp lệ/
  );
  await assert.rejects(
    verifyFirebaseIdToken(makeToken({ firebase: { sign_in_provider: 'password' } }), PROJECT_ID),
    /không thuộc tài khoản Google hợp lệ/
  );
});

test('rejects expired and modified tokens', async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    verifyFirebaseIdToken(makeToken({ exp: now - 1 }), PROJECT_ID),
    /hết hạn/
  );
  const valid = makeToken();
  const [header, claims, encodedSignature] = valid.split('.');
  const signature = Buffer.from(encodedSignature, 'base64url');
  signature[0] ^= 0xff;
  await assert.rejects(
    verifyFirebaseIdToken(`${header}.${claims}.${signature.toString('base64url')}`, PROJECT_ID),
    /Chữ ký/
  );
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
