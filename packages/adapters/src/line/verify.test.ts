import { afterEach, describe, expect, it, vi } from "vitest";
import { readFixture, signedWebhook, signWebhook, TEST_CHANNEL_SECRET } from "./testing.ts";
import { createLineSignatureVerifier, LINE_SIGNATURE_HEADER } from "./verify.ts";

/** LINE's worked example on its signature page, which the design's research recomputed. */
const LINE_EXAMPLE = {
  body: '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}',
  secret: "8c570fa6dd201bb328f1c1eac23a96d8",
  signature: "GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=",
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BODY = readFixture("webhook-private-text.json");
const SIGNATURE = signWebhook(BODY, TEST_CHANNEL_SECRET);
const verify = createLineSignatureVerifier(TEST_CHANNEL_SECRET);

function headersWith(signature: string): Headers {
  return new Headers({ [LINE_SIGNATURE_HEADER]: signature });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLineSignatureVerifier", () => {
  it("accepts LINE's worked example", async () => {
    const check = createLineSignatureVerifier(LINE_EXAMPLE.secret);
    await expect(check(headersWith(LINE_EXAMPLE.signature), LINE_EXAMPLE.body)).resolves.toBe(true);
  });

  it("accepts a fixture signed with the channel secret", async () => {
    const { headers, rawBody } = signedWebhook(BODY);
    await expect(verify(headers, rawBody)).resolves.toBe(true);
  });

  it("accepts the Verify button's body with no events", async () => {
    const { headers, rawBody } = signedWebhook('{"events":[]}');
    await expect(verify(headers, rawBody)).resolves.toBe(true);
  });

  it("rejects the body with one character changed", async () => {
    const tampered = BODY.replace("1790463748405", "1790463748406");
    expect(tampered).not.toBe(BODY);
    await expect(verify(headersWith(SIGNATURE), tampered)).resolves.toBe(false);
  });

  it("rejects the same JSON with its whitespace reformatted", async () => {
    const compact = JSON.stringify(JSON.parse(BODY));
    expect(JSON.parse(compact)).toStrictEqual(JSON.parse(BODY));
    await expect(verify(headersWith(SIGNATURE), compact)).resolves.toBe(false);
  });

  it("rejects the body with its line breaks rewritten as CRLF", async () => {
    const crlf = BODY.replaceAll("\n", "\r\n");
    expect(crlf).not.toBe(BODY);
    await expect(verify(headersWith(SIGNATURE), crlf)).resolves.toBe(false);
  });

  it("rejects a signature made with another channel's secret", async () => {
    const other = signWebhook(BODY, "5f0c3a9e7d2b4816c0e3f5a7b9d1c4e6");
    await expect(verify(headersWith(other), BODY)).resolves.toBe(false);
  });

  it("rejects a webhook without the signature header", async () => {
    await expect(verify(new Headers(), BODY)).resolves.toBe(false);
  });

  it("rejects an empty signature header", async () => {
    await expect(verify(headersWith(""), BODY)).resolves.toBe(false);
  });

  it("rejects a signature that is not Base64", async () => {
    await expect(verify(headersWith("not a signature"), BODY)).resolves.toBe(false);
    await expect(verify(headersWith(`${SIGNATURE.slice(0, 42)}%=`), BODY)).resolves.toBe(false);
  });

  it("rejects Base64 of 31 bytes, the right signature cut short", async () => {
    const short = Buffer.from(SIGNATURE, "base64").subarray(0, 31).toString("base64");
    await expect(verify(headersWith(short), BODY)).resolves.toBe(false);
  });

  it("rejects the right signature without its padding, which atob would accept", async () => {
    await expect(verify(headersWith(SIGNATURE.slice(0, -1)), BODY)).resolves.toBe(false);
  });

  it("rejects another Base64 spelling of the right bytes", async () => {
    // The last character of 32 bytes in Base64 carries two unused bits; flipping one leaves the
    // bytes as they were but the text different.
    const last = BASE64_ALPHABET.indexOf(SIGNATURE.charAt(42));
    const respelled = `${SIGNATURE.slice(0, 42)}${BASE64_ALPHABET.charAt(last ^ 1)}=`;
    expect(Buffer.from(respelled, "base64")).toStrictEqual(Buffer.from(SIGNATURE, "base64"));
    await expect(verify(headersWith(respelled), BODY)).resolves.toBe(false);
  });

  it.each(["x-line-signature", "X-Line-Signature", "X-LINE-SIGNATURE"])(
    "finds the header named %s",
    async (name) => {
      await expect(verify(new Headers({ [name]: SIGNATURE }), BODY)).resolves.toBe(true);
    },
  );

  it("imports the key once, however many webhooks it checks", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const check = createLineSignatureVerifier(TEST_CHANNEL_SECRET);
    for (let count = 0; count < 3; count += 1) {
      await expect(check(headersWith(SIGNATURE), BODY)).resolves.toBe(true);
    }
    expect(importKey).toHaveBeenCalledTimes(1);
  });

  it("refuses the webhook when the key cannot be imported, and imports it again next time", async () => {
    const importKey = vi
      .spyOn(crypto.subtle, "importKey")
      .mockRejectedValueOnce(new Error("import failed"));
    const check = createLineSignatureVerifier(TEST_CHANNEL_SECRET);
    await expect(check(headersWith(SIGNATURE), BODY)).resolves.toBe(false);
    await expect(check(headersWith(SIGNATURE), BODY)).resolves.toBe(true);
    expect(importKey).toHaveBeenCalledTimes(2);
  });

  it("returns false rather than throwing when the headers cannot be read", async () => {
    const unreadable = new Proxy(new Headers(), {
      get() {
        throw new Error("unreadable");
      },
    });
    await expect(verify(unreadable, BODY)).resolves.toBe(false);
  });

  it("refuses an empty channel secret when it is built", () => {
    expect(() => createLineSignatureVerifier("")).toThrow(/empty/);
  });
});
