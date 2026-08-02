import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  summarizeSnapshotReadiness,
  type SnapshotEvidenceRow,
} from "@/lib/admin/priceSnapshotReadiness";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { revalidatePath } from "next/cache";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_SNAPSHOTS = 200;
const MAX_EVIDENCE_ROWS_PER_TABLE = 25_000;
const PAGE_SIZE = 1_000;
const MAX_PROMOTION_BODY_BYTES = 2 * 1024;

const SNAPSHOT_COLUMNS = "id, period_label, source, is_current, published_at";
const EVIDENCE_COLUMNS = [
  "id",
  "snapshot_id",
  "review_status",
  "needs_review",
  "source_file",
  "source_quote",
  "source_object_keys",
  "confidence",
].join(", ");

type ServiceClient = ReturnType<typeof getServiceClient>;
type EvidenceTable = "official_prices" | "official_agency_packages";
type UnknownRecord = Record<string, unknown>;

type SafeSnapshot = {
  id: string;
  period_label: string;
  source: string;
  is_current: boolean;
  published_at: string | null;
};

type SafeEvidence = SnapshotEvidenceRow & {
  id: string;
  snapshot_id: string;
};

class SnapshotReadError extends Error {
  constructor(readonly code: "safe_limit" | "changed" | "unavailable") {
    super(code);
  }
}

const promotionRequestSchema = z.strictObject({
  snapshot_id: z.string().uuid(),
  action: z.literal("promote"),
});

type BoundedBodyResult =
  | { status: "ok"; text: string }
  | { status: "invalid" }
  | { status: "too_large" };

