import * as Sentry from "@sentry/nextjs";
import { isPreviewStubMode } from "@/lib/previewStub";
import { verifyRuntimeSupabaseServiceDestination } from "@/lib/supabase/destinationFence";

export async function register() {
  // A stub Preview must remain a disconnected rendering surface even when
  // Vercel inherited production service credentials or telemetry settings.
  if (isPreviewStubMode()) return;

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

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (isPreviewStubMode()) return;
  return Sentry.captureRequestError(...args);
};
