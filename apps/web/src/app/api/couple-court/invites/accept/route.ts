import { createHash } from "node:crypto";
import { acceptCourtInviteForUser, rejectCourtInviteForUser } from "@/lib/coupleCourt/repository";
import { weddingPath } from "@/lib/weddingPaths";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  CourtApiError,
  courtErrorResponse,
  getOptionalCourtUser,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtEnabled,
} from "../../_shared";
import {
  COURT_INVITE_HANDOFF_COOKIE,
  COURT_INVITE_HANDOFF_COOKIE_PATH,
  COURT_INVITE_HANDOFF_MAX_AGE_SECONDS,
  courtInviteHandoffFromRequest,
  openCourtInviteHandoff,
  sealCourtInviteHandoff,
} from "../../_inviteHandoff";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{40,128}$/;

function inviteTokenHash(token: string): string {
  return createHash("sha256")
    .update(`weddinghanbang-court-invite-v1\0${token}`)
    .digest("hex");
}

export async function POST(request: Request) {
  const clearHandoff = (response: ReturnType<typeof noStoreJson>) => {
    response.cookies.set(COURT_INVITE_HANDOFF_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COURT_INVITE_HANDOFF_COOKIE_PATH,
      maxAge: 0,
    });
    return response;
  };

  try {
    requireCoupleCourtEnabled();
    const user = await getOptionalCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:invite:accept", request, user?.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      user?.id,
    );
    if (limited) return limited;

    const body = await readCourtJson(request, 2048);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const handoffCookie = courtInviteHandoffFromRequest(request);
    if (token && !TOKEN_RE.test(token)) {
      throw new CourtApiError(404, "COURT_INVITE_INVALID", "초대 링크를 확인해 주세요.");
    }
    if (!token && !handoffCookie) {
      throw new CourtApiError(404, "COURT_INVITE_INVALID", "초대 링크를 확인해 주세요.");
    }

    const tokenHash = token
      ? inviteTokenHash(token)
      : openCourtInviteHandoff(handoffCookie!).tokenHash;
    if (body.prepare_only === true) {
      const response = noStoreJson({ prepared: true });
      if (token) {
        response.cookies.set(COURT_INVITE_HANDOFF_COOKIE, sealCourtInviteHandoff(tokenHash), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: COURT_INVITE_HANDOFF_COOKIE_PATH,
          maxAge: COURT_INVITE_HANDOFF_MAX_AGE_SECONDS,
        });
      }
      return response;
    }
    if (!user) {
      const response = noStoreJson({
        requires_auth: true,
        action_url: `/login?next=${encodeURIComponent(weddingPath("/couple-court/invite"))}`,
        message: "로그인하면 이 초대를 안전하게 이어서 받을게요.",
      }, { status: 202 });
      if (token) {
        response.cookies.set(COURT_INVITE_HANDOFF_COOKIE, sealCourtInviteHandoff(tokenHash), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: COURT_INVITE_HANDOFF_COOKIE_PATH,
          maxAge: COURT_INVITE_HANDOFF_MAX_AGE_SECONDS,
        });
      }
      return response;
    }

    if (body.reject === true) {
      await rejectCourtInviteForUser(user.id, tokenHash);
      return clearHandoff(noStoreJson({ rejected: true }));
    }

    const accepted = await acceptCourtInviteForUser(user.id, tokenHash);
    return clearHandoff(noStoreJson({ case_id: accepted.caseId }));
  } catch (error) {
    const response = courtErrorResponse(error);
    // Keep the encrypted handoff for transient provider/storage/rate-limit
    // failures and for account/couple mismatches that can be fixed by switching
    // accounts. Only terminal token states should destroy the recovery path.
    const terminalCodes = new Set([
      "COURT_INVITE_INVALID",
      "COURT_INVITE_EXPIRED",
      "COURT_INVITE_UNAVAILABLE",
      "COURT_INVITE_HANDOFF_EXPIRED",
    ]);
    return error instanceof CourtApiError && terminalCodes.has(error.code)
      ? clearHandoff(response)
      : response;
  }
}
