import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isWeddingCourtEnabled } from "@/lib/features/weddingLaunchFlags";
import { createClientFromRequest } from "@/lib/supabase/server";
import { parseWeddingCourtVoteInput } from "@/lib/weddingCourt/contract";
import {
  castWeddingCourtVote,
  WeddingCourtRepositoryError,
} from "@/lib/weddingCourt/repository";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_LENGTH = 2_048;
const caseIdSchema = z.string().uuid();
const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE,
  });
}

function repositoryFailure(error: WeddingCourtRepositoryError) {
  switch (error.code) {
    case "case_not_found":
      return json({ error: "사건을 찾을 수 없어요." }, 404);
    case "first_round_required":
      return json(
        { error: "1심 선택을 마친 뒤 새 단서를 열어주세요." },
        409,
      );
    case "vote_locked":
      return json(
        {
          error:
            "이미 제출한 같은 심급의 선택은 바꿀 수 없어요. 항소심에서 다시 선택해주세요.",
          code: "VOTE_LOCKED",
        },
        409,
      );
    case "invalid_vote":
      return json({ error: "선택 내용을 다시 확인해주세요." }, 400);
    default:
      return json(
        {
          error: "선택을 저장하지 못했어요. 잠시 뒤 다시 시도해주세요.",
          code: "WEDDING_COURT_UNAVAILABLE",
        },
        503,
      );
  }
}

async function readJsonBody(request: NextRequest): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse }
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_LENGTH) {
    return {
      ok: false,
      response: json({ error: "요청 내용이 너무 커요." }, 413),
    };
  }

  const rawBody = await request.text();
  if (rawBody.length === 0 || rawBody.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      response: json(
        {
          error:
            rawBody.length === 0
              ? "선택 내용을 보내주세요."
              : "요청 내용이 너무 커요.",
        },
        rawBody.length === 0 ? 400 : 413,
      ),
    };
  }

  try {
    const value: unknown = JSON.parse(rawBody);
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: json({ error: "선택 내용을 읽을 수 없어요." }, 400),
    };
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!isWeddingCourtEnabled()) {
    return json({ error: "Not found" }, 404);
  }

  try {
    const { caseId: rawCaseId } = await context.params;
    const parsedCaseId = caseIdSchema.safeParse(rawCaseId);
    if (!parsedCaseId.success) {
      return json({ error: "사건 번호가 올바르지 않아요." }, 400);
    }

    const requestClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await requestClient.auth.getUser();
    if (!user) {
      return json(
        {
          error: "로그인하면 선택에 참여할 수 있어요.",
          code: "AUTH_REQUIRED",
        },
        401,
      );
    }

    const rateLimitResponse = checkRateLimit(
      rateLimitKey("community:wedding-court:vote", request, user.id),
      { maxRequests: 20, windowMs: 60_000 },
    );
    if (rateLimitResponse) return rateLimitResponse;

    const writeAccess = await checkCommunityWriteAccess(requestClient, user.id);
    if (!writeAccess.allowed) {
      return json(
        { error: writeAccess.message, code: writeAccess.code },
        writeAccess.status,
      );
    }

    const rawBody = await readJsonBody(request);
    if (!rawBody.ok) return rawBody.response;

    // 스키마에 없는 user_id 같은 필드는 제거한다. 저장 주체는 오직 위에서
    // 검증한 auth.user.id다.
    const parsedInput = parseWeddingCourtVoteInput(rawBody.value);
    if (!parsedInput.ok) {
      return json({ error: parsedInput.message }, 400);
    }

    const receipt = await castWeddingCourtVote(
      user.id,
      parsedCaseId.data,
      parsedInput.value,
    );

    return json({
      action: receipt.action,
      case: receipt.courtCase,
    });
  } catch (error) {
    if (error instanceof WeddingCourtRepositoryError) {
      return repositoryFailure(error);
    }

    return json(
      {
        error: "선택을 저장하지 못했어요. 잠시 뒤 다시 시도해주세요.",
        code: "WEDDING_COURT_UNAVAILABLE",
      },
      503,
    );
  }
}
