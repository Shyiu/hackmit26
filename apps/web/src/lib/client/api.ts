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
