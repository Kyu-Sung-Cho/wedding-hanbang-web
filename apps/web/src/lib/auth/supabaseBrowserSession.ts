"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

type SignOutClient = Pick<SupabaseClient, "auth">;

function authStorageKey(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;

  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function isSessionStorageName(name: string, storageKey: string): boolean {
  const baseNames = [
    storageKey,
    `${storageKey}-code-verifier`,
    `${storageKey}-user`,
  ];
  return baseNames.some((baseName) => (
    name === baseName || name.startsWith(`${baseName}.`)
  ));
}

/**
 * Remove this Supabase project's browser session even when the remote logout
 * endpoint is temporarily unavailable. @supabase/ssr stores the session in
 * non-HttpOnly, root-path cookies and may split large values into chunks.
 */
export function clearSupabaseBrowserSession(
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): void {
  const storageKey = authStorageKey(supabaseUrl);
  if (!storageKey || typeof document === "undefined") return;

  const cookieNames = document.cookie
    .split(";")
    .map((entry) => entry.trim().split("=", 1)[0])
    .filter((name) => name && isSessionStorageName(name, storageKey));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  if (typeof window === "undefined") return;
  for (const readStorage of [
    () => window.localStorage,
    () => window.sessionStorage,
  ]) {
    try {
      const storage = readStorage();
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const name = storage.key(index);
        if (name && isSessionStorageName(name, storageKey)) {
          storage.removeItem(name);
        }
      }
    } catch {
      // Cookie removal is sufficient for the current @supabase/ssr client.
    }
  }

  // A failed remote sign-out returns before auth-js emits SIGNED_OUT. Mirror
  // its same-origin BroadcastChannel event so another open tab immediately
  // purges its UI/cache instead of waiting for the next server request.
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: "SIGNED_OUT", session: null });
      channel.close();
    } catch {
      // Unsupported/private browsing modes still have the shared cookie purge.
    }
  }
}

/**
 * Best-effort remote revocation plus fail-closed local session termination.
 * The caller may continue to the logged-out screen even when Supabase cannot
 * be reached because the local credential is always removed in `finally`.
 */
export async function revokeAndClearSupabaseBrowserSession(
  client: SignOutClient,
): Promise<{ remoteRevoked: boolean }> {
  let remoteRevoked = false;

  try {
    const { error } = await client.auth.signOut();
    remoteRevoked = !error;
  } catch {
    remoteRevoked = false;
  } finally {
    clearSupabaseBrowserSession();
  }

  return { remoteRevoked };
}
