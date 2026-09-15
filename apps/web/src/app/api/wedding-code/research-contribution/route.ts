import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseWeddingCodeResearchContribution } from "@/lib/weddingCode/contribution/contract";
import {
  createWeddingCodeResearchReceipt,
  isWeddingCodeResearchContributionOpen,
} from "@/lib/weddingCode/contribution/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1024;

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * 웨딩코드 답 익명 보태기.
 *
 * 과거 `/api/wedding-code/response`(410 유지)와 다른 경로·다른 테이블이다. 저장은
 * `insert_wedding_code_research_contribution` RPC 하나로만 하고, 요청에서 계정·IP·링크를
 * 읽어 저장하지 않는다. IP는 남용 방지 버킷 키로만 HMAC 처리돼 쓰인다.
 */
export async function POST(request: Request) {
  if (!isWeddingCodeResearchContributionOpen()) {
    return reply({ error: "wedding_code_research_closed" }, 503);
  }
  if (!isTrustedMutationRequest(request)) {
    return reply({ error: "잘못된 요청 출처입니다." }, 403);
  }

  const limited = await checkRateLimitPersistent(
    rateLimitKey("wedding-code:research-contribution", request),
    { maxRequests: 5, windowMs: 10 * 60 * 1000 },
  );
  if (limited) return limited;

  const read = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return reply({ error: "요청 형식이 올바르지 않습니다." }, read.reason === "too_large" ? 413 : 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return reply({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const contribution = parseWeddingCodeResearchContribution(body);
  if (!contribution) {
    return reply({ error: "동의와 답을 확인한 뒤 다시 보내 주세요." }, 400);
  }

  const receipt = createWeddingCodeResearchReceipt();
  if (!receipt) return reply({ error: "wedding_code_research_closed" }, 503);

  try {
    const { error } = await createAdminClient().rpc("insert_wedding_code_research_contribution", {
      p_scene_version: contribution.sceneVersion,
      p_answer_code: contribution.answerCode,
      p_consent_version: contribution.consentVersion,
      p_deletion_receipt_hash: receipt.hash,
    });
    if (error) {
      log.error("[wedding-code research] insert failed", { code: error.code });
      return reply({ error: "지금은 답을 보태지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 503);
    }
  } catch (error) {
    log.error("[wedding-code research] insert threw", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return reply({ error: "지금은 답을 보태지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 503);
  }

  // 삭제 코드 원문은 이 응답에서 한 번만 나간다. 로그에 남기지 않는다.
  return reply({ receipt: receipt.receipt }, 201);
}
