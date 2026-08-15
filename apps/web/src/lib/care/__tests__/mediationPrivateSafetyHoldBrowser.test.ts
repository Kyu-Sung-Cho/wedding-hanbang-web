import { describe, expect, it, vi } from "vitest";

import {
  createBrowserMediationPrivateSafetyHoldRecord,
  sealBrowserMediationPrivateSafetyHold,
} from "../mediationPrivateSafetyHoldBrowser";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

function memoryJournal() {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

const digest = async () => "a".repeat(64);

describe("browser mediation private safety hold", () => {
  it("persists an opaque digest-bound record in both browser stores", async () => {
    const storage = memoryStorage();
    const journal = memoryJournal();
    const ownerUserId = "10000000-0000-4000-8000-000000000001";
    const coupleId = "20000000-0000-4000-8000-000000000001";

    await expect(sealBrowserMediationPrivateSafetyHold(
      { ownerUserId, coupleId },
      { storage, journal, digest },
    )).resolves.toBe(true);
    const persisted = [...storage.values.entries()];
    expect(persisted).toHaveLength(1);
    expect(persisted[0][0]).toBe(`hb.opaque.v1.${"a".repeat(64)}`);
    expect(JSON.parse(persisted[0][1])).toEqual({
      version: 1,
      active: true,
    });
    expect(JSON.stringify(persisted)).not.toMatch(
      /10000000|20000000|safety|mediation|raw|summary|reason|classification|emotion|intent|disclosure/iu,
    );
  });

  it("reads either persistent store after a fresh-module reload", async () => {
    const owner = {
      ownerUserId: "10000000-0000-4000-8000-000000000010",
      coupleId: "20000000-0000-4000-8000-000000000010",
    };
    const key = `hb.opaque.v1.${"c".repeat(64)}`;
    const record = JSON.stringify({ version: 1, active: true });
    const localOnly = memoryStorage();
    localOnly.setItem(key, record);
    const journalOnly = memoryJournal();
    await journalOnly.set(key, record);

    vi.resetModules();
    const fresh = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(fresh.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: localOnly,
      journal: memoryJournal(),
      digest: async () => "c".repeat(64),
    })).resolves.toBe(true);

    vi.resetModules();
    const freshAgain = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(freshAgain.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: memoryStorage(),
      journal: journalOnly,
      digest: async () => "c".repeat(64),
    })).resolves.toBe(true);

    vi.resetModules();
    const missing = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(missing.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: memoryStorage(),
      journal: memoryJournal(),
      digest: async () => "c".repeat(64),
    })).resolves.toBe(false);
  });

  it("fails closed for corrupt or unreadable digest-bound state", async () => {
    const owner = {
      ownerUserId: "10000000-0000-4000-8000-000000000001",
      coupleId: "20000000-0000-4000-8000-000000000001",
    };
    const stale = createBrowserMediationPrivateSafetyHoldRecord(owner);
    expect(stale).not.toBeNull();
    const staleStorage = memoryStorage();
    staleStorage.setItem(`hb.opaque.v1.${"a".repeat(64)}`, stale!);
    vi.resetModules();
    const freshStale = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(freshStale.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: staleStorage, journal: memoryJournal(), digest,
    })).resolves.toBe(true);

    const corruptStorage = memoryStorage();
    corruptStorage.setItem(`hb.opaque.v1.${"a".repeat(64)}`, "{corrupt");
    vi.resetModules();
    const freshCorrupt = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(freshCorrupt.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: corruptStorage, journal: memoryJournal(), digest,
    })).resolves.toBe(true);

    vi.resetModules();
    const freshUnreadable = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(freshUnreadable.hasBrowserMediationPrivateSafetyHold(owner, {
      storage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => undefined,
      },
      journal: memoryJournal(),
      digest,
    })).resolves.toBe(true);
  });

  it("never throws while sealing an invalid or unwritable lifecycle binding", async () => {
    const storage = memoryStorage();

    await expect(sealBrowserMediationPrivateSafetyHold({
      ownerUserId: "user-1",
      coupleId: "couple-1",
    }, { storage, journal: memoryJournal(), digest })).resolves.toBe(false);
    await expect(sealBrowserMediationPrivateSafetyHold({
      ownerUserId: "user-1",
      coupleId: "couple-1",
    }, { storage, journal: memoryJournal(), digest })).resolves.toBe(false);
    expect(createBrowserMediationPrivateSafetyHoldRecord({
      ownerUserId: "user-1",
      coupleId: "couple-1",
    })).toBeNull();
    await expect(sealBrowserMediationPrivateSafetyHold({
      ownerUserId: "10000000-0000-4000-8000-000000000001",
      coupleId: "20000000-0000-4000-8000-000000000001",
    }, {
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error("blocked"); },
      },
      journal: { get: async () => null, set: async () => { throw new Error("blocked"); } },
      digest,
    })).resolves.toBe(false);
  });

  it("fails safely when browser policy throws while resolving localStorage", async () => {
    const owner = {
      ownerUserId: "10000000-0000-4000-8000-000000000071",
      coupleId: "20000000-0000-4000-8000-000000000071",
    };
    const writeGetter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      await expect(sealBrowserMediationPrivateSafetyHold(owner)).resolves.toBe(false);
    } finally {
      writeGetter.mockRestore();
    }

    vi.resetModules();
    const fresh = await import("../mediationPrivateSafetyHoldBrowser");
    const readGetter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      await expect(fresh.hasBrowserMediationPrivateSafetyHold(owner)).resolves.toBe(true);
      expect(readGetter).toHaveBeenCalled();
    } finally {
      readGetter.mockRestore();
    }
  });

  it("survives a fresh-module reload in IndexedDB when localStorage cannot write", async () => {
    const owner = {
      ownerUserId: "10000000-0000-4000-8000-000000000001",
      coupleId: "20000000-0000-4000-8000-000000000001",
    };
    const journal = memoryJournal();
    const blockedStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    };

    await expect(sealBrowserMediationPrivateSafetyHold(
      owner,
      { storage: blockedStorage, journal, digest },
    )).resolves.toBe(true);
    vi.resetModules();
    const fresh = await import("../mediationPrivateSafetyHoldBrowser");
    await expect(fresh.hasBrowserMediationPrivateSafetyHold(
      owner,
      { storage: memoryStorage(), journal, digest },
    )).resolves.toBe(true);
    expect(JSON.stringify([...journal.values.entries()])).not.toMatch(
      /10000000|20000000|cookie|safety|mediation|raw|summary|reason|classification|emotion|intent|disclosure/iu,
    );
  });

  it("never writes the opaque marker to an HTTP cookie", async () => {
    const before = document.cookie;
    await expect(sealBrowserMediationPrivateSafetyHold({
      ownerUserId: "10000000-0000-4000-8000-000000000099",
      coupleId: "20000000-0000-4000-8000-000000000099",
    }, {
      storage: memoryStorage(),
      journal: memoryJournal(),
      digest: async () => "f".repeat(64),
    })).resolves.toBe(true);
    expect(document.cookie).toBe(before);
  });
});
