import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as attachPatient } from "@/app/api/auth/attach-patient/route";
import { GET as caregiverLinkStatus, POST as inviteCaregiver } from "@/app/api/auth/caregiver-link/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as caregiverSignup } from "@/app/api/auth/signup/route";
import { POST as wearerSignup } from "@/app/api/auth/wearer-signup/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/server/auth";
import { apiClaims, call, deviceToken, newHousehold, openRouteDb } from "./helpers";

function cookieValue(response: Response, name: string) {
  return (response.headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]+)`))?.[1] ?? null;
}

function expires(response: Response, name: string) {
  return response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${name}=;`));
}

const signUp = (body: unknown) => call(wearerSignup, { method: "POST", path: "/api/auth/wearer-signup", body });

describe("a wearer's own account", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;

  beforeAll(async () => {
    env = await openRouteDb();
  });
  afterAll(() => env.close());

  const credentials = () => ({ email: `${randomUUID().slice(0, 8)}@example.com`, password: "a-long-password" });

  it("signs the wearer in on this device and sends them to connect a caregiver", async () => {
    const { email, password } = credentials();
    const created = await signUp({ wearerName: "Rose", email, password });
    expect(created.status).toBe(201);
    const signup = await created.json();
    expect(signup.signedIn).toBe(true);
    expect(cookieValue(created, DEVICE_COOKIE)).toBeTruthy();

    const signedIn = await call(login, { method: "POST", path: "/api/auth/login", body: { email, password } });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ kind: "wearer", next: "/wearer-connect" });

    const deviceCookie = cookieValue(signedIn, DEVICE_COOKIE);
    expect(deviceCookie).toBeTruthy();
    const settings = await call(getSettings, { path: "/api/settings", auth: { deviceCookie: deviceCookie! } });
    expect(settings.status).toBe(200);

    // The caregiver joins with the code, which is what the connect page waits for.
    const linkedBefore = await call(caregiverLinkStatus, {
      path: "/api/auth/caregiver-link",
      auth: { deviceCookie: deviceCookie! },
    });
    expect(await linkedBefore.json()).toEqual({ linked: false });

    const caregiver = await newHousehold(env.db);
    const attached = await call(attachPatient, {
      method: "POST",
      path: "/api/auth/attach-patient",
      body: { code: signup.code },
      auth: { cookie: caregiver.cookie },
    });
    expect(attached.status).toBe(200);

    const after = await call(login, { method: "POST", path: "/api/auth/login", body: { email, password } });
    expect(await after.json()).toEqual({ kind: "wearer", next: "/wear" });

    // The invite is spent: nothing on this account can hand out a second one.
    const again = await call(inviteCaregiver, {
      method: "POST",
      path: "/api/auth/caregiver-link",
      auth: { deviceCookie: cookieValue(after, DEVICE_COOKIE)! },
    });
    expect(again.status).toBe(409);
  });

  it("only lets the wearer's own account device invite a caregiver", async () => {
    const household = await newHousehold(env.db);
    const paired = await deviceToken(
      apiClaims({ patientId: household.patient._id, deviceId: household.device._id }),
    );
    const invite = await call(inviteCaregiver, {
      method: "POST",
      path: "/api/auth/caregiver-link",
      auth: { deviceCookie: paired },
    });
    expect(invite.status).toBe(403);
  });

  it("rejects a wrong password and an email that is already taken", async () => {
    const { email, password } = credentials();
    expect((await signUp({ wearerName: "Rose", email, password })).status).toBe(201);
    expect((await signUp({ wearerName: "Someone else", email, password })).status).toBe(409);

    const wrong = await call(login, {
      method: "POST",
      path: "/api/auth/login",
      body: { email, password: "not-the-password" },
    });
    expect(wrong.status).toBe(401);
    expect(cookieValue(wrong, DEVICE_COOKIE)).toBeNull();
  });

  it("still gives a code-only wearer, with no account, their pairing code", async () => {
    const created = await signUp({ wearerName: "Rose" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.signedIn).toBe(false);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(cookieValue(created, DEVICE_COOKIE)).toBeNull();
  });

  it("still signs a caregiver in as a caregiver, pointed at the dashboard", async () => {
    const { email, password } = credentials();
    const created = await call(caregiverSignup, {
      method: "POST",
      path: "/api/auth/signup",
      body: { name: "Ada", email, password, wearerName: "Rose" },
    });
    expect(created.status).toBe(201);

    const response = await call(login, { method: "POST", path: "/api/auth/login", body: { email, password } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "caregiver", next: "/dashboard" });
    expect(cookieValue(response, SESSION_COOKIE)).toBeTruthy();
    // One browser, one account: the wearer cookie can't linger and outrank this session.
    expect(expires(response, DEVICE_COOKIE)).toBe(true);
  });

  it("keeps a caregiver from taking an email a wearer account already holds", async () => {
    const { email, password } = credentials();
    expect((await signUp({ wearerName: "Rose", email, password })).status).toBe(201);

    const taken = await call(caregiverSignup, {
      method: "POST",
      path: "/api/auth/signup",
      body: { name: "Ada", email, password, wearerName: "Rose" },
    });
    expect(taken.status).toBe(409);

    // The wearer still signs in with their own password.
    const signedIn = await call(login, { method: "POST", path: "/api/auth/login", body: { email, password } });
    expect((await signedIn.json()).kind).toBe("wearer");
  });
});
