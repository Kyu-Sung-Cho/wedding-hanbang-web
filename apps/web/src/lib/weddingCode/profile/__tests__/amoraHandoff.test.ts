import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeWeddingCodeAmoraHandoff, createWeddingCodeAmoraHandoff,
  WEDDING_CODE_AMORA_HANDOFF_PARAM, WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY,
  WEDDING_CODE_AMORA_HANDOFF_TTL_MS,
} from "../amoraHandoff";
import { buildOAuthCallbackUrl, getPostLoginRedirectPath } from "@/lib/auth/safeRedirect";

function create() {
  const result = createWeddingCodeAmoraHandoff({ supportOrder: "listen_first", workMode: "hybrid" });
  expect(result).not.toBeNull();
  const url = new URL(result!.href, "https://hanbang.ai");
  return { href: result!.href, nonce: url.searchParams.get(WEDDING_CODE_AMORA_HANDOFF_PARAM)! };
}
describe("explicit WeddingCode help-setting handoff", () => {
  beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("carries only a nonce through login/OAuth and consumes enum changes once", () => {
    const { href, nonce } = create();
    expect(href).not.toMatch(/listen_first|hybrid|answers|code=/);
    const loginSearch = "?" + new URLSearchParams({ redirect: href });
    expect(getPostLoginRedirectPath(loginSearch, "https://hanbang.ai", true)).toBe(href);
    expect(new URL(buildOAuthCallbackUrl(loginSearch, "https://hanbang.ai")).searchParams.get("redirect")).toBe(href);
    expect(consumeWeddingCodeAmoraHandoff(nonce)).toEqual({ supportOrder: "listen_first", workMode: "hybrid" });
    expect(consumeWeddingCodeAmoraHandoff(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY)).toBeNull();
  });
  it("rejects unknown fields, empty changes, undefined and free text without storing them", () => {
    for (const value of [{}, { supportOrder: undefined }, { supportOrder: "my private text" }, { supportOrder: "listen_first", answers: "AAAA" }]) {
      const parsed = JSON.parse(JSON.stringify(value));
      expect(createWeddingCodeAmoraHandoff(parsed)).toBeNull();
    }
    expect(sessionStorage.length).toBe(0);
  });
  it("keeps the real pending intent when an unrelated nonce is presented", () => {
    const { nonce } = create();
    expect(consumeWeddingCodeAmoraHandoff("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(consumeWeddingCodeAmoraHandoff(nonce)).not.toBeNull();
  });
  it.each(["expired", "future", "purpose", "extra", "invalid-enum"] as const)("rejects %s envelopes", (kind) => {
    const { nonce } = create();
    const envelope = JSON.parse(sessionStorage.getItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY)!);
    if (kind === "expired") envelope.createdAt -= WEDDING_CODE_AMORA_HANDOFF_TTL_MS + 1;
    if (kind === "future") envelope.createdAt += 1;
    if (kind === "purpose") envelope.purpose = "other";
    if (kind === "extra") envelope.raw = "private sentence";
    if (kind === "invalid-enum") envelope.changes.workMode = "partner";
    sessionStorage.setItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY, JSON.stringify(envelope));
    expect(consumeWeddingCodeAmoraHandoff(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY)).toBeNull();
  });
  it("fails closed when browser storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(createWeddingCodeAmoraHandoff({ workMode: "together" })).toBeNull();
    spy.mockRestore();
  });
});
