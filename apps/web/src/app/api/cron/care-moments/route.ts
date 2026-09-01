import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildDueMomentCells,
  type DueMomentCell,
} from "@/lib/amora/momentLoop";
import { buildCareEmailHtml, buildCareEmailSubject } from "@/lib/care/careEmail";
import { kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { inspectScheduleEvents } from "@/utils/scheduleEvents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const CARE_SCAN_PAGE_SIZE = 100;
export const CARE_SCAN_PAGES_PER_RUN = 2;
export const CARE_JOBS_PER_RUN = 100;
const CARE_EMAILS_PER_JOB = 4;
const CARE_LEASE_SECONDS = 90;
const EXECUTION_BUDGET_MS = 105_000;
const SCAN_BUDGET_MS = 30_000;

type Admin = ReturnType<typeof getAdmin>;
type JsonRecord = Record<string, unknown>;

type CareStats = {
  scanDay: string;
  scanned: number;
  enqueued: number;
  scanCompleted: boolean;
  invalidJourneys: number;
  claimed: number;
  chatCompleted: number;
  completed: number;
  completedWithWarnings: number;
  cancelled: number;
  expired: number;
  emails: number;
  emailErrors: number;
  emailWarnings: number;
  failed: number;
  activeBacklog: number;
  oldestActiveAgeSeconds: number;
  deferred: number;
  frequencySkipped: number;
};

function getAdmin() {
  return createAdminClient();
}

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerErrorCode(value: unknown): string {
  const name = objectValue(value)?.name;
  return typeof name === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(name)
    ? name
    : "provider_error";
}

function queueMetric(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`care queue metric invalid: ${name}`);
  }
  return value;
}

async function refreshQueueStats(admin: Admin, stats: CareStats) {
  const { data, error } = await admin.rpc("get_amora_care_queue_stats", {
    p_scan_day: stats.scanDay,
  });
  if (error) throw new Error("care queue stats failed");
  const queue = objectValue(data);
  if (!queue) throw new Error("care queue stats payload invalid");
  stats.failed = queueMetric(queue.failed, "failed");
  stats.activeBacklog = queueMetric(queue.active_backlog, "active_backlog");
  stats.oldestActiveAgeSeconds = queueMetric(
    queue.oldest_active_age_seconds,
    "oldest_active_age_seconds",
  );
  stats.deferred = queueMetric(queue.deferred, "deferred");
  stats.frequencySkipped = queueMetric(queue.frequency_skipped, "frequency_skipped");
}

function careCellFromJob(job: JsonRecord): DueMomentCell {
  const metadata = objectValue(job.metadata);
  const moment = objectValue(metadata?.moment);
  return {
    momentType: (stringValue(moment?.momentType) ?? "wedding_day") as DueMomentCell["momentType"],
    momentLabel: stringValue(moment?.momentLabel) ?? "웨딩 일정",
    cellKind: (stringValue(moment?.cellKind) ?? "d1") as DueMomentCell["cellKind"],
    momentDate: stringValue(moment?.momentDate) ?? stringValue(job.scan_day) ?? "",
    dedupeKey: stringValue(moment?.dedupeKey) ?? stringValue(job.dedupe_key) ?? "care",
    message: stringValue(job.content) ?? "확인할 웨딩 일정이 있어요.",
    memoryKeys: Array.isArray(moment?.memoryKeys)
      ? moment.memoryKeys.filter((value): value is string => typeof value === "string").slice(0, 20)
      : [],
    priority: typeof moment?.priority === "number" ? moment.priority : 0,
  };
}

function emailPayloadFromJob(job: JsonRecord) {
  const storedSubject = stringValue(job.email_subject);
  const storedHtml = stringValue(job.email_html);
  if (storedSubject && storedHtml) return { subject: storedSubject, html: storedHtml };
  const cell = careCellFromJob(job);
  return {
    subject: buildCareEmailSubject(cell),
    html: buildCareEmailHtml({ recipientName: null, cell }),
  };
}

