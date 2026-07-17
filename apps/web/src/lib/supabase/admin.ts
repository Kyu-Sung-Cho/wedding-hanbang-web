import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyRuntimeSupabaseServiceDestination } from "./destinationFence";

export function createAdminClient(): SupabaseClient {
  const destination = verifyRuntimeSupabaseServiceDestination();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Validate every construction. A process-global client could otherwise
  // survive an in-process destination/env rotation with stale credentials.
  return createClient(destination.url, key!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
