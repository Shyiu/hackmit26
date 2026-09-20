import { readStoredString, writeStoredString } from "@/hooks/use-stored-setting";

// fetch for the app's own JSON API. Throws ApiError with the server's message,
// so a form can show "An item already answers to 'keys'" instead of a status code.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const DEVICE_TOKEN_SETTING = "wearer.deviceToken";

export function readDeviceToken(): string | null {
  const token = readStoredString(DEVICE_TOKEN_SETTING);
  return token || null;
}

export function storeDeviceToken(token: string): void {
  writeStoredString(DEVICE_TOKEN_SETTING, token);
}

export function clearDeviceToken(): void {
  writeStoredString(DEVICE_TOKEN_SETTING, "");
}

/** Fetch for wearer pages, authenticating with this phone's paired token. */
export async function wearerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readDeviceToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401 && token) clearDeviceToken();
  return response;
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: json === undefined ? headers : { "content-type": "application/json", ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}
