import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

test("web auth storage survives the root-route session gate", async () => {
  const { createBrowserAuthStorage } = await import(
    "../lib/webAuthStorage.mjs"
  );
  const values = new Map();
  const sessionStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  const loginStorage = createBrowserAuthStorage(sessionStorage);
  await loginStorage.setItem("supabase.auth.token", "signed-in-session");

  const rootGateStorage = createBrowserAuthStorage(sessionStorage);
  assert.equal(
    await rootGateStorage.getItem("supabase.auth.token"),
    "signed-in-session",
  );

  await rootGateStorage.removeItem("supabase.auth.token");
  assert.equal(await loginStorage.getItem("supabase.auth.token"), null);
});

test("Supabase sign-in remains available to the root-route session gate", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { createBrowserAuthStorage } = await import(
    "../lib/webAuthStorage.mjs"
  );
  const values = new Map();
  const storage = createBrowserAuthStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  const userId = "00000000-0000-0000-0000-000000000001";
  const fakeFetch = async () =>
    new globalThis.Response(
      JSON.stringify({
        access_token: "header.payload.signature",
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "preview@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  const client = createClient(
    "https://example.supabase.co",
    "anon-key",
    {
      global: { fetch: fakeFetch },
      auth: {
        storage,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const signedIn = await client.auth.signInWithPassword({
    email: "preview@example.com",
    password: "secret",
  });
  assert.equal(signedIn.data.session?.user.id, userId);

  const rootGate = await client.auth.getSession();
  assert.equal(rootGate.data.session?.user.id, userId);
});

test("web auth storage keeps a memory fallback when sessionStorage is unavailable", async () => {
  const { createBrowserAuthStorage } = await import(
    "../lib/webAuthStorage.mjs"
  );
  const storage = createBrowserAuthStorage(null);

  await storage.setItem("supabase.auth.token", "memory-session");
  assert.equal(
    await storage.getItem("supabase.auth.token"),
    "memory-session",
  );

  await storage.removeItem("supabase.auth.token");
  assert.equal(await storage.getItem("supabase.auth.token"), null);
});

test("a failed web session refresh cannot resurrect the previous token", async () => {
  const { createBrowserAuthStorage } = await import(
    "../lib/webAuthStorage.mjs"
  );
  const values = new Map([
    ["supabase.auth.token", "previous-session"],
  ]);
  let rejectNextWrite = true;
  const sessionStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (rejectNextWrite) {
        rejectNextWrite = false;
        throw new Error("QuotaExceededError");
      }
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  const activeSession = createBrowserAuthStorage(sessionStorage);
  await activeSession.setItem("supabase.auth.token", "refreshed-session");
  assert.equal(
    await activeSession.getItem("supabase.auth.token"),
    "refreshed-session",
  );

  await activeSession.removeItem("supabase.auth.token");
  const afterReload = createBrowserAuthStorage(sessionStorage);
  assert.equal(await afterReload.getItem("supabase.auth.token"), null);
});

test("the Supabase client delegates web persistence instead of discarding it", () => {
  const supabaseUrl = new URL("../lib/supabase.ts", import.meta.url);
  const source = readFileSync(fileURLToPath(supabaseUrl), "utf8");

  assert.match(source, /createBrowserAuthStorage/);
  assert.doesNotMatch(
    source,
    /Platform\.OS\s*===\s*["']web["']\)\s*return\s+null/,
  );
});

test("the web offline banner verifies the actual auth service", () => {
  const bannerUrl = new URL(
    "../components/OfflineBanner.tsx",
    import.meta.url,
  );
  const source = readFileSync(fileURLToPath(bannerUrl), "utf8");

  assert.match(source, /auth\/v1\/health/);
  assert.match(source, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(
    source,
    /return\s+typeof navigator[\s\S]*navigator\.onLine\s*!==\s*false/,
  );
});

test("the web login renders authentication failures inside the form", () => {
  const loginUrl = new URL("../../app/(auth)/login.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(loginUrl), "utf8");

  assert.match(source, /setLoginError/);
  assert.match(source, /\{loginError\s*\?\s*\(/);
  assert.match(source, /accessibilityRole="alert"/);
});

test("email validation uses the same trimmed value that login submits", () => {
  const loginUrl = new URL("../../app/(auth)/login.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(loginUrl), "utf8");

  assert.match(
    source,
    /const\s+emailInvalid\s*=\s*emailTouched\s*&&\s*email\.trim\(\)\.length\s*>\s*0\s*&&\s*!isValidEmail\(email\.trim\(\)\)/,
  );
});
