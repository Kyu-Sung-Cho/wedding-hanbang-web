import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { recordReply } from "@/lib/invitation/inquiryRpc";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

/**
 * 운영자가 받은 답장을 적는다. 원문은 그대로 남기고, 정해진 칸(확정 시간, 제안 시간, 어렵다는 답, 질문,
 * 가격·조건 메모)으로 나눠 적는다. 답장은 아모라에게 주지 않는다(WS3). 확정·제안은 시각이 있어야 한다.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const OUTCOMES = ["confirmed_time", "proposed_time", "declined", "question", "conditions_note"] as const;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const DAY_MS = 24 * 60 * 60 * 1000;

type Params = { params: Promise<{ dispatchId: string }> };

function optionalLine(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return Array.from(trimmed).length <= max && !UNSAFE.test(trimmed) ? trimmed : undefined;
}

export async function POST(request: Request, { params }: Params) {
  if (!isTrustedMutationRequest(request)) return apiError(403, "UNTRUSTED_ORIGIN", "잘못된 요청 출처예요.");
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) return apiError(401, "ADMIN_REQUIRED", "관리자만 할 수 있어요.");
  try {
    const { dispatchId } = await params;
    if (!isUuid(dispatchId)) return apiError(400, "DISPATCH_ID_INVALID", "대기열 줄을 다시 골라 주세요.");
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const value = body.value;
    if (!isRecord(value) || Object.keys(value).some((key) => !["rawText", "outcome", "eventAt", "placeNote", "priceNote"].includes(key))) {
      return apiError(400, "REPLY_INVALID", "입력을 다시 확인해 주세요.");
    }
    const outcome = OUTCOMES.find((item) => item === value.outcome);
    if (!outcome) return apiError(400, "REPLY_INVALID", "답장 종류를 골라 주세요.");

    const rawText = typeof value.rawText === "string"
      ? value.rawText.replace(/\r\n?/g, "\n").replace(/^[ \n]+|[ \n]+$/g, "")
      : "";
    if (Array.from(rawText).length < 1 || Array.from(rawText).length > 4000 || rawText.split("\n").some((line) => UNSAFE.test(line))) {
      return apiError(400, "REPLY_INVALID", "답장 원문을 4,000자 안으로 붙여 넣어 주세요.");
    }

    const needsTime = outcome === "confirmed_time" || outcome === "proposed_time";
    let eventAt: string | null = null;
    if (needsTime) {
      const parsed = typeof value.eventAt === "string" ? Date.parse(value.eventAt) : Number.NaN;
      const now = Date.now();
      if (!Number.isFinite(parsed) || parsed < now - 30 * DAY_MS || parsed > now + 3 * 365 * DAY_MS) {
        return apiError(400, "REPLY_INVALID", "상담 시각을 다시 적어 주세요.");
      }
      eventAt = new Date(parsed).toISOString();
    } else if (value.eventAt !== undefined && value.eventAt !== null) {
      return apiError(400, "REPLY_INVALID", "이 답장 종류에는 시각을 적지 않아요.");
    }
    const placeNote = optionalLine(value.placeNote, 80);
    const priceNote = optionalLine(value.priceNote, 300);
    if (placeNote === undefined || priceNote === undefined) return apiError(400, "REPLY_INVALID", "장소나 가격 메모를 다시 확인해 주세요.");

    const result = await recordReply(createAdminClient(), {
      dispatchId: dispatchId.toLowerCase(),
      operatorUserId: userId,
      rawText,
      outcome,
      eventAt,
      placeNote,
      priceNote,
    });
    if (!result.ok) return apiError(result.status, result.code, result.error);
    return privateJson(result.value, result.value.created ? 201 : 200);
  } catch (error) {
    log.error("[invitation admin replies POST]", error);
    return apiError(500, "SERVER_ERROR", "답장을 적지 못했어요.");
  }
}
