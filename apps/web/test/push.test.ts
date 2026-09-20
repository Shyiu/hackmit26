import { newId, type NotificationDoc, type NotificationId } from "@memory-glasses/db";
import { WebPushError } from "web-push";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as publicKey } from "@/app/api/push/public-key/route";
import { DELETE as unsubscribe, POST as subscribe } from "@/app/api/push/subscribe/route";
import { pushAlertNotification, pushToCaregivers, type SendPush } from "@/lib/server/push";
import { call, newHousehold, openRouteDb } from "./helpers";

const VAPID = {
  VAPID_PUBLIC_KEY: "BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoiYR1_7MnZvrGSvxi8ZzoZRxJ8LZoiUCTvi9Sw2s",
  VAPID_PRIVATE_KEY: "Ll5VxG2a2b6h1p8GqQe4x1vXq0ZJ3aC9u5wYtC7bY9M",
  VAPID_SUBJECT: "mailto:test@example.com",
};

const subscription = (n: number) => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

function setVapid(on: boolean) {
  for (const [key, value] of Object.entries(VAPID)) {
    if (on) process.env[key] = value;
    else delete process.env[key];
  }
}

describe("Web Push", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let a: Awaited<ReturnType<typeof newHousehold>>;
  let b: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    a = await newHousehold(env.db);
    b = await newHousehold(env.db);
  });
  afterAll(() => env.close());
  afterEach(() => {
    setVapid(true);
    vi.restoreAllMocks();
  });

  describe("routes", () => {
    it("says 503 until VAPID is configured", async () => {
      setVapid(false);
      expect((await call(publicKey, { path: "/api/push/public-key", auth: { cookie: a.cookie } })).status).toBe(503);
      const response = await call(subscribe, {
        path: "/api/push/subscribe",
        body: subscription(1),
        auth: { cookie: a.cookie },
      });
      expect(response.status).toBe(503);
      expect(await a.repos.pushSubscriptions.listForPatient()).toHaveLength(0);
    });

    it("returns the public key to a signed-in caregiver only", async () => {
      const response = await call(publicKey, { path: "/api/push/public-key", auth: { cookie: a.cookie } });
      expect(await response.json()).toEqual({ publicKey: VAPID.VAPID_PUBLIC_KEY });
      expect((await call(publicKey, { path: "/api/push/public-key" })).status).toBe(401);
    });

    it("upserts by endpoint for the session's wearer, never from the body", async () => {
      const body = { ...subscription(2), patientId: b.patient._id.toHexString() };
      const first = await call(subscribe, { path: "/api/push/subscribe", body, auth: { cookie: a.cookie } });
      expect(first.status).toBe(400);

      const created = await call(subscribe, {
        path: "/api/push/subscribe",
        body: subscription(2),
        auth: { cookie: a.cookie },
      });
      expect(created.status).toBe(201);
      const again = await call(subscribe, {
        path: "/api/push/subscribe",
        body: { ...subscription(2), keys: { p256dh: "rotated", auth: "rotated" } },
        auth: { cookie: a.cookie },
      });
      expect(again.status).toBe(201);

      const mine = await a.repos.pushSubscriptions.listForPatient();
      expect(mine.map((s) => s.endpoint)).toEqual([subscription(2).endpoint]);
      expect(mine[0].keys.p256dh).toBe("rotated");
      expect(mine[0].caregiverId.equals(a.caregiver._id)).toBe(true);
      expect(await b.repos.pushSubscriptions.listForPatient()).toHaveLength(0);
    });

    it("removes by endpoint within the tenant", async () => {
      await call(subscribe, { path: "/api/push/subscribe", body: subscription(3), auth: { cookie: a.cookie } });
      const other = await call(unsubscribe, {
        method: "DELETE",
        path: "/api/push/subscribe",
        body: { endpoint: subscription(3).endpoint },
        auth: { cookie: b.cookie },
      });
      expect(await other.json()).toEqual({ removed: false });
      const own = await call(unsubscribe, {
        method: "DELETE",
        path: "/api/push/subscribe",
        body: { endpoint: subscription(3).endpoint },
        auth: { cookie: a.cookie },
      });
      expect(await own.json()).toEqual({ removed: true });
    });

    it("refuses a device token", async () => {
      const response = await call(subscribe, { path: "/api/push/subscribe", body: subscription(4), auth: {} });
      expect(response.status).toBe(401);
    });
  });

  describe("pushToCaregivers", () => {
    const payload = { title: "Possible danger", body: "Stove left on", url: "/dashboard", tag: "danger-1" };

    it("sends to every subscription of the wearer, deletes the gone ones, and never throws", async () => {
      const household = await newHousehold(env.db);
      const repo = household.repos.pushSubscriptions;
      for (const n of [10, 11, 12]) {
        await repo.upsertByEndpoint({ caregiverId: household.caregiver._id, userAgent: null, ...subscription(n) });
      }
      await b.repos.pushSubscriptions.upsertByEndpoint({ caregiverId: b.caregiver._id, userAgent: null, ...subscription(13) });
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const send = vi.fn<SendPush>(async (target) => {
        const endpoint = typeof target === "string" ? target : target.endpoint;
        if (endpoint.endsWith("/11")) throw new WebPushError("gone", 410, {}, "", endpoint);
        if (endpoint.endsWith("/12")) throw new Error("network down");
        return { statusCode: 201, body: "", headers: {} };
      });
      const report = await pushToCaregivers(env.db, household.patient._id, payload, send);

      expect(report).toEqual({ sent: 1, expired: 1, failed: 1, configured: true });
      expect(send).toHaveBeenCalledTimes(3);
      const sentTo = send.mock.calls.map(([target]) => (typeof target === "string" ? target : target.endpoint));
      expect(sentTo).not.toContain(subscription(13).endpoint);
      expect(send.mock.calls[0][1]).toBe(JSON.stringify(payload));
      expect(send.mock.calls[0][2]).toMatchObject({
        urgency: "high",
        vapidDetails: { publicKey: VAPID.VAPID_PUBLIC_KEY, subject: VAPID.VAPID_SUBJECT },
      });

      const left = await repo.listForPatient();
      expect(left.map((s) => s.endpoint).sort()).toEqual([subscription(10).endpoint, subscription(12).endpoint]);
      expect(left.find((s) => s.endpoint.endsWith("/10"))?.lastUsedAt).toBeInstanceOf(Date);
      expect(left.find((s) => s.endpoint.endsWith("/12"))?.lastUsedAt).toBeNull();
    });

    it("does nothing without VAPID and reports it", async () => {
      setVapid(false);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi.fn<SendPush>();
      const report = await pushToCaregivers(env.db, a.patient._id, payload, send);
      expect(report).toEqual({ sent: 0, expired: 0, failed: 0, configured: false });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("pushAlertNotification", () => {
    it("pushes danger and lost alerts once each, and nothing else", async () => {
      // Nothing is subscribed for this wearer by now, so the detached sends have no one to reach.
      for (const s of await a.repos.pushSubscriptions.listForPatient()) await a.repos.pushSubscriptions.deleteByEndpoint(s.endpoint);
      const danger = await a.repos.notifications.create({ kind: "danger_alert", text: "Stove on", createdBy: null });
      // `lost_alert` joins notificationKind with the lost-alert work; the hook is keyed by string.
      const lost = { ...danger, _id: newId<NotificationId>(), kind: "lost_alert" as NotificationDoc["kind"] };
      const reminder = await a.repos.notifications.create({ kind: "reminder", text: "Take pills", createdBy: null });
      expect(pushAlertNotification(env.db, danger)).toBe(true);
      expect(pushAlertNotification(env.db, danger)).toBe(false);
      expect(pushAlertNotification(env.db, lost)).toBe(true);
      expect(pushAlertNotification(env.db, reminder)).toBe(false);
    });
  });
});