async function scanJourneys(
  admin: Admin,
  scanDay: string,
  scanNow: Date,
  scanDeadline: number,
  stats: CareStats,
) {
  const { data: claimData, error: claimError } = await admin.rpc("claim_amora_care_scan", {
    p_scan_day: scanDay,
    p_lease_seconds: CARE_LEASE_SECONDS,
  });
  if (claimError) throw new Error("care scan claim failed");
  const claim = objectValue(claimData);
  if (claim?.state === "completed") {
    stats.scanCompleted = true;
    return;
  }
  if (claim?.claimed !== true) return;

  const leaseToken = stringValue(claim.lease_token);
  if (!leaseToken) throw new Error("care scan lease token missing");
  let cursorCoupleId = stringValue(claim.last_couple_id);
  let cursorJourneyId = stringValue(claim.last_journey_id);
  const snapshotAt = stringValue(claim.snapshot_at);
  if ((cursorCoupleId && !cursorJourneyId) || (!cursorCoupleId && cursorJourneyId) || !snapshotAt) {
    throw new Error("care scan cursor payload invalid");
  }

  for (let page = 0; page < CARE_SCAN_PAGES_PER_RUN; page += 1) {
    let query = admin
      .from("wedding_journeys")
      .select("id, couple_id, wedding_date, progress")
      .not("couple_id", "is", null)
      .order("couple_id", { ascending: true })
      .order("id", { ascending: true })
      .limit(CARE_SCAN_PAGE_SIZE);
    if (cursorCoupleId && cursorJourneyId) {
      const snapshotFilter = `or(created_at.lte.${snapshotAt},created_at.is.null)`;
      query = query.or(
        `and(${snapshotFilter},couple_id.gt.${cursorCoupleId}),`
        + `and(${snapshotFilter},couple_id.eq.${cursorCoupleId},id.gt.${cursorJourneyId})`,
      );
    } else {
      query = query.or(`created_at.lte.${snapshotAt},created_at.is.null`);
    }
    const { data: journeys, error: journeysError } = await query;
    if (journeysError) throw new Error("care journey scan failed");

    const rows = journeys ?? [];
    let pageEnqueued = 0;
    let processedRows = 0;
    let lastProcessedCoupleId: string | null = null;
    let lastProcessedJourneyId: string | null = null;
    for (const journey of rows) {
      if (Date.now() >= scanDeadline) break;
      const rowCoupleId = stringValue(journey.couple_id);
      const rowJourneyId = stringValue(journey.id);
      if (!rowCoupleId || !rowJourneyId) {
        throw new Error("care journey cursor value invalid");
      }
      const progress = objectValue(journey.progress);
      const inspection = inspectScheduleEvents(progress ?? {});
      if (
        (journey.progress != null && progress === null)
        || inspection.malformedContainer
        || inspection.rejectedCount > 0
        || inspection.truncatedCount > 0
      ) {
        // Count known user-data validation failures without logging tenant IDs
        // or the payload. Unexpected engine exceptions still fail the scan so
        // they retry instead of silently dropping an entire day's care work.
        stats.invalidJourneys += 1;
      }
      const cells: DueMomentCell[] = buildDueMomentCells({
        weddingDate: journey.wedding_date,
        progress,
        // The due-date calculation is pinned to this durable KST scan day.
        // A delayed worker must never silently recalculate yesterday's cell as today.
        now: scanNow,
      });
      let completedRow = true;
      for (const cell of cells) {
        if (Date.now() >= scanDeadline) {
          completedRow = false;
          break;
        }
        const emailSubject = buildCareEmailSubject(cell);
        const emailHtml = buildCareEmailHtml({ recipientName: null, cell });
        const { data: enqueueData, error: enqueueError } = await admin.rpc(
          "enqueue_amora_care_job",
          {
            p_couple_id: journey.couple_id,
            p_scan_day: scanDay,
            p_dedupe_key: cell.dedupeKey,
            p_content: cell.message,
            p_email_subject: emailSubject,
            p_email_html: emailHtml,
            p_metadata: {
              channel: "care_cron",
              scanDay,
              moment: {
                dedupeKey: cell.dedupeKey,
                momentType: cell.momentType,
                momentLabel: cell.momentLabel,
                cellKind: cell.cellKind,
                momentDate: cell.momentDate,
                memoryKeys: cell.memoryKeys.slice(0, 20),
                priority: cell.priority,
              },
            },
          },
        );
        if (enqueueError) {
          // Do not advance the page cursor. A retry safely re-enqueues earlier
          // rows through the database unique key and cannot skip this row.
          throw new Error("care enqueue failed");
        }
        if (objectValue(enqueueData)?.inserted === true) pageEnqueued += 1;
      }
      // A partially enqueued row is deliberately not checkpointed. The next
      // run replays it through the unique dedupe key and completes it safely.
      if (!completedRow) break;
      processedRows += 1;
      lastProcessedCoupleId = rowCoupleId;
      lastProcessedJourneyId = rowJourneyId;
    }

    const consumedWholePage = processedRows === rows.length;
    const completed = consumedWholePage && rows.length < CARE_SCAN_PAGE_SIZE;
    const { error: advanceError } = await admin.rpc("advance_amora_care_scan", {
      p_scan_day: scanDay,
      p_lease_token: leaseToken,
      p_last_couple_id: lastProcessedCoupleId,
      p_last_journey_id: lastProcessedJourneyId,
      p_scanned_count: processedRows,
      p_completed: completed,
      p_enqueued_count: pageEnqueued,
    });
    if (advanceError) throw new Error("care scan cursor advance failed");

    stats.scanned += processedRows;
    stats.enqueued += pageEnqueued;
    cursorCoupleId = lastProcessedCoupleId ?? cursorCoupleId;
    cursorJourneyId = lastProcessedJourneyId ?? cursorJourneyId;
    if (completed) {
      stats.scanCompleted = true;
      break;
    }
    if (!consumedWholePage) break;
  }
}

