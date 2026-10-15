import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmission } from "@/lib/weddingCode36";
import type { Draft36, Pending36, Result36 } from "../storage36";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
class BlockedStorage extends MemoryStorage {
  override getItem(): never { throw new DOMException("blocked", "SecurityError"); }
  override setItem(): never { throw new DOMException("blocked", "SecurityError"); }
  override removeItem(): never { throw new DOMException("blocked", "SecurityError"); }
}
const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
function result(value: number, rating = 3): Result36 {
  return {
    id: id(value), accessToken: id(value + 100), submission: createSubmission(rating),
    pairingStatus: "unpaired", coupleToken: null, savedAt: "2026-10-15T00:00:00.000Z",
  };
}
let local: MemoryStorage;
let session: MemoryStorage;
function storages(localStorage: Storage, sessionStorage: Storage) {
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: sessionStorage });
}
async function reload() {
  vi.resetModules();
  return import("../storage36");
}

describe("36-question browser result, retry and draft persistence", () => {
  beforeEach(() => {
    local = new MemoryStorage(); session = new MemoryStorage();
    storages(local, session); vi.resetModules();
  });

  it("preserves both personal results when a second person completes on the same device", async () => {
    const store = await reload();
    store.storeResult36(result(1, 1)); store.storeResult36(result(2, 5));
    const afterReload = await reload();
    expect(afterReload.readResult36(id(1))?.submission.answers.B1).toBe(1);
    expect(afterReload.readResult36(id(2))?.submission.answers.B1).toBe(5);
    expect(afterReload.readResult36()?.id).toBe(id(2));
    expect(afterReload.readResult36(id(1))?.accessToken).toBe(id(101));
    expect(afterReload.readResult36(id(2))?.accessToken).toBe(id(102));
  });

  it("updates one result's pairing without replacing the other personal result", async () => {
    const store = await reload();
    store.storeResult36(result(1, 2)); store.storeResult36(result(2, 4));
    store.storeResult36({ ...result(1, 2), pairingStatus: "paired", coupleToken: id(999) });
    const afterReload = await reload();
    expect(afterReload.readResult36(id(1))).toMatchObject({ pairingStatus: "paired", coupleToken: id(999) });
    expect(afterReload.readResult36(id(2))).toMatchObject({ pairingStatus: "unpaired", coupleToken: null });
    expect(afterReload.readResult36(id(2))?.submission.answers.B1).toBe(4);
  });

  it("uses a result id only and never interprets an invite token as an owner's result", async () => {
    const store = await reload();
    store.storeResult36({ ...result(1), pairingStatus: "waiting", coupleToken: id(999) });
    expect(store.readResult36(id(999))).toBeNull();
    expect(store.readResult36("invalid")).toBeNull();
  });

  it("preserves the known legacy 16-question backup byte for byte", async () => {
    const legacy = JSON.stringify({ version: "v0.5-candidate.9", answers: { A1: "A" }, savedAt: "old" });
    local.setItem("wc_result_v05", legacy);
    const store = await reload();
    store.storeResult36(result(1)); store.clearDraft36(null); store.clearPending36(null);
    expect(local.getItem("wc_result_v05")).toBe(legacy);
  });

  it("retains an immutable pending submission and access key through a simulated reload", async () => {
    const store = await reload();
    const pending: Pending36 = { submissionId: id(5), accessToken: id(6), submission: createSubmission(2), inviteToken: null };
    store.storePending36(pending);
    const afterReload = await reload();
    expect(afterReload.readPending36(null)).toEqual(pending);
    expect(afterReload.readPending36(id(999))).toBeNull();
    afterReload.clearPending36(null);
    expect((await reload()).readPending36(null)).toBeNull();
  });

  it("keeps retries and drafts separate for individual and two invite contexts", async () => {
    const store = await reload();
    const contexts = [null, id(90), id(91)];
    for (const [index, context] of contexts.entries()) {
      store.storePending36({ submissionId: id(10 + index), accessToken: id(20 + index), submission: createSubmission(index + 1), inviteToken: context });
      const draft: Draft36 = { answers: { B1: index + 1 }, missingReasons: {}, index, step: "questions", compare: false, shareAlias: false, shareNotes: [] };
      store.storeDraft36(context, draft);
    }
    const afterReload = await reload();
    for (const [index, context] of contexts.entries()) {
      expect(afterReload.readPending36(context)?.submission.answers.B1).toBe(index + 1);
      expect(afterReload.readDraft36(context)?.index).toBe(index);
    }
    afterReload.clearPending36(id(90)); afterReload.clearDraft36(id(90));
    expect(afterReload.readPending36(null)).not.toBeNull();
    expect(afterReload.readPending36(id(91))).not.toBeNull();
    expect(afterReload.readDraft36(id(90))).toBeNull();
  });

  it("falls back to tab session storage and retains the personal result after reload", async () => {
    storages(new BlockedStorage(), session);
    const store = await reload();
    expect(store.storeResult36(result(1)).storage).toBe("session");
    const afterReload = await reload();
    expect(afterReload.readResult36(id(1))).toMatchObject({ id: id(1), storage: "session" });
  });

  it("uses only current-memory persistence when both browser storage mechanisms are blocked", async () => {
    storages(new BlockedStorage(), new BlockedStorage());
    const store = await reload();
    expect(store.storeResult36(result(1)).storage).toBe("memory");
    expect(store.readResult36(id(1))?.id).toBe(id(1));
    expect((await reload()).readResult36(id(1))).toBeNull();
  });

  it("rejects corrupted, obsolete and incomplete personal backups", async () => {
    const store = await reload();
    expect(store.parseResult36({ ...result(1), submission: { ...createSubmission(3), questionnaire_version: "v0.5-candidate.9" } })).toBeNull();
    expect(store.parseResult36({ ...result(1), accessToken: "not-a-key" })).toBeNull();
    expect(store.parseResult36({ ...result(1), pairingStatus: "paired", coupleToken: null })).toBeNull();
    expect(store.parseResult36({ ...result(1), submission: { ...createSubmission(3), answers: {} } })).toBeNull();
    local.setItem("wc36:result:" + id(1), "broken JSON");
    expect(store.readResult36(id(1))).toBeNull();
  });

  it("chooses the more recently saved personal record across a stale tab-session fallback and local storage", async () => {
    const old = { ...result(1), savedAt: "2026-10-15T00:00:00.000Z", storage: "session" };
    const current = { ...result(1), pairingStatus: "paired", coupleToken: id(999), savedAt: "2026-10-15T01:00:00.000Z", storage: "local" };
    session.setItem("wc36:result:" + id(1), JSON.stringify(old));
    local.setItem("wc36:result:" + id(1), JSON.stringify(current));
    expect((await reload()).readResult36(id(1))).toMatchObject({ pairingStatus: "paired", coupleToken: id(999) });
  });
});