async function readBoundedBody(request: Request): Promise<BoundedBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { status: "invalid" };
    }
    if (parsedLength > MAX_PROMOTION_BODY_BYTES) {
      return { status: "too_large" };
    }
  }
  if (!request.body) return { status: "ok", text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_PROMOTION_BODY_BYTES) {
        await reader.cancel("promotion request too large").catch(() => undefined);
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

function rpcErrorFingerprint(error: unknown): string {
  const record = asRecord(error);
  if (!record) return "";
  return [record.code, record.message, record.details, record.hint]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .slice(0, 4_096);
}

function promotionErrorResponse(error: unknown) {
  const fingerprint = rpcErrorFingerprint(error);
  if (
    fingerprint.includes("PRICE_SNAPSHOT_NOT_FOUND")
    || fingerprint.includes("P0002")
  ) {
    return NextResponse.json(
      { error: "스냅샷을 찾을 수 없습니다.", code: "SNAPSHOT_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (
    fingerprint.includes("PRICE_SNAPSHOT_ADMIN_REQUIRED")
    || fingerprint.includes("PRICE_SNAPSHOT_ACTOR_REQUIRED")
    || fingerprint.includes("42501")
  ) {
    return NextResponse.json(
      { error: "관리자 인증을 다시 확인해 주세요.", code: "ADMIN_REQUIRED" },
      { status: 401 },
    );
  }
  if (
    fingerprint.includes("PRICE_SNAPSHOT_ID_REQUIRED")
    || fingerprint.includes("22023")
  ) {
    return NextResponse.json(
      { error: "승격 요청 형식이 올바르지 않습니다.", code: "INVALID_PROMOTION_REQUEST" },
      { status: 400 },
    );
  }
  if (
    fingerprint.includes("PRICE_SNAPSHOT_SOURCE_CHANGED_RETRY")
    || fingerprint.includes("PRICE_SNAPSHOT_CURRENT_INVARIANT_FAILED")
    || fingerprint.includes("40001")
  ) {
    return NextResponse.json(
      {
        error: "다른 변경과 겹쳤습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.",
        code: "SNAPSHOT_PROMOTION_CONFLICT",
      },
      { status: 409 },
    );
  }
  if (
    fingerprint.includes("PRICE_SNAPSHOT_OFFICIAL_PRICES_NOT_READY")
    || fingerprint.includes("PRICE_SNAPSHOT_AGENCY_PACKAGES_NOT_READY")
    || fingerprint.includes("PRICE_SNAPSHOT_NO_PUBLISHABLE_ROWS")
  ) {
    return NextResponse.json(
      {
        error: "아직 공개할 수 없는 항목이 있습니다. 검토 상태와 근거를 확인해 주세요.",
        code: "SNAPSHOT_NOT_READY",
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: "스냅샷을 승격하지 못했습니다.", code: "SNAPSHOT_PROMOTION_FAILED" },
    { status: 500 },
  );
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function parseSnapshot(value: unknown): SafeSnapshot {
  const row = asRecord(value);
  if (
    !row
    || typeof row.id !== "string"
    || typeof row.period_label !== "string"
    || typeof row.source !== "string"
    || typeof row.is_current !== "boolean"
    || (row.published_at !== null && typeof row.published_at !== "string")
  ) {
    throw new SnapshotReadError("unavailable");
  }
  return {
    id: row.id,
    period_label: row.period_label,
    source: row.source,
    is_current: row.is_current,
    published_at: row.published_at,
  };
}

function parseEvidence(value: unknown): SafeEvidence {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.snapshot_id !== "string") {
    throw new SnapshotReadError("unavailable");
  }
  const provenanceComplete = typeof row.source_file === "string"
    && row.source_file.trim().length > 0
    && typeof row.source_quote === "string"
    && row.source_quote.trim().length > 0
    && Array.isArray(row.source_object_keys)
    && row.source_object_keys.length > 0
    && row.confidence !== null
    && row.confidence !== undefined;
  return {
    id: row.id,
    snapshot_id: row.snapshot_id,
    review_status: row.review_status,
    needs_review: row.needs_review,
    provenance_complete: provenanceComplete,
  };
}

function exactCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new SnapshotReadError("unavailable");
  }
  return Number(value);
}

async function confirmStableCount(
  client: ServiceClient,
  table: "price_snapshots" | EvidenceTable,
  expectedCount: number,
) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new SnapshotReadError("unavailable");
  if (exactCount(count) !== expectedCount) throw new SnapshotReadError("changed");
}

async function loadSnapshots(client: ServiceClient): Promise<SafeSnapshot[]> {
  const rows: SafeSnapshot[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;

  while (expectedCount === null || rows.length < expectedCount) {
    const firstPage = expectedCount === null;
    const { data, count, error } = await client
      .from("price_snapshots")
      .select(SNAPSHOT_COLUMNS, firstPage ? { count: "exact" } : undefined)
      .order("source", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("period_label", { ascending: false })
      .order("id", { ascending: true })
      .range(rows.length, rows.length + MAX_SNAPSHOTS - 1);
    if (error || !Array.isArray(data)) throw new SnapshotReadError("unavailable");
    if (firstPage) {
      expectedCount = exactCount(count);
      if (expectedCount > MAX_SNAPSHOTS) throw new SnapshotReadError("safe_limit");
    }
    if (data.length === 0 && rows.length < (expectedCount ?? 0)) {
      throw new SnapshotReadError("changed");
    }
    for (const value of data) {
      const row = parseSnapshot(value);
      if (seen.has(row.id)) throw new SnapshotReadError("changed");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > (expectedCount ?? 0)) throw new SnapshotReadError("changed");
  }

  await confirmStableCount(client, "price_snapshots", expectedCount ?? 0);
  return rows;
}

async function loadEvidenceRows(
  client: ServiceClient,
  table: EvidenceTable,
): Promise<SafeEvidence[]> {
  const rows: SafeEvidence[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;

  while (expectedCount === null || rows.length < expectedCount) {
    const firstPage = expectedCount === null;
    const { data, count, error } = await client
      .from(table)
      .select(EVIDENCE_COLUMNS, firstPage ? { count: "exact" } : undefined)
      .order("snapshot_id", { ascending: true })
      .order("id", { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new SnapshotReadError("unavailable");
    if (firstPage) {
      expectedCount = exactCount(count);
      if (expectedCount > MAX_EVIDENCE_ROWS_PER_TABLE) {
        throw new SnapshotReadError("safe_limit");
      }
    }
    if (data.length === 0 && rows.length < (expectedCount ?? 0)) {
      throw new SnapshotReadError("changed");
    }
    for (const value of data) {
      const row = parseEvidence(value);
      if (seen.has(row.id)) throw new SnapshotReadError("changed");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > (expectedCount ?? 0)) throw new SnapshotReadError("changed");
  }

  await confirmStableCount(client, table, expectedCount ?? 0);
  return rows;
}

function groupEvidence(
  snapshots: SafeSnapshot[],
  rows: SafeEvidence[],
): Map<string, SnapshotEvidenceRow[]> {
  const grouped = new Map(
    snapshots.map((snapshot) => [snapshot.id, [] as SnapshotEvidenceRow[]]),
  );
  for (const row of rows) {
    const destination = grouped.get(row.snapshot_id);
    if (!destination) throw new SnapshotReadError("changed");
    destination.push({
      review_status: row.review_status,
      needs_review: row.needs_review,
      provenance_complete: row.provenance_complete,
    });
  }
  return grouped;
}

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:price-snapshots:list", request, userId),
    { maxRequests: 6, windowMs: 60 * 1000 },
  );
  if (limited) return limited;

  try {
    const client = getServiceClient();
    const snapshots = await loadSnapshots(client);
    const [prices, packages] = await Promise.all([
      loadEvidenceRows(client, "official_prices"),
      loadEvidenceRows(client, "official_agency_packages"),
    ]);
    const pricesBySnapshot = groupEvidence(snapshots, prices);
    const packagesBySnapshot = groupEvidence(snapshots, packages);

    return NextResponse.json({
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        ...summarizeSnapshotReadiness(
          pricesBySnapshot.get(snapshot.id) ?? [],
          packagesBySnapshot.get(snapshot.id) ?? [],
        ),
      })),
    });
  } catch (error) {
    if (error instanceof SnapshotReadError && error.code === "safe_limit") {
      return NextResponse.json(
        {
          error: "안전한 범위 안에서 스냅샷 준비 상태를 계산할 수 없습니다.",
          code: "SNAPSHOT_SAFE_LIMIT_EXCEEDED",
        },
        { status: 503 },
      );
    }
    if (error instanceof SnapshotReadError && error.code === "changed") {
      return NextResponse.json(
        {
          error: "검토 데이터가 변경되었습니다. 잠시 후 다시 확인해 주세요.",
          code: "SNAPSHOT_READINESS_CHANGED",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "스냅샷 준비 상태를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:price-snapshots:promote", request, userId),
    { maxRequests: 6, windowMs: 60 * 60 * 1000 },
  );
  if (limited) return limited;

  const body = await readBoundedBody(request);
  if (body.status === "too_large") {
    return NextResponse.json(
      { error: "요청 데이터가 너무 큽니다." },
      { status: 413 },
    );
  }
  if (body.status === "invalid") {
    return NextResponse.json(
      { error: "승격 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  let rawInput: unknown;
  try {
    rawInput = JSON.parse(body.text);
  } catch {
    return NextResponse.json(
      { error: "승격 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const input = promotionRequestSchema.safeParse(rawInput);
  if (!input.success) {
    return NextResponse.json(
      { error: "승격 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const { error } = await getServiceClient().rpc("promote_price_snapshot", {
      p_snapshot_id: input.data.snapshot_id,
      p_actor_id: userId,
    });
    if (error) return promotionErrorResponse(error);
    revalidatePath("/price", "layout");
    return NextResponse.json({
      promoted: true,
      snapshot_id: input.data.snapshot_id,
    });
  } catch {
    return promotionErrorResponse(null);
  }
}
