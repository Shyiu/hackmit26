// Regenerates fixtures/device-token.json, the token both the TypeScript and the
// Python verifier must accept. Only needed if the token format changes.
//
//   pnpm --filter @memory-glasses/shared exec tsx scripts/make-token-fixture.ts

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signDeviceToken, type DeviceTokenClaims } from "../src/device-token";

const secret = "fixture-secret-not-for-real-use-0123456789";
const claims: DeviceTokenClaims = {
  v: 1,
  pid: "5eed00000000000000000001",
  sub: "5eed00000000000000000d01",
  scope: "frames",
  tv: 0,
  iat: 1_790_000_000,
  exp: 1_790_000_900,
};

const token = await signDeviceToken(claims, secret);
const fixture = { secret, claims, token, validAt: 1_790_000_100, expiredAt: 1_790_000_900 };
const target = fileURLToPath(new URL("../fixtures/device-token.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${target}`);
