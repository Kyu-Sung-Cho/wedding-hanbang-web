import { NextResponse } from "next/server";
import { hasOpenAIConfig } from "@/lib/ai/modelConfig";
import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";
import { hasStrongRateLimitKeySecretConfig } from "@/utils/rateLimit";
import {
  hasCanonicalTurnstileHostname,
  hasTurnstileConfig,
  hasTurnstileCredentials,
} from "@/lib/turnstile";

function configuredSupabaseProjectRef() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return null;
  try {
    const hostname = new URL(rawUrl).hostname;
    const match = hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function configuredDeploymentCommit() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return commit && /^[0-9a-f]{40}$/i.test(commit)
    ? commit.toLowerCase()
    : null;
}

export async function GET() {
  return NextResponse.json(
    {
      maintenance: process.env.MAINTENANCE_MODE === "true",
      maintenanceStartedAt: process.env.MAINTENANCE_STARTED_AT_UTC ?? null,
      supabaseProjectRef: configuredSupabaseProjectRef(),
      deployment: configuredDeploymentCommit(),
      rateLimitKeySecretConfigured: hasStrongRateLimitKeySecretConfig(),
      // These are configuration-only signals. Actual hostname/action-bound
      // challenge success remains a separate, human-controlled release gate.
      turnstileCredentialsConfigured: hasTurnstileCredentials(),
      turnstileCanonicalHostnameConfigured: hasCanonicalTurnstileHostname(),
      turnstileConfigured: hasTurnstileConfig(),
      researchCohortApplicationsEnabled: isResearchCohortApplicationsEnabled(),
      accountDeletionCronEnabled: process.env.ACCOUNT_DELETION_CRON_ENABLED === "true",
      // Report the raw deployment switches rather than the effective gated
      // values. Otherwise an invalid private=false/public=true combination
      // would be collapsed to public=false and escape release verification.
      coupleCourtEnabled: process.env.COUPLE_COURT_ENABLED === "true",
      coupleCourtAiEnabled: process.env.COUPLE_COURT_AI_ENABLED === "true",
      coupleCourtPublicEnabled: process.env.COUPLE_COURT_PUBLIC_ENABLED === "true",
      coupleCourtMockEnabled: process.env.COUPLE_COURT_MOCK_ENABLED === "true",
      coupleCourtProviderConfigured: hasOpenAIConfig("primary"),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
