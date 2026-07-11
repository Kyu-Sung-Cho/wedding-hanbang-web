import { NextResponse } from "next/server";

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
      rateLimitKeySecretConfigured:
        (process.env.RATE_LIMIT_KEY_SECRET?.trim().length ?? 0) >= 32,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
