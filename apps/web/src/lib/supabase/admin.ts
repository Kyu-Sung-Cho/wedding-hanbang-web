import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyRuntimeSupabaseServiceDestination } from "./destinationFence";

export function createAdminClient(options?: { requestTimeoutMs: number }): SupabaseClient {
  const destination = verifyRuntimeSupabaseServiceDestination();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (options && (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1 || options.requestTimeoutMs > 60_000)) {
    throw new Error("Invalid service request timeout");
  }
  // Validate every construction. A process-global client could otherwise
  // survive an in-process destination/env rotation with stale credentials.
  return createClient(destination.url, key!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(options ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const deadline = AbortSignal.timeout(options.requestTimeoutMs);
      return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
    } } } : {}),
  });
}
