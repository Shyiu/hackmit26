// Prints a fresh VAPID key pair for Web Push. Paste both into apps/web/.env.local.
// The same P-256 pair web-push's generateVAPIDKeys() makes, without a root dependency.
//
//   pnpm push:keys

import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey().toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
