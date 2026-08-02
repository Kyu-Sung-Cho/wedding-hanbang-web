// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  activateSessionCacheActor,
  clearSessionCacheClientState,
  sessionCacheStorageKey,
  withSessionCache,
} from "./sessionCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("actor-scoped session cache", () => {
  beforeEach(() => {
    clearSessionCacheClientState();
    sessionStorage.clear();
  });

  it("never lets actor B restore actor A's cached response", async () => {
    await withSessionCache("community:trending", 60_000, "user:a", async () => ({ title: "A private" }));
    const result = await withSessionCache("community:trending", 60_000, "user:b", async () => ({ title: "B private" }));

    expect(result).toEqual({ title: "B private" });
    expect(sessionStorage.getItem(sessionCacheStorageKey("community:trending", "user:a"))).not.toBeNull();
    expect(sessionStorage.getItem(sessionCacheStorageKey("community:trending", "user:b"))).not.toBeNull();
  });

  it("aborts and rejects an A cache fill that resolves after switching to B", async () => {
    const pendingA = deferred<{ title: string }>();
    let aSignal: AbortSignal | null = null;
    const aRequest = withSessionCache(
      "community:landing:weekly-top-posts:5",
      60_000,
      "user:a",
      async (signal) => {
        aSignal = signal;
        return pendingA.promise;
      },
    );

    activateSessionCacheActor("user:b");
    expect((aSignal as AbortSignal | null)?.aborted).toBe(true);
    pendingA.resolve({ title: "A under-review post" });

    await expect(aRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(sessionStorage.getItem(
      sessionCacheStorageKey("community:landing:weekly-top-posts:5", "user:a"),
    )).toBeNull();

    const bResult = await withSessionCache(
      "community:landing:weekly-top-posts:5",
      60_000,
      "user:b",
      async () => ({ title: "B post" }),
    );
    expect(bResult.title).toBe("B post");
  });

  it("purges scoped entries and invalidates pending work on a privacy reset", async () => {
    await withSessionCache("community:trending", 60_000, "user:a", async () => ["A"]);

    clearSessionCacheClientState("user:a");

    expect(sessionStorage.getItem(sessionCacheStorageKey("community:trending", "user:a"))).toBeNull();
  });
});