async function drainJobs(
  admin: Admin,
  resend: Resend | null,
  deadline: number,
  stats: CareStats,
) {
  for (let index = 0; index < CARE_JOBS_PER_RUN && Date.now() < deadline; index += 1) {
    const { data: claimData, error: claimError } = await admin.rpc("claim_amora_care_job", {
      p_lease_seconds: CARE_LEASE_SECONDS,
    });
    if (claimError) throw new Error("care job claim failed");
    const job = objectValue(claimData);
    if (!job) break;
    const jobId = stringValue(job.id);
    const leaseToken = stringValue(job.lease_token);
    if (!jobId || !leaseToken) throw new Error("care job lease payload invalid");
    stats.claimed += 1;

    const { data: prepareData, error: prepareError } = await admin.rpc("prepare_amora_care_job", {
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_email_enabled: Boolean(resend),
    });
    if (prepareError) throw new Error("care job prepare failed");
    const prepared = objectValue(prepareData);
    if (prepared?.state === "cancelled") {
      stats.cancelled += 1;
      continue;
    }
    if (prepared?.state === "expired") {
      stats.expired += 1;
      continue;
    }
    if (prepared?.state === "deferred") {
      stats.deferred += 1;
      continue;
    }
    if (prepared?.state !== "ready") throw new Error("care job prepare state invalid");
    stats.chatCompleted += 1;

    let jobDeferred = false;
    for (let emailIndex = 0; emailIndex < CARE_EMAILS_PER_JOB; emailIndex += 1) {
      const { data: deliveryData, error: deliveryError } = await admin.rpc(
        "claim_amora_care_email_delivery",
        { p_job_id: jobId, p_lease_token: leaseToken },
      );
      if (deliveryError) throw new Error("care email delivery claim failed");
      const delivery = objectValue(deliveryData);
      if (!delivery) break;
      if (delivery.state === "cancelled") {
        stats.cancelled += 1;
        break;
      }
      if (delivery.state === "expired") {
        stats.expired += 1;
        break;
      }
      if (delivery.state === "deferred") {
        stats.deferred += 1;
        jobDeferred = true;
        break;
      }
      if (delivery.state === "warning" || delivery.state === "skipped") {
        stats.emailWarnings += 1;
        if (delivery.reason === "daily_frequency_limit") {
          stats.frequencySkipped += 1;
        }
        continue;
      }
      if (delivery.state !== "ready" || !resend) {
        throw new Error("care email delivery state invalid");
      }

      const deliveryId = stringValue(delivery.id);
      const recipient = stringValue(delivery.email);
      const idempotencyKey = stringValue(delivery.idempotency_key);
      if (!deliveryId || !recipient || !idempotencyKey) {
        throw new Error("care email delivery payload invalid");
      }

      let success = false;
      let providerMessageId: string | null = null;
      let providerError = "provider_error";
      try {
        const email = emailPayloadFromJob(job);
        const result = await resend.emails.send(
          {
            from: "아모라 · 웨딩한방 <noreply@hanbang.ai>",
            to: recipient,
            subject: email.subject,
            html: email.html,
          },
          { idempotencyKey },
        );
        providerMessageId = stringValue(result.data?.id);
        success = !result.error && Boolean(providerMessageId);
        providerError = result.error
          ? providerErrorCode(result.error)
          : providerMessageId
            ? providerError
            : "provider_receipt_missing";
      } catch (error) {
        providerError = providerErrorCode(error);
      }

      const { error: finishDeliveryError } = await admin.rpc(
        "finish_amora_care_email_delivery",
        {
          p_delivery_id: deliveryId,
          p_lease_token: leaseToken,
          p_success: success,
          p_provider_message_id: providerMessageId,
          p_error: success ? null : providerError.slice(0, 500),
        },
      );
      if (finishDeliveryError) throw new Error("care email delivery finish failed");
      if (success) stats.emails += 1;
      else stats.emailErrors += 1;
    }

    // The DB released this lease and moved the whole job to the next window.
    // Finishing with the stale token would both fail and obscure the deferral.
    if (jobDeferred) continue;

    const { data: finishData, error: finishError } = await admin.rpc("finish_amora_care_job", {
      p_job_id: jobId,
      p_lease_token: leaseToken,
    });
    if (finishError) throw new Error("care job finish failed");
    const finishState = objectValue(finishData)?.state;
    if (finishState === "completed") stats.completed += 1;
    else if (finishState === "completed_with_warning") {
      stats.completed += 1;
      stats.completedWithWarnings += 1;
    }
    else if (finishState === "cancelled") stats.cancelled += 1;
    else if (finishState === "expired") stats.expired += 1;
    else if (finishState === "failed") stats.failed += 1;
    else if (finishState !== "pending") throw new Error("care job finish state invalid");
  }
}

