import { beforeEach, describe, expect, it, vi } from "vitest";
import { AMORA_COMPOSER_EXPAND_PARAM, AMORA_COMPOSER_EXPAND_TTL_MS, consumeComposerExpand, getComposerExpandActor, peekComposerExpand, prepareComposerExpand } from "./composerExpandHandoff";
import { AMORA_COMPOSER_EXPAND_KEY, clearAmoraTextDraftRecovery, getAmoraTextDraftRecoveryEpoch } from "./textDraftRecoveryStorage";

const auth = vi.hoisted(() => ({ actor: "actor-a", couple: "couple-a", partner: "partner-a" as string | null, initialized: true, loading: false, demo: false, profileActor: "actor-a", member: true }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: { getState: () => ({
  user: { id: auth.actor }, profile: { id: auth.profileActor, couple_id: auth.couple, role: "bride" },
  couple: { id: auth.couple, bride_id: auth.member ? auth.actor : "outsider", groom_id: auth.partner },
  isInitialized: auth.initialized, isLoading: auth.loading, isDemo: auth.demo,
}) } }));
const draft = (input = "가상 미전송 문장") => ({ input, attachments: [], retryClientRequestId: null });
const prepare = () => prepareComposerExpand("private_ai", draft(), getAmoraTextDraftRecoveryEpoch())!;

describe("explicit panel composer expansion", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); sessionStorage.clear();
    Object.assign(auth, { actor: "actor-a", profileActor: "actor-a", couple: "couple-a", partner: "partner-a", initialized: true, loading: false, demo: false, member: true });
  });
  it("puts only scope and a nonce in the URL and consumes a private draft exactly once", () => {
    const result = prepare();
    const url = new URL(result.href, "https://example.invalid");
    expect([...url.searchParams.keys()]).toEqual(["scope", AMORA_COMPOSER_EXPAND_PARAM]);
    expect(url.searchParams.get("scope")).toBe("private");
    expect(result.href).not.toContain("미전송");
    expect(consumeComposerExpand(result.nonce)).toMatchObject({ actorId: "actor-a", coupleId: "couple-a", lane: "private_ai", input: draft().input });
    expect(consumeComposerExpand(result.nonce)).toBeNull();
  });
  it.each(["actor", "couple", "membership", "profile", "loading", "demo"])("rejects a different or unresolved %s boundary", boundary => {
    const result = prepare();
    if (boundary === "actor") auth.actor = "actor-b";
    if (boundary === "profile") auth.profileActor = "actor-b";
    if (boundary === "couple") auth.couple = "couple-b";
    if (boundary === "membership") auth.member = false;
    if (boundary === "loading") auth.loading = true;
    if (boundary === "demo") auth.demo = true;
    expect(peekComposerExpand(result.nonce)).toBeNull();
  });
  it("rejects logout then the same account and prevents a late panel writer from rearming", () => {
    const epoch = getAmoraTextDraftRecoveryEpoch(); const result = prepare();
    clearAmoraTextDraftRecovery();
    expect(sessionStorage.getItem(AMORA_COMPOSER_EXPAND_KEY)).toBeNull();
    expect(prepareComposerExpand("private_ai", draft(), epoch)).toBeNull();
    expect(peekComposerExpand(result.nonce)).toBeNull();
  });
  it("binds the partner lane to its exact recipient", () => {
    const result = prepareComposerExpand("shared_partner", draft(), getAmoraTextDraftRecoveryEpoch())!;
    expect(peekComposerExpand(result.nonce)?.lane).toBe("shared_partner");
    auth.partner = "partner-b";
    expect(peekComposerExpand(result.nonce)).toBeNull();
    auth.partner = null;
    expect(prepareComposerExpand("shared_partner", draft(), getAmoraTextDraftRecoveryEpoch())).toBeNull();
  });
  it("expires after two minutes and rejects timestamps in the future", () => {
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    const result = prepare();
    vi.mocked(Date.now).mockReturnValue(now + AMORA_COMPOSER_EXPAND_TTL_MS);
    expect(peekComposerExpand(result.nonce)).toBeNull();
    vi.mocked(Date.now).mockReturnValue(now - 1);
    expect(peekComposerExpand(result.nonce)).toBeNull();
  });
  it("excludes attachments, pending reads, separate handoffs and safety scoped text", () => {
    const base = draft(); const epoch = getAmoraTextDraftRecoveryEpoch();
    for (const input of [{ ...base, attachments: [{}] }, { ...base, pendingAttachmentReads: 1 }, { ...base, preparation: {} },
      { ...base, tasteHandoffNonce: "other" }, draft("죽고 싶어"), draft("x".repeat(10_001))]) {
      expect(prepareComposerExpand("private_ai", input, epoch)).toBeNull();
    }
  });
  it("keeps a pure-text unknown-outcome retry key without changing its request identity", () => {
    const retryClientRequestId = "5edabc29-3af6-4287-9583-7a152f584313";
    const result = prepareComposerExpand("shared_ai", { ...draft(), retryClientRequestId }, getAmoraTextDraftRecoveryEpoch())!;
    expect(consumeComposerExpand(result.nonce)?.retryClientRequestId).toBe(retryClientRequestId);
  });
  it("fails closed for malformed storage and unavailable session storage", () => {
    const result = prepare();
    const stored = JSON.parse(sessionStorage.getItem(AMORA_COMPOSER_EXPAND_KEY)!);
    sessionStorage.setItem(AMORA_COMPOSER_EXPAND_KEY, JSON.stringify({ ...stored, extra: "unexpected" }));
    expect(peekComposerExpand(result.nonce)).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(prepare()).toBeNull();
    expect(getComposerExpandActor()).not.toBeNull();
  });
  it("does not report a successful one-shot consumption when storage deletion is blocked", () => {
    const result = prepare();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(consumeComposerExpand(result.nonce)).toBeNull();
    expect(sessionStorage.getItem(AMORA_COMPOSER_EXPAND_KEY)).not.toBeNull();
  });
});
