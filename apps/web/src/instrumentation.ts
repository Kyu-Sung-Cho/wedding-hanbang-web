import * as Sentry from "@sentry/nextjs";
import { verifyRuntimeSupabaseServiceDestination } from "@/lib/supabase/destinationFence";

export async function register() {
  // Raw service-role clients must not be able to start against a contaminated
  // URL/key pair. Individual clients repeat this check as defense in depth.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    verifyRuntimeSupabaseServiceDestination();
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
