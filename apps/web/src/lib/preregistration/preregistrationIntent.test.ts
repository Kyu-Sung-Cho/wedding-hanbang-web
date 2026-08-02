// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_PRIVACY_VERSION } from "@hanbang/shared/constants";

import {
  buildPreregistrationConfirmationLink,
  createPreregistrationIntentToken,
  decryptPreregistrationPayload,
  digestPreregistrationEmail,
  digestPreregistrationIntentToken,
  encryptPreregistrationPayload,
  isPreregistrationIntentToken,
  normalizePreregistrationConfirmationLink,
  type PreregistrationIntentPayload,
} from "./preregistrationIntent";

const SECRET = "u0WBxZCz2FyVd4PlQx_7Gm5eN8Hs1KaRjT6Yo9Ic3Eb";
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function nonCanonicalBase64UrlAlias(value: string): string {
  const lastCharacter = value.at(-1);
  const lastIndex = lastCharacter
    ? BASE64URL_ALPHABET.indexOf(lastCharacter)
    : -1;
  const unusedBitCount = value.length % 4 === 2
    ? 4
    : value.length % 4 === 3
      ? 2
      : 0;
  if (lastIndex < 0 || unusedBitCount === 0) {
    throw new Error("BASE64URL_ALIAS_NOT_AVAILABLE");
  }

  const unusedBitMask = (1 << unusedBitCount) - 1;
  if ((lastIndex & unusedBitMask) !== 0) {
    throw new Error("BASE64URL_INPUT_NOT_CANONICAL");
  }

  return `${value.slice(0, -1)}${BASE64URL_ALPHABET[lastIndex | 1]}`;
}

const payload: PreregistrationIntentPayload = {
  email: "person@example.com",
  name: "김한방",
  weddingDate: "2026-12-20",
  role: "bride",
  message: "베타에 참여하고 싶어요.",
  isBetaCandidate: true,
  utmSource: "naver",
  utmMedium: "social",
  utmCampaign: "launch_2026",
  privacyVersion: CURRENT_PRIVACY_VERSION,
};

describe("preregistration double-opt-in secret envelope", () => {
  beforeEach(() => {
    vi.stubEnv("PREREGISTRATION_INTENT_ENCRYPTION_KEY", SECRET);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "");
  });

  it("creates a 256-bit one-time token and stores only its SHA-256 digest", () => {
    const token = createPreregistrationIntentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(isPreregistrationIntentToken(token)).toBe(true);

    const digest = digestPreregistrationIntentToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toContain(token);
  });

  it("encrypts all pending PII with authenticated encryption and rejects tampering", () => {
    const first = encryptPreregistrationPayload(payload);
    const second = encryptPreregistrationPayload(payload);
    expect(first).toMatch(/^v1\./u);
    expect(second).toMatch(/^v1\./u);
    expect(first).not.toBe(second);
    expect(first).not.toContain(payload.email);
    expect(first).not.toContain(payload.name!);
    expect(decryptPreregistrationPayload(first)).toEqual(payload);

    const tampered = `${first!.slice(0, -1)}${first!.endsWith("A") ? "B" : "A"}`;
    expect(decryptPreregistrationPayload(tampered)).toBeNull();
  });

  it("rejects a non-canonical base64url envelope alias", () => {
    const envelope = encryptPreregistrationPayload(payload)!;
    const [version, iv, tag, ciphertext] = envelope.split(".");
    const aliasedTag = nonCanonicalBase64UrlAlias(tag!);

    expect(aliasedTag).not.toBe(tag);
    expect(Buffer.from(aliasedTag, "base64url")).toEqual(
      Buffer.from(tag!, "base64url"),
    );
    expect(decryptPreregistrationPayload(
      [version, iv, aliasedTag, ciphertext].join("."),
    )).toBeNull();
  });

  it("uses a keyed email lookup digest so a database leak cannot enumerate addresses", () => {
    const first = digestPreregistrationEmail(payload.email);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toBe(digestPreregistrationIntentToken(
      createPreregistrationIntentToken(),
    ));

    vi.stubEnv("PREREGISTRATION_INTENT_ENCRYPTION_KEY", `${SECRET}x`);
    expect(digestPreregistrationEmail(payload.email)).not.toBe(first);
  });

  it("fails closed when the encryption key is missing, weak, or the payload drifts", () => {
    vi.stubEnv("PREREGISTRATION_INTENT_ENCRYPTION_KEY", "example-key");
    expect(encryptPreregistrationPayload(payload)).toBeNull();
    expect(digestPreregistrationEmail(payload.email)).toBeNull();

    vi.stubEnv("PREREGISTRATION_INTENT_ENCRYPTION_KEY", SECRET);
    expect(encryptPreregistrationPayload({
      ...payload,
      privacyVersion: "2026-07-01" as typeof CURRENT_PRIVACY_VERSION,
    })).toBeNull();
    expect(encryptPreregistrationPayload({
      ...payload,
      email: "Person@Example.com",
    })).toBeNull();
  });

  it("puts the token in a URL fragment so scanners and HTTP logs receive no token on GET", () => {
    const token = createPreregistrationIntentToken();
    const link = buildPreregistrationConfirmationLink(
      token,
      "https://hanbang.ai",
      true,
    );
    expect(link).toBe(`https://hanbang.ai/preregister/confirm#token=${token}`);

    const url = new URL(link!);
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/preregister/confirm");
    expect(url.hash).toContain(token);
  });

  it("rejects unapproved production origins and malformed tokens", () => {
    expect(buildPreregistrationConfirmationLink(
      "too-short",
      "https://hanbang.ai",
      true,
    )).toBeNull();
    expect(buildPreregistrationConfirmationLink(
      createPreregistrationIntentToken(),
      "https://attacker.example",
      true,
    )).toBeNull();
    const token = createPreregistrationIntentToken();
    expect(normalizePreregistrationConfirmationLink(
      `https://hanbang.ai/preregister/confirm#token=${token}`,
      "https://hanbang.ai",
      true,
    )).toBe(`https://hanbang.ai/preregister/confirm#token=${token}`);
    expect(normalizePreregistrationConfirmationLink(
      `https://hanbang.ai/preregister/confirm?token=${token}`,
      "https://hanbang.ai",
      true,
    )).toBeNull();
    expect(normalizePreregistrationConfirmationLink(
      `https://attacker.example/preregister/confirm#token=${token}`,
      "https://hanbang.ai",
      true,
    )).toBeNull();
  });
});
