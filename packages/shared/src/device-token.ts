import { z } from "zod";
import { signToken, verifyToken, type VerifiedToken } from "./signed-token";

// Short-lived tokens that let a capture page talk to the perception service,
// and later let the glasses app call the API. The web app mints them with
// DEVICE_TOKEN_SECRET; services/perception/app/tokens.py verifies the same
// bytes. packages/shared/fixtures/device-token.json is the cross-language check.

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);

export const deviceTokenClaimsSchema = z
  .object({
    v: z.literal(1),
    /** The wearer. Every read and write the token allows is scoped to it. */
    pid: objectIdHex,
    /** The registered device, or null for a caregiver's signed-in page. */
    sub: objectIdHex.nullable(),
    scope: z.enum(["frames", "api"]),
    /** The device's tokenVersion at mint time. Revoking bumps it. */
    tv: z.number().int().nonnegative(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type DeviceTokenClaims = z.infer<typeof deviceTokenClaimsSchema>;

export function signDeviceToken(claims: DeviceTokenClaims, secret: string): Promise<string> {
  return signToken(deviceTokenClaimsSchema, claims, secret);
}

export function verifyDeviceToken(
  token: string,
  secret: string,
  nowSeconds?: number,
): Promise<VerifiedToken<DeviceTokenClaims>> {
  return verifyToken(deviceTokenClaimsSchema, token, secret, nowSeconds);
}
