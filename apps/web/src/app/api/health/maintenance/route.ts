import { NextResponse } from "next/server";
import { hasStrongRateLimitKeySecretConfig } from "@/utils/rateLimit";

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

export async function GET() {
  return NextResponse.json(
    {
      maintenance: process.env.MAINTENANCE_MODE === "true",
      maintenanceStartedAt: process.env.MAINTENANCE_STARTED_AT_UTC ?? null,
      supabaseProjectRef: configuredSupabaseProjectRef(),
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      rateLimitKeySecretConfigured: hasStrongRateLimitKeySecretConfig(),
      accountDeletionCronEnabled: process.env.ACCOUNT_DELETION_CRON_ENABLED === "true",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
