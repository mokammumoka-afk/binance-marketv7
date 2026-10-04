#!/usr/bin/env node
// Generates a fresh VAPID key pair for Web Push — no network, no extra
// dependency (uses Node's built-in crypto). Run once per deployment:
//   node scripts/generate-vapid-keys.mjs
// then copy the three printed lines into .env.local / Vercel env vars.
// NEVER commit the private key or reuse one project's keys in another.
import crypto from 'node:crypto';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

// SPKI DER for a P-256 key is a fixed 26-byte header followed by the
// 65-byte uncompressed EC point (0x04 || X[32] || Y[32]) — i.e. the point
// is always exactly the last 65 bytes of the export.
const spki = publicKey.export({ type: 'spki', format: 'der' });
const point = spki.subarray(spki.length - 65);
const publicKeyB64 = base64url(point);

const jwk = privateKey.export({ format: 'jwk' });
const privateKeyB64 = jwk.d; // 32-byte EC private scalar, already base64url per JWK spec

console.log('# Paste these into .env.local and your Vercel project env vars.');
console.log('# NEXT_PUBLIC_VAPID_PUBLIC_KEY is safe to expose to the browser.');
console.log('# VAPID_PRIVATE_KEY must stay server-only — never NEXT_PUBLIC_, never committed.');
console.log('');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKeyB64}`);
console.log(`VAPID_PRIVATE_KEY=${privateKeyB64}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
