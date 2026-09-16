import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseWeddingCodeResearchDeletion } from "@/lib/weddingCode/contribution/contract";
import {
  hashWeddingCodeResearchReceipt,
  isWeddingCodeResearchStorageActive,
} from "@/lib/weddingCode/contribution/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 256;

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * 삭제 코드로 보탠 답을 지운다.
 *
 * 코드 모양만 맞으면 **있든 없든 같은 응답**을 준다 — 응답 차이로 어떤 코드가 살아
 * 있는지 알아낼 수 없게. DB 쪽 함수도 행이 없어도 삭제 기록(해시·시각)을 남긴다.
 * 요청 본문은 어떤 로그에도 싣지 않는다.
 *
 * 새 답을 받지 않는 동안에도 연다 — 수집을 멈춘 뒤에도 이미 받은 답은 지울 수 있어야 한다.
 * 닫히는 것은 비밀값이 없을 때(저장소를 지킬 수 없을 때)뿐이다.
 */
export async function POST(request: Request) {
  if (!isWeddingCodeResearchStorageActive()) {
    return reply({ error: "wedding_code_research_closed" }, 503);
  }
  if (!isTrustedMutationRequest(request)) {
    return reply({ error: "잘못된 요청 출처입니다." }, 403);
  }

  const limited = await checkRateLimitPersistent(
    rateLimitKey("wedding-code:research-deletion", request),
    { maxRequests: 10, windowMs: 10 * 60 * 1000 },
  );
  if (limited) return limited;

  const read = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  let receipt: string | null = null;
  if (read.ok) {
    try {
      receipt = parseWeddingCodeResearchDeletion(JSON.parse(read.text));
    } catch {
      receipt = null;
    }
  }
  if (!receipt) {
    return reply({ error: "삭제 코드 모양이 맞지 않아요. wc_del_ 로 시작하는 코드를 그대로 붙여넣어 주세요." }, 400);
  }

  const hash = hashWeddingCodeResearchReceipt(receipt);
  if (!hash) return reply({ error: "wedding_code_research_closed" }, 503);

  try {
    const { error } = await createAdminClient().rpc("delete_wedding_code_research_contribution", {
      p_deletion_receipt_hash: hash,
    });
    if (error) {
      log.error("[wedding-code research] delete failed", { code: error.code });
      return reply({ error: "지금은 지우지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 503);
    }
  } catch (error) {
    log.error("[wedding-code research] delete threw", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return reply({ error: "지금은 지우지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 503);
  }

  return reply({ ok: true }, 200);
}
