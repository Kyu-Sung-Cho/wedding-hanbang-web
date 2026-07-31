import { NextRequest, NextResponse } from "next/server";

import {
  loadWeddingCourtCasesForUser,
  WeddingCourtRepositoryError,
} from "@/lib/weddingCourt/repository";
import { isWeddingCourtEnabled } from "@/lib/features/weddingLaunchFlags";
import { createClientFromRequest } from "@/lib/supabase/server";

const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE,
  });
}

export async function GET(request: NextRequest) {
  if (!isWeddingCourtEnabled()) {
    return json({ error: "Not found" }, 404);
  }

  try {
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

    const cases = await loadWeddingCourtCasesForUser(user.id);
    return json({ cases });
  } catch (error) {
    if (
      error instanceof WeddingCourtRepositoryError
      && error.code === "case_not_found"
    ) {
      return json({ error: "사건을 찾을 수 없어요." }, 404);
    }

    return json(
      {
        error: "웨딩 선택 법정을 불러오지 못했어요. 잠시 뒤 다시 시도해주세요.",
        code: "WEDDING_COURT_UNAVAILABLE",
      },
      503,
    );
  }
}
