import { describe, expect, it } from "vitest";
import { objectUrl, presign, uriEncode } from "../src/s3-presign";

// The worked example from the AWS SigV4 docs, "Authenticating Requests: Using
// Query Parameters". The same inputs have to give the same signature.
const aws = {
  endpoint: "https://s3.amazonaws.com",
  bucket: "examplebucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  forcePathStyle: false,
};

describe("presign", () => {
  it("matches the AWS documentation vector", async () => {
    const signed = await presign(aws, {
      method: "GET",
      key: "test.txt",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    const url = new URL(signed.url);
    expect(url.origin + url.pathname).toBe("https://examplebucket.s3.amazonaws.com/test.txt");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(signed.expiresAt.toISOString()).toBe("2013-05-25T00:00:00.000Z");
  });

  it("signs the content type into a PUT and tells the caller to send it", async () => {
    const config = { ...aws, endpoint: "http://localhost:9000", forcePathStyle: true };
    const input = { method: "PUT" as const, key: "recordings/a/b/00001", contentType: "video/mp4", now: new Date() };
    const signed = await presign(config, input);
    const other = await presign(config, { ...input, contentType: "video/webm" });
    expect(signed.method).toBe("PUT");
    expect(signed.headers).toEqual({ "content-type": "video/mp4" });
    expect(new URL(signed.url).searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(signed.url.startsWith("http://localhost:9000/examplebucket/recordings/a/b/00001?")).toBe(true);
    expect(new URL(signed.url).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(other.url).searchParams.get("X-Amz-Signature"),
    );
  });

  it("encodes keys the S3 way and keeps the endpoint's own path", () => {
    expect(uriEncode("a b*(c)!'")).toBe("a%20b%2A%28c%29%21%27");
    expect(objectUrl({ ...aws, endpoint: "https://host/prefix/", forcePathStyle: true }, "x/y z").toString()).toBe(
      "https://host/prefix/examplebucket/x/y%20z",
    );
  });
});
