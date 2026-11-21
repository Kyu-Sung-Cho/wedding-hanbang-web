import { NextResponse } from "next/server";

import {
  CARE_UNSUBSCRIBE_PATH,
  readCareUnsubscribeSecret,
  verifyCareUnsubscribeToken,
} from "@/lib/care/careUnsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

// 10장 P2.7: 케어 메일의 "한 번 눌러 수신 끊기".
//
// GET 은 확인 화면만 보여 준다. 메일 보안 검사기가 링크를 미리 열어도 아무것도 바뀌지 않게
// 하려는 것이다. 실제로 끄는 것은 POST 하나다(그 화면의 단추, 또는 메일 앱이 RFC 8058 의
// List-Unsubscribe-Post 로 보내는 요청). 토큰이 곧 권한이라 로그인을 묻지 않고, 할 수 있는
// 일은 그 사람의 케어 메일 동의를 끄는 것 하나뿐이다. 함께 대화의 글은 그대로 둔다.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 2048;

function page(title: string, body: string, status = 200, form?: { token: string }) {
  const escape = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const action = form
    ? `<form method="post" action="${CARE_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(form.token)}">
        <button type="submit" style="margin-top:20px;padding:12px 28px;border:0;border-radius:24px;background:#36534E;color:#fff;font-size:15px;">메일 그만 받기</button>
      </form>`
    : "";
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)}</title></head>
<body style="margin:0;background:#FDFCFA;font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1A1A1F;">
<main style="max-width:420px;margin:0 auto;padding:56px 24px;text-align:center;">
<h1 style="font-size:20px;font-weight:600;">${escape(title)}</h1>
<p style="font-size:15px;line-height:1.7;color:#4B4B52;">${escape(body)}</p>
${action}
</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function invalidLinkPage() {
  return page(
    "링크를 확인하지 못했어요",
    "메일을 끄는 링크가 맞지 않아요. 앱이나 웹의 설정에서 아모라 메일을 끌 수 있어요.",
    400,
  );
}

function tokenFrom(request: Request): string | null {
  return new URL(request.url).searchParams.get("t");
}

export async function GET(request: Request) {
  const secret = readCareUnsubscribeSecret();
  const token = tokenFrom(request);
  if (!secret || !token || !verifyCareUnsubscribeToken(secret, token)) {
    return invalidLinkPage();
  }
  return page(
    "아모라 메일을 그만 받을까요?",
    "아래 단추를 누르면 아모라가 보내는 메일만 멈춰요. 함께 대화의 글은 그대로 와요.",
    200,
    { token },
  );
}

export async function POST(request: Request) {
  const limited = checkRateLimit(rateLimitKey("amora-care-unsubscribe", request), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return invalidLinkPage();
  }

  const secret = readCareUnsubscribeSecret();
  const token = tokenFrom(request);
  const userId = secret && token ? verifyCareUnsubscribeToken(secret, token) : null;
  if (!userId) return invalidLinkPage();

  const { error } = await createAdminClient().rpc("patch_profile_atomic", {
    p_user_id: userId,
    p_care_email_enabled: false,
  });
  // A deleted account has nothing left to unsubscribe; say the same thing
  // either way so the link cannot be used to probe whether an account exists.
  if (error && error.code !== "P0002") {
    console.error("[care-unsubscribe] patch RPC failed", {
      code: typeof error.code === "string" ? error.code : "unknown",
    });
    return page(
      "잠시 뒤에 다시 눌러 주세요",
      "메일 설정을 바꾸지 못했어요. 잠시 뒤에 다시 누르거나 설정에서 꺼 주세요.",
      503,
      { token: token! },
    );
  }
  return page(
    "아모라 메일을 멈췄어요",
    "이제 아모라가 메일을 보내지 않아요. 함께 대화의 글은 그대로 오고, 설정에서 다시 켤 수 있어요.",
  );
}
