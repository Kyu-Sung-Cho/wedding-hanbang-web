import { NextRequest, NextResponse } from "next/server";
import { verifySecretBearerRequest } from "@/lib/auth/secretBearer";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainBookingProjectionJobs } from "@/lib/bookings/projectionOutbox";
import { isRecord } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOBS_PER_RUN = 40;

function queueMetric(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`booking projection queue metric invalid: ${name}`);
  }
  return value;
}

export async function GET(req: NextRequest) {
  if (!verifySecretBearerRequest(req, process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const admin = createAdminClient();
    const drained = await drainBookingProjectionJobs(admin, JOBS_PER_RUN);
    const { data: statsData, error: statsError } = await admin.rpc(
      "get_booking_projection_queue_stats",
    );
    if (statsError || !isRecord(statsData)) {
      throw new Error("booking projection queue stats failed");
    }
    const queue = {
      pending: queueMetric(statsData.pending, "pending"),
      processing: queueMetric(statsData.processing, "processing"),
      failed: queueMetric(statsData.failed, "failed"),
      activeBacklog: queueMetric(statsData.activeBacklog, "activeBacklog"),
      oldestActiveAgeSeconds: queueMetric(
        statsData.oldestActiveAgeSeconds,
        "oldestActiveAgeSeconds",
      ),
    };
    const healthy = queue.failed === 0;

    return NextResponse.json(
      {
        ok: healthy,
        processed: drained.processed,
        completed: drained.completed,
        pendingRetry: drained.pendingRetry,
        failedThisRun: drained.failed,
        queue,
      },
      {
        status: healthy ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error(
      "[booking-projections] durable queue run failed",
      safeErrorDiagnostic(error),
    );
    return NextResponse.json(
      { error: "booking projection queue run failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
