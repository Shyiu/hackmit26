// A presigned S3 PUT URL (AWS Signature Version 4, query-string form), for any
// S3-compatible endpoint. The phone uploads a recording chunk straight to the
// bucket with it; the server never proxies the bytes. WebCrypto only, so it
// runs the same in Node, the edge runtime, and tests.

export type S3Config = {
  /** `https://s3.us-east-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`, or `http://localhost:9000`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** S3-compatible stores accept any region name; AWS wants the real one. */
  region?: string;
  /** Bucket in the path (`endpoint/bucket/key`), which every compatible store supports. Default true. */
  forcePathStyle?: boolean;
};

export type PresignInput = {
  method: "GET" | "PUT";
  key: string;
  /** Signed into the URL, so the request has to send exactly this. */
  contentType?: string;
  /** Seconds until the URL stops working. Default 15 minutes, max 7 days per S3. */
  expiresInSeconds?: number;
  now?: Date;
};

export type PresignedRequest = {
  url: string;
  method: "GET" | "PUT";
  /** The upload has to send exactly these headers, since they're signed. */
  headers: Record<string, string>;
  expiresAt: Date;
};

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(text));
}

/** RFC 3986 encoding, which is stricter than encodeURIComponent about `!'()*`. */
export function uriEncode(text: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/g, "/");
}

function amzDate(date: Date): { stamp: string; day: string } {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { stamp, day: stamp.slice(0, 8) };
}

export function objectUrl(config: S3Config, key: string): URL {
  const endpoint = new URL(config.endpoint);
  const pathStyle = config.forcePathStyle ?? true;
  const url = new URL(endpoint.toString());
  if (!pathStyle) url.host = `${config.bucket}.${endpoint.host}`;
  const base = endpoint.pathname.replace(/\/$/, "");
  url.pathname = `${base}${pathStyle ? `/${config.bucket}` : ""}/${uriEncode(key, false)}`;
  url.search = "";
  return url;
}

export async function presign(config: S3Config, input: PresignInput): Promise<PresignedRequest> {
  const now = input.now ?? new Date();
  const expiresIn = Math.min(Math.max(1, Math.floor(input.expiresInSeconds ?? 15 * 60)), 7 * 24 * 60 * 60);
  const region = config.region ?? "us-east-1";
  const { stamp, day } = amzDate(now);
  const scope = `${day}/${region}/s3/aws4_request`;
  const url = objectUrl(config, input.key);

  // Signed headers ride in the query, so the browser's PUT only has to match them.
  const headers: Record<string, string> = { host: url.host };
  if (input.contentType) headers["content-type"] = input.contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");

  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256(canonicalRequest)].join("\n");

  let signingKey = await hmac(encoder.encode(`AWS4${config.secretAccessKey}`), day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, stringToSign));

  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return {
    url: url.toString(),
    method: input.method,
    headers: Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host")),
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
  };
}
