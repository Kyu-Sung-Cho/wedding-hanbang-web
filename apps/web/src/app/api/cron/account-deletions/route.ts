import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  AccountDeletionError,
  normalizeAccountDeletionErrorCode,
  processAccountDeletionJob,
  type AccountDeletionJob,
} from "@/lib/accountDeletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const JOBS_PER_RUN = 1;
const CLAIM_LEASE_SECONDS = 600;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function isAccountDeletionCronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;

  const expectedBuffer = Buffer.from(secret, "utf8");
  const suppliedBuffer = Buffer.from(supplied.slice(7), "utf8");
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function isAccountDeletionCronEnabled(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "ACCOUNT_DELETION_CRON_ENABLED">> = process.env,
): boolean {
  if (environment.ACCOUNT_DELETION_CRON_ENABLED === "true") return true;
  if (environment.ACCOUNT_DELETION_CRON_ENABLED === "false") return false;
  return environment.NODE_ENV !== "production";
}

function parseClaimedJobs(value: unknown): AccountDeletionJob[] {
  if (!Array.isArray(value)) throw new AccountDeletionError("JOB_CLAIM_INVALID");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new AccountDeletionError("JOB_CLAIM_INVALID");
    const record = item as Record<string, unknown>;
    if (typeof record.job_id !== "string"
      || typeof record.user_id !== "string"
      || typeof record.reason !== "string"
      || typeof record.attempts !== "number") {
      throw new AccountDeletionError("JOB_CLAIM_INVALID");
    }
    return record as AccountDeletionJob;
  });
}

async function runAccountDeletionWorker(request: Request) {
  if (!isAccountDeletionCronAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAccountDeletionCronEnabled()) {
    return NextResponse.json({ error: "worker_disabled" }, { status: 503 });
  }

  const admin = getAdminClient();
  const workerToken = crypto.randomUUID();
  const { data, error } = await admin.rpc("claim_account_deletion_jobs", {
    p_worker_token: workerToken,
    p_limit: JOBS_PER_RUN,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) {
    console.error("[account-deletion-worker] claim failed");
    return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
  }

  let jobs: AccountDeletionJob[];
  try {
    jobs = parseClaimedJobs(data);
  } catch {
    console.error("[account-deletion-worker] invalid claim payload");
    return NextResponse.json({ error: "invalid_claim_payload" }, { status: 503 });
  }

  const stats = { claimed: jobs.length, completed: 0, retry: 0, deadLetter: 0, claimLost: 0 };
  for (const job of jobs) {
    try {
      await processAccountDeletionJob(admin, job, workerToken);
      stats.completed += 1;
    } catch (caught) {
      const errorCode = caught instanceof AccountDeletionError
        ? caught.code
        : normalizeAccountDeletionErrorCode("UNEXPECTED_FAILURE");
      const { data: failureState, error: failureError } = await admin.rpc(
        "fail_account_deletion_job",
        {
          p_job_id: job.job_id,
          p_worker_token: workerToken,
          p_error_code: errorCode,
        },
      );

      if (failureError || failureState === "claim_lost") {
        stats.claimLost += 1;
      } else if (failureState === "dead_letter") {
        stats.deadLetter += 1;
      } else {
        stats.retry += 1;
      }
      // Deliberately log only the bounded machine code, never user id, email,
      // storage prefix, or a raw provider/database exception.
      console.error(`[account-deletion-worker] processing failed: ${errorCode}`);
    }
  }

  const { data: healthData, error: healthError } = await admin.rpc(
    "account_deletion_queue_health",
  );
  if (healthError || !healthData || typeof healthData !== "object" || Array.isArray(healthData)) {
    console.error("[account-deletion-worker] health probe failed");
    return NextResponse.json({ error: "queue_health_unavailable", ...stats }, { status: 503 });
  }

  const health = healthData as Record<string, unknown>;
  const queueHealth = {
    deadLetter: Number(health.dead_letter ?? 0),
    overdue: Number(health.overdue ?? 0),
    staleProcessing: Number(health.stale_processing ?? 0),
  };
  if (!Object.values(queueHealth).every(Number.isFinite)) {
    console.error("[account-deletion-worker] invalid health payload");
    return NextResponse.json({ error: "queue_health_unavailable", ...stats }, { status: 503 });
  }

  const requiresOperator = Object.values(queueHealth).some((value) => value > 0);
  return NextResponse.json(
    { ok: !requiresOperator, ...stats, queueHealth },
    { status: requiresOperator ? 503 : 200 },
  );
}

export async function GET(request: Request) {
  try {
    return await runAccountDeletionWorker(request);
  } catch {
    console.error("[account-deletion-worker] unhandled worker failure");
    return NextResponse.json({ error: "worker_unavailable" }, { status: 503 });
  }
}
