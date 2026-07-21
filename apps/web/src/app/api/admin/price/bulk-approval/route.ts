import { NextResponse } from "next/server";

import { verifyAdmin } from "@/lib/utils/adminAuth";

const BATCH_LIMIT = 25;
const BLOCKED_CODE = "VALIDATION_PROVENANCE_NOT_PERSISTED";
const BLOCKED_REASON =
  "현재 스키마에는 production strict 추출과 로컬 deterministic 추출을 불변으로 구분하는 검증 provenance가 없어 자동 승인 대상을 안전하게 증명할 수 없습니다.";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized) {
    return privateJson({ error: "Unauthorized" }, 401);
  }
  return privateJson({
    eligible_count: 0,
    can_execute: false,
    batch_limit: BATCH_LIMIT,
    blocked_code: BLOCKED_CODE,
    blocked_reason: BLOCKED_REASON,
  });
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized) {
    return privateJson({ error: "Unauthorized" }, 401);
  }
  return privateJson({
    eligible_count: 0,
    approved_count: 0,
    conflict_count: 0,
    failed_count: 0,
    batch_limit: BATCH_LIMIT,
    results: [],
    blocked_code: BLOCKED_CODE,
    blocked_reason: BLOCKED_REASON,
  }, 409);
}
