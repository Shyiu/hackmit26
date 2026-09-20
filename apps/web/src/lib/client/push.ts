// Web Push on the caregiver's browser. The service worker is public/sw.js.
import { apiFetch } from "./api";

export const SW_URL = "/sw.js";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function toApplicationServerKey(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** Asks for permission if needed, subscribes the browser, and stores it server-side. */
export async function subscribeToPush(): Promise<PushSubscription> {
  const { publicKey } = await apiFetch<{ publicKey: string }>("/api/push/public-key");
  const registration = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toApplicationServerKey(publicKey) as BufferSource,
    }));
  await apiFetch("/api/push/subscribe", { method: "POST", json: subscription.toJSON() });
  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await apiFetch("/api/push/subscribe", { method: "DELETE", json: { endpoint: subscription.endpoint } }).catch(() => null);
  await subscription.unsubscribe();
}