export async function runCareCron(input: {
  admin: Admin;
  resend: Resend | null;
  now: Date;
}) {
  const scanDay = ymdInKst(input.now);
  const stats: CareStats = {
    scanDay,
    scanned: 0,
    enqueued: 0,
    scanCompleted: false,
    invalidJourneys: 0,
    claimed: 0,
    chatCompleted: 0,
    completed: 0,
    completedWithWarnings: 0,
    cancelled: 0,
    expired: 0,
    emails: 0,
    emailErrors: 0,
    emailWarnings: 0,
    failed: 0,
    activeBacklog: 0,
    oldestActiveAgeSeconds: 0,
    deferred: 0,
    frequencySkipped: 0,
  };
  const startedAt = Date.now();
  const deadline = startedAt + EXECUTION_BUDGET_MS;
  await scanJourneys(
    input.admin,
    scanDay,
    kstMidnightFromYmd(scanDay),
    Math.min(deadline, startedAt + SCAN_BUDGET_MS),
    stats,
  );
  await drainJobs(input.admin, input.resend, deadline, stats);
  // This DB snapshot also exposes terminal failures performed as claim-time
  // housekeeping, which otherwise return no claimed row to the worker.
  await refreshQueueStats(input.admin, stats);
  return stats;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The kill switch also quarantines already-durable work. Otherwise turning it
  // back on later the same day could send payloads prepared before rollback.
  if (process.env.AMORA_CARE_OUTBOUND_ENABLED !== "true") {
    try {
      const admin = getAdmin();
      const { data, error } = await admin.rpc("quarantine_amora_care_queue", {
        p_reason: "outbound_disabled",
      });
      const quarantined = objectValue(data);
      if (error || !quarantined) throw new Error("care queue quarantine failed");
      return NextResponse.json({
        ok: true,
        enabled: false,
        scanned: 0,
        claimed: 0,
        quarantinedJobs: quarantined.jobs ?? 0,
        quarantinedDeliveries: quarantined.deliveries ?? 0,
      });
    } catch (error) {
      log.error("api/cron/care-moments", error);
      console.error("[care-cron] kill-switch quarantine failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json(
        { error: "care queue quarantine failed" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  if (!process.env.RESEND_API_KEY) {
    // Enabling outbound care means email delivery is part of the contract.
    // Never consume and terminally skip durable jobs because of a bad deploy.
    return NextResponse.json(
      { error: "care email provider is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const admin = getAdmin();
    const resend = new Resend(process.env.RESEND_API_KEY);
    const stats = await runCareCron({ admin, resend, now: new Date() });
    return NextResponse.json({ ok: true, enabled: true, ...stats });
  } catch (error) {
    log.error("api/cron/care-moments", error);
    console.error("[care-cron] durable queue run failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "care queue run failed" }, { status: 500 });
  }
}
