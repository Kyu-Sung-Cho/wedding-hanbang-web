import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWeddingTasteDraft, type WeddingTasteDraftV1 } from "./taste";
import { buildOAuthCallbackUrl, getAuthRedirectPath, getPostLoginRedirectPath } from "@/lib/auth/safeRedirect";
import { resolveNeutralPreparationSpaceRedirect } from "@/lib/onboarding/neutralPreparationSpace";
import {
  consumeWeddingTasteChat, consumeWeddingTasteLoginHandoff, createWeddingTasteLoginHandoff,
  getWeddingTasteChatIdentity, peekWeddingTasteChat, prepareWeddingTasteChat,
  WEDDING_TASTE_CHAT_KEY, WEDDING_TASTE_HANDOFF_TTL_MS, WEDDING_TASTE_REVIEW_KEY,
} from "./tasteHandoff";
const auth = vi.hoisted(() => ({ user: { id: "owner" } as { id: string } | null, profile: { id: "owner", couple_id: "couple", role: "bride" }, couple: { id: "couple", bride_id: "owner", groom_id: "partner" }, isDemo: false, isInitialized: true, isLoading: false }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: { getState: () => auth } }));
const draft = (): WeddingTasteDraftV1 => ({ ...createEmptyWeddingTasteDraft(), mood: { status: "answered", values: ["natural"] } });
const nonceFrom = (href: string, param: string) => new URL(href, "https://hanbang.ai").searchParams.get(param)!;
function changeEnvelope(key: string, change: Record<string, unknown>) {
  sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(key)!), ...change }));
}
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks();
  auth.user = { id: "owner" }; auth.profile = { id: "owner", couple_id: "couple", role: "bride" };
  auth.couple = { id: "couple", bride_id: "owner", groom_id: "partner" };
  auth.isDemo = false; auth.isInitialized = true; auth.isLoading = false;
});
describe("wedding taste tab-only handoffs", () => {
  it("goes through login and returns only the nonce to review; consumes once without copying text to browser-wide storage", () => {
    auth.user = null;
    const result = createWeddingTasteLoginHandoff(draft())!;
    expect(result.href.startsWith("/login?")).toBe(true);
    const redirect = nonceFrom(result.href, "redirect");
    expect(redirect.startsWith("/wedding-code/taste?wcTasteReview=")).toBe(true);
    const nonce = nonceFrom(redirect, "wcTasteReview");
    expect(result.href).not.toContain("natural");
    auth.user = { id: "owner" };
    expect(consumeWeddingTasteLoginHandoff(nonce)).toEqual(draft());
    expect(consumeWeddingTasteLoginHandoff(nonce)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
  it("keeps a scoped pending chat available across reads until explicitly consumed", () => {
    const result = prepareWeddingTasteChat(draft())!;
    expect(result.href.startsWith("/chat?scope=private&wcTasteChat=")).toBe(true);
    const nonce = nonceFrom(result.href, "wcTasteChat");
    expect(result.href).not.toContain("natural");
    expect(peekWeddingTasteChat(nonce)).toEqual(draft());
    expect(peekWeddingTasteChat(nonce)).toEqual(draft());
    expect(consumeWeddingTasteChat(nonce)).toEqual(draft());
    expect(consumeWeddingTasteChat(nonce)).toBeNull();
  });
  it.each(["owner", "couple", "role", "demo", "loading", "membership"])("rejects and invalidates an existing chat intent after %s changes", (kind) => {
    const nonce = nonceFrom(prepareWeddingTasteChat(draft())!.href, "wcTasteChat");
    if (kind === "owner") auth.user!.id = "next";
    if (kind === "couple") auth.couple.id = "next";
    if (kind === "role") auth.profile.role = "groom";
    if (kind === "demo") auth.isDemo = true;
    if (kind === "loading") auth.isLoading = true;
    if (kind === "membership") auth.couple.bride_id = "next";
    expect(getWeddingTasteChatIdentity()).toBeNull();
    expect(peekWeddingTasteChat(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(prepareWeddingTasteChat(draft())).toBeNull();
  });
  it.each(["expired", "future", "purpose", "extra", "raw-answer"])("fails closed for %s envelopes", (kind) => {
    const nonce = nonceFrom(prepareWeddingTasteChat(draft())!.href, "wcTasteChat");
    if (kind === "expired") changeEnvelope(WEDDING_TASTE_CHAT_KEY, { createdAt: Date.now() - WEDDING_TASTE_HANDOFF_TTL_MS });
    if (kind === "future") changeEnvelope(WEDDING_TASTE_CHAT_KEY, { createdAt: Date.now() + 5000 });
    if (kind === "purpose") changeEnvelope(WEDDING_TASTE_CHAT_KEY, { purpose: "wedding_taste_login_review" });
    if (kind === "extra") changeEnvelope(WEDDING_TASTE_CHAT_KEY, { text: "원문" });
    if (kind === "raw-answer") changeEnvelope(WEDDING_TASTE_CHAT_KEY, { draft: { ...draft(), answer: "상대 답변" } });
    expect(peekWeddingTasteChat(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
  });
  it("never confuses review and chat purposes even if their contents are copied", () => {
    const href = createWeddingTasteLoginHandoff(draft())!.href;
    const nonce = nonceFrom(nonceFrom(href, "redirect"), "wcTasteReview");
    sessionStorage.setItem(WEDDING_TASTE_CHAT_KEY, sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)!);
    expect(consumeWeddingTasteChat(nonce)).toBeNull();
    expect(consumeWeddingTasteLoginHandoff(nonce)).toEqual(draft());
  });
  it("rejects raw or unknown values and denied storage without network fallback", () => {
    expect(prepareWeddingTasteChat(createEmptyWeddingTasteDraft())).toBeNull();
    expect(createWeddingTasteLoginHandoff({ ...draft(), note: "개인 원문" } as WeddingTasteDraftV1)).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(prepareWeddingTasteChat(draft())).toBeNull();
    expect(createWeddingTasteLoginHandoff(draft())).toBeNull();
  });
  it("a wrong nonce does not destroy the legitimate pending handoff", () => {
    const nonce = nonceFrom(prepareWeddingTasteChat(draft())!.href, "wcTasteChat");
    expect(peekWeddingTasteChat("1a5e8b90-a321-43de-914a-856781930eba")).toBeNull();
    expect(consumeWeddingTasteChat(nonce)).toEqual(draft());
  });
  it("takes an already signed-in owner through existing onboarding and preserves the nonce through every completion resolver", () => {
    auth.profile.couple_id = ""; auth.couple.id = "";
    const result = createWeddingTasteLoginHandoff(draft())!;
    const destination = new URL(result.href, "https://hanbang.ai");
    expect(destination.pathname).toBe("/wedding/onboarding");
    const reviewPath = destination.searchParams.get("redirect")!;
    expect(getAuthRedirectPath(destination.search, destination.origin)).toBe(reviewPath);
    expect(resolveNeutralPreparationSpaceRedirect({ search: destination.search, origin: destination.origin, prefill: "자동 생성 문장" })).toBe(reviewPath);
    const stored = JSON.parse(sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)!);
    expect(stored.originOwnerId).toBe("owner");
    expect(result.href).not.toContain("owner");
    expect(result.href).not.toContain("natural");
    auth.profile.couple_id = "new-couple"; auth.couple.id = "new-couple";
    expect(consumeWeddingTasteLoginHandoff(nonceFrom(reviewPath, "wcTasteReview"))).toEqual(draft());
  });
  it("rejects an owner-bound onboarding review after account change and destroys it before returning to the old account", () => {
    const result = createWeddingTasteLoginHandoff(draft())!;
    const nonce = nonceFrom(nonceFrom(result.href, "redirect"), "wcTasteReview");
    auth.user = { id: "other-owner" };
    expect(consumeWeddingTasteLoginHandoff(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)).toBeNull();
    auth.user = { id: "owner" };
    expect(consumeWeddingTasteLoginHandoff(nonce)).toBeNull();
  });
  it("keeps a guest intent through OAuth and onboarding and consumes only after authentication is ready", () => {
    auth.user = null;
    const result = createWeddingTasteLoginHandoff(draft())!;
    const login = new URL(result.href, "https://hanbang.ai");
    const reviewPath = login.searchParams.get("redirect")!;
    const nonce = nonceFrom(reviewPath, "wcTasteReview");
    expect(JSON.parse(sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)!)).not.toHaveProperty("originOwnerId");
    const callback = new URL(buildOAuthCallbackUrl(login.search, login.origin));
    expect(callback.searchParams.get("redirect")).toBe(reviewPath);
    const onboarding = new URL(getPostLoginRedirectPath(callback.search, login.origin, false), login.origin);
    expect(onboarding.pathname).toBe("/wedding/onboarding");
    expect(getAuthRedirectPath(onboarding.search, login.origin)).toBe(reviewPath);
    expect(consumeWeddingTasteLoginHandoff(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)).not.toBeNull();
    auth.user = { id: "new-owner" }; auth.isLoading = true;
    expect(consumeWeddingTasteLoginHandoff(nonce)).toBeNull();
    expect(sessionStorage.getItem(WEDDING_TASTE_REVIEW_KEY)).not.toBeNull();
    auth.isLoading = false;
    expect(consumeWeddingTasteLoginHandoff(nonce)).toEqual(draft());
  });
  it.each(["review", "chat"])("rejects all-skipped %s creation and tampered stored drafts", purpose => {
    const create = purpose === "review" ? createWeddingTasteLoginHandoff : prepareWeddingTasteChat;
    const key = purpose === "review" ? WEDDING_TASTE_REVIEW_KEY : WEDDING_TASTE_CHAT_KEY;
    expect(create(createEmptyWeddingTasteDraft())).toBeNull();
    const href = create(draft())!.href;
    const nonce = purpose === "review" ? nonceFrom(nonceFrom(href, "redirect"), "wcTasteReview") : nonceFrom(href, "wcTasteChat");
    changeEnvelope(key, { draft: createEmptyWeddingTasteDraft() });
    expect(purpose === "review" ? consumeWeddingTasteLoginHandoff(nonce) : peekWeddingTasteChat(nonce)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
