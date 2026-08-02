import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDemoSessionToken,
  getSignedDemoSessionFromCookieHeader,
  verifyDemoSessionToken,
} from "./demoSession";

const STRONG_SECRET = "demo-session-2026-A7z!Q9v#N4k@R8m$T2x";
const SESSION_ID = "A".repeat(22);

function listRuntimeTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listRuntimeTypescriptFiles(path);
    return entry.isFile()
      && path.endsWith(".ts")
      && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("signed demo session boundary", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_SESSION_SECRET", STRONG_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issues independently scoped tokens even within the same millisecond", () => {
    const now = Date.now();

    const first = createDemoSessionToken(now);
    const second = createDemoSessionToken(now);

    expect(first).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("rejects a correctly signed token whose timestamp is too far in the future", () => {
    const now = Date.now();
    const token = createDemoSessionToken(now + 5 * 60 * 1000 + 1, SESSION_ID);

    expect(token).toBeTruthy();
    expect(verifyDemoSessionToken(token, now)).toBe(false);
  });

  it("accepts only the configured lifetime and a small clock-skew window", () => {
    const now = Date.now();
    const justValid = createDemoSessionToken(now - 24 * 60 * 60 * 1000, SESSION_ID);
    const expired = createDemoSessionToken(now - 24 * 60 * 60 * 1000 - 1, SESSION_ID);
    const skewed = createDemoSessionToken(now + 5 * 60 * 1000, SESSION_ID);

    expect(verifyDemoSessionToken(justValid, now)).toBe(true);
    expect(verifyDemoSessionToken(expired, now)).toBe(false);
    expect(verifyDemoSessionToken(skewed, now)).toBe(true);
  });

  it("rejects tampering, legacy timestamp-only tokens, and extra segments", () => {
    const now = Date.now();
    const token = createDemoSessionToken(now, SESSION_ID)!;
    const legacyPayload = String(now);
    const legacySignature = createHmac("sha256", STRONG_SECRET)
      .update(legacyPayload)
      .digest("base64url");
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(verifyDemoSessionToken(tampered, now)).toBe(false);
    expect(verifyDemoSessionToken(`${legacyPayload}.${legacySignature}`, now)).toBe(false);
    expect(verifyDemoSessionToken(`${token}.extra`, now)).toBe(false);
  });

  it("fails closed for missing, short, low-diversity, or placeholder secrets", () => {
    for (const secret of [
      "",
      "too-short",
      "a".repeat(64),
      "replace-with-a-real-demo-session-secret-123456789",
    ]) {
      vi.stubEnv("DEMO_SESSION_SECRET", secret);
      expect(createDemoSessionToken(Date.now(), SESSION_ID)).toBeNull();
    }
  });

  it("requires both the visible marker and the signed HttpOnly session", () => {
    const now = Date.now();
    const token = createDemoSessionToken(now, SESSION_ID)!;

    expect(getSignedDemoSessionFromCookieHeader(`demo_session=${token}`, now)).toBeNull();
    expect(getSignedDemoSessionFromCookieHeader("demo_mode=true", now)).toBeNull();

    const session = getSignedDemoSessionFromCookieHeader(
      `demo_mode=true; demo_session=${token}`,
      now,
    );
    expect(session).toMatchObject({ token, issuedAt: now, sessionId: SESSION_ID });
    expect(session?.dailyCostLedgerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("derives one cost ledger for the KST day and rotates it the next day", () => {
    const beforeKstMidnight = Date.parse("2026-08-02T14:59:59.999Z");
    const afterKstMidnight = Date.parse("2026-08-02T15:00:00.000Z");
    const firstToken = createDemoSessionToken(beforeKstMidnight, "B".repeat(22))!;
    const secondToken = createDemoSessionToken(beforeKstMidnight, "C".repeat(22))!;

    const first = getSignedDemoSessionFromCookieHeader(
      `demo_mode=true; demo_session=${firstToken}`,
      beforeKstMidnight,
    );
    const second = getSignedDemoSessionFromCookieHeader(
      `demo_mode=true; demo_session=${secondToken}`,
      beforeKstMidnight,
    );
    const nextDay = getSignedDemoSessionFromCookieHeader(
      `demo_mode=true; demo_session=${secondToken}`,
      afterKstMidnight,
    );

    expect(first?.dailyCostLedgerId).toBe(second?.dailyCostLedgerId);
    expect(nextDay?.dailyCostLedgerId).not.toBe(first?.dailyCostLedgerId);
  });

  it("keeps visible demo cookie names out of API authorization code", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api");
    const directCookieReaders = listRuntimeTypescriptFiles(apiRoot)
      .filter((path) => /\bdemo_(?:mode|session)\b/.test(readFileSync(path, "utf8")));

    expect(directCookieReaders).toEqual([]);
  });
});
