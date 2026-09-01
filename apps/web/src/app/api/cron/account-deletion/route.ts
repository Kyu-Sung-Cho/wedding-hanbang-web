import { NextResponse } from "next/server";
import { log } from "@/utils/log";

import { processAccountDeletionJob } from "@/lib/accountDeletion/communityStorageSaga";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const JOB_LIMIT = 3;
const ACTIVE_STATUSES = [
  "inventorying",
  "inventory_ready",
  "deleting",
  "auth_deleting",
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkerJob = {
  id: string;
  status: typeof ACTIVE_STATUSES[number];
  ready_after: string | null;
};

function isWorkerJob(value: unknown): value is WorkerJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && UUID_RE.test(row.id)
    && typeof row.status === "string"
    && (ACTIVE_STATUSES as readonly string[]).includes(row.status)
    && (
      row.ready_after === null
      || (typeof row.ready_after === "string" && Number.isFinite(Date.parse(row.ready_after)))
    );
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // Keep the durable schema deployable before the legal/product policy and
  // manual-review operating SLA are approved. A scheduled request must be a
  // complete database no-op unless production opts in with the exact value.
  if (process.env.ACCOUNT_DELETION_CRON_ENABLED !== "true") {
    return NextResponse.json(
      { ok: true, enabled: false, status: "disabled" },
      { headers: NO_STORE_HEADERS },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    log.error("api/cron/account-deletion", err);
    return NextResponse.json(
      { error: "account deletion worker unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  let inventory: { data: unknown; error: unknown };
  try {
    inventory = await admin
      .from("account_deletion_jobs")
      .select("id,status,ready_after")
      .in("status", [...ACTIVE_STATUSES])
      // Future token-grace jobs must not occupy the bounded batch and starve
      // other users whose deletion work is already eligible.
      .or(`status.neq.inventory_ready,ready_after.lte.${new Date().toISOString()}`)
      .order("updated_at", { ascending: true })
      .limit(JOB_LIMIT);
  } catch (err) {
    log.error("api/cron/account-deletion", err);
    return NextResponse.json(
      { error: "durable deletion inventory unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const { data, error } = inventory;
  if (error || !Array.isArray(data) || data.some((row) => !isWorkerJob(row))) {
    return NextResponse.json(
      { error: "durable deletion inventory unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const counts = {
    processed: data.length,
    completed: 0,
    pending: 0,
    manualReview: 0,
    retry: 0,
  };
  for (const job of data as WorkerJob[]) {
    try {
      const result = await processAccountDeletionJob(admin, job.id);
      if (result.status === "manual_review") counts.manualReview += 1;
      else counts[result.status] += 1;
    } catch {
      counts.retry += 1;
    }
  }

  return NextResponse.json(
    counts.retry > 0 ? { error: "account deletion retry required", ...counts } : counts,
    { status: counts.retry > 0 ? 503 : 200, headers: NO_STORE_HEADERS },
  );
}
