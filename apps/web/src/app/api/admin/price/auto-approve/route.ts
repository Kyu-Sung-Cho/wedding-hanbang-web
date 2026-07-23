import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 2026-07-22 전량 추출 런 전용 — 자동 검증 통과 유닛('agent_auto_validated' 마커)의
// pending 공시가를 기존 행 검수 RPC(review_official_price_with_alias_proposals)로
// 서버에서 순회 승인한다. 사람이 건수를 보고 눌러야만 실행된다(자동 실행 없음).
const MARKER = "agent_auto_validated";
const MAX_PER_CALL = 500;
const PRIVATE_VARY = "Origin, Sec-Fetch-Site, Authorization";

const requestSchema = z.strictObject({
  confirmation: z.literal("approve_agent_auto_validated_pending"),
  expected_count: z.number().int().min(1).max(MAX_PER_CALL),
});

interface OptionRow {
  id: string;
  name: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  unit: string | null;
  condition: string | null;
  raw_text: string | null;
  source_quote: string | null;
  confidence: number | null;
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { Vary: PRIVATE_VARY } });
}

async function loadEligibleRows(limit: number) {
  const client = getServiceClient();
  // 대상: pending + 자동 검증 마커 + vendor 확정(존재) + 초안 스냅샷
  const { data: rows, error } = await client
    .from("official_prices")
    .select(
      "id, vendor_id, category, item_name, base_spec, price_min_krw, price_max_krw, vat_note, price_note, source_quote, confidence, review_version, validation_issue_codes, snapshot:price_snapshots!inner(published), official_price_options(id, name, price_min_krw, price_max_krw, unit, condition, raw_text, source_quote, confidence)",
    )
    .eq("review_status", "pending")
    .contains("validation_issue_codes", [MARKER])
    .not("vendor_id", "is", null)
    .not("source_quote", "is", null)
    .eq("snapshot.published", false)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error("eligible query failed: " + error.message);
  const candidates = rows ?? [];
  if (candidates.length === 0) return [];
  // dedupe 후보(pending)에 걸린 vendor 제외 (후보 수가 작으므로 전체 조회 후 필터)
  const { data: dedupe, error: dedupeError } = await client
    .from("vendor_dedupe_candidates")
    .select("left_vendor_id, right_vendor_id")
    .eq("status", "pending")
    .limit(2000);
  if (dedupeError) throw new Error("dedupe query failed: " + dedupeError.message);
  const blocked = new Set<string>();
  for (const pair of dedupe ?? []) {
    blocked.add(String(pair.left_vendor_id));
    blocked.add(String(pair.right_vendor_id));
  }
  return candidates.filter((row) => !blocked.has(String(row.vendor_id)));
}

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) return privateJson({ error: "Unauthorized" }, 401);
  try {
    const rows = await loadEligibleRows(MAX_PER_CALL);
    return privateJson({
      eligible_count: rows.length,
      marker: MARKER,
      max_per_call: MAX_PER_CALL,
      criteria: "유닛 자동 검증 통과(confidence≥0.9·갭 0·지어냄 0) AND vendor 확정 AND dedupe 후보 제외",
    });
  } catch {
    return privateJson({ error: "승인 대상 건수를 확인하지 못했습니다.", eligible_count: null }, 503);
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return privateJson({ error: "요청 출처를 확인할 수 없습니다.", code: "UNTRUSTED_MUTATION_ORIGIN" }, 403);
  }
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) return privateJson({ error: "Unauthorized" }, 401);

  const body = await readBoundedUtf8Text(request, 2_048);
  if (!body.ok) return privateJson({ error: "요청 본문을 읽을 수 없습니다." }, 400);
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return privateJson({ error: "확인 값이 올바르지 않습니다." }, 400); }
  const input = requestSchema.safeParse(raw);
  if (!input.success) return privateJson({ error: "확인 값이 올바르지 않습니다." }, 400);

  try {
    const rows = await loadEligibleRows(MAX_PER_CALL);
    if (rows.length === 0) return privateJson({ error: "승인 대상이 없습니다.", code: "NO_ELIGIBLE_ROWS" }, 409);
    if (rows.length !== input.data.expected_count) {
      return privateJson({
        error: `승인 대상이 변경되었습니다 (현재 ${rows.length}건). 건수를 다시 확인해 주세요.`,
        code: "ELIGIBILITY_CHANGED",
        eligible_count: rows.length,
      }, 409);
    }
    const client = getServiceClient();
    let approved = 0, conflicts = 0, failed = 0;
    const failures: { id: string; reason: string }[] = [];
    for (const row of rows) {
      const options = ((row.official_price_options ?? []) as OptionRow[]).map((option) => ({
        id: option.id,
        name: option.name,
        price_min_krw: option.price_min_krw,
        price_max_krw: option.price_max_krw,
        unit: option.unit,
        condition: option.condition,
        raw_text: option.raw_text,
        source_quote: option.source_quote,
        confidence: option.confidence,
      }));
      const { error } = await client.rpc("review_official_price_with_alias_proposals", {
        p_price_id: row.id,
        p_actor_id: admin.userId,
        p_action: "approve",
        p_values: {
          category: row.category,
          item_name: row.item_name,
          base_spec: row.base_spec,
          price_min_krw: row.price_min_krw,
          price_max_krw: row.price_max_krw,
          vat_note: row.vat_note,
          price_note: row.price_note,
          source_quote: row.source_quote,
          confidence: row.confidence,
        },
        p_options: options,
        p_selected_proposal_ids: [],
        p_expected_review_version: row.review_version,
      });
      if (!error) { approved++; continue; }
      const message = typeof error.message === "string" ? error.message : "";
      if (message.includes("PRICE_REVIEW_VERSION_CONFLICT") || error.code === "40001") { conflicts++; continue; }
      failed++;
      if (failures.length < 10) failures.push({ id: String(row.id), reason: message.slice(0, 160) });
    }
    return privateJson({ approved, conflicts, failed, failures, total_targets: rows.length });
  } catch {
    return privateJson({ error: "일괄 승인을 완료하지 못했습니다.", code: "AUTO_APPROVAL_FAILED" }, 503);
  }
}
