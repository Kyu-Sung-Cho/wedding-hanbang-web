import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalText,
  isRecord,
  normalizeEmail,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { isStrongAdminPassword } from "@hanbang/shared/security/password-policy";
import {
  clearAdminStepUpCookie,
  hasAdminStepUp,
  setAdminStepUpCookie,
} from "@/lib/auth/adminStepUp";

const MAX_BODY_BYTES = 16 * 1024;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function withPrivateResponseHeaders<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function getServiceClient() {
  return createAdminClient();
}

function safeEqualString(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  // Hash both values before comparing so a wrong-length guess does not take a
  // separate early-return path at this remote secret boundary.
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function isStrongBootstrapSecret(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 32
    && value.length <= 512
    && !/[\s\u0000-\u001f\u007f]/.test(value)
    && new Set(value).size >= 12;
}

const ADMIN_PASSWORD_ERROR =
  "관리자 계정 비밀번호는 12자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다.";
const ADMIN_AUTH_ACTIONS = new Set(["login", "initial-setup", "create-admin"]);

async function handleGet(req: Request) {
  try {
    const url = new URL(req.url);
    const checkOnly = url.searchParams.get("check") === "exists";

    if (checkOnly) {
      const limited = await checkRateLimitPersistent(rateLimitKey("admin-auth-check", req), {
        maxRequests: 30,
        windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;

      const { count } = await getServiceClient()
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      return NextResponse.json({ hasAdmin: (count ?? 0) > 0 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { isAdmin: false, error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { data: profile } = await getServiceClient()
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    const isAdmin = profile?.is_admin === true
      && hasAdminStepUp(req.headers.get("cookie"), user.id);
    return NextResponse.json({
      isAdmin,
      email: user.email,
    });
  } catch {
    return NextResponse.json({ isAdmin: false, error: "서버 오류" }, { status: 500 });
  }
}

async function handlePost(req: Request) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!isStrongBootstrapSecret(ADMIN_PASSWORD)) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  try {
    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("admin-auth:ingress", req),
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const boundedBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!boundedBody.ok) {
      return NextResponse.json(
        { error: boundedBody.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: boundedBody.reason === "too_large" ? 413 : 400 },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(boundedBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const action = body.action === undefined ? "login" : body.action;
    if (typeof action !== "string" || !ADMIN_AUTH_ACTIONS.has(action)) {
      return NextResponse.json({ error: "지원하지 않는 관리자 인증 요청입니다." }, { status: 400 });
    }

    // 모든 bootstrap-secret 시도는 action과 무관하게 같은 버킷을 쓴다. 요청자가
    // 임의 action 문자열로 namespace를 늘려 비밀번호 제한을 우회하지 못한다.
    const limited = await checkRateLimitPersistent(rateLimitKey("admin-auth:secret", req), {
      maxRequests: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (limited) return limited;

    if (!safeEqualString(body.setupPassword, ADMIN_PASSWORD)) {
      return NextResponse.json(
        { error: "관리자 인증 비밀번호가 틀렸습니다." },
        { status: 403 }
      );
    }

    const serviceClient = getServiceClient();

    if (action === "initial-setup") {
      const isProduction = process.env.NODE_ENV === "production"
        || process.env.VERCEL_ENV === "production";
      if (isProduction && process.env.ADMIN_INITIAL_SETUP_ENABLED !== "true") {
        return NextResponse.json(
          { error: "운영 환경의 최초 관리자 생성이 잠겨 있습니다." },
          { status: 403 },
        );
      }

      const initEmail = normalizeEmail(body.email);
      const initPassword = body.password;
      const initName = cleanOptionalText(body.name, 60) ?? "어드민 관리자";

      const { count, error: adminCountError } = await serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);

      if (adminCountError) {
        console.error("Initial admin count failed", safeErrorDiagnostic(adminCountError));
        return NextResponse.json(
          { error: "관리자 상태를 확인하지 못했습니다." },
          { status: 503 },
        );
      }

      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: "이미 관리자가 존재합니다. 기존 관리자로 로그인해주세요." },
          { status: 403 }
        );
      }

      if (!initEmail || !initPassword) {
        return NextResponse.json(
          { error: "이메일과 비밀번호를 입력해주세요." },
          { status: 400 }
        );
      }
      if (!isStrongAdminPassword(initPassword)) {
        return NextResponse.json({ error: ADMIN_PASSWORD_ERROR }, { status: 400 });
      }

      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email: initEmail,
        password: initPassword,
        email_confirm: true,
      });

      if (createError) {
        if (
          createError.message.includes("already been registered") ||
          createError.message.includes("already exists")
        ) {
          return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
        }
        console.error("admin_initial_auth_create_failed", {
          code: safeErrorDiagnostic(createError).code,
        });
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      const { data: profileCreated, error: profileError } = await serviceClient.rpc(
        "bootstrap_initial_admin_profile",
        {
          p_user_id: newUser.user.id,
          p_name: initName,
          p_email: initEmail,
        },
      );

      if (profileError || profileCreated !== true) {
        const conflict = profileError?.code === "23505";
        const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(
          newUser.user.id,
        );
        console.error(
          "Initial admin profile claim failed",
          safeErrorDiagnostic(profileError ?? new Error("invalid bootstrap result")),
        );
        if (rollbackError) {
          console.error("Initial admin Auth rollback failed", safeErrorDiagnostic(rollbackError));
        }
        return NextResponse.json(
          {
            error: conflict
              ? "이미 관리자가 존재합니다. 기존 관리자로 로그인해주세요."
              : "관리자 계정 생성이 완료되지 않았습니다.",
          },
          { status: conflict ? 409 : 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "최초 관리자 계정이 생성되었습니다. 로그인해주세요.",
      });
    }

    if (action === "create-admin") {
      const newEmail = normalizeEmail(body.email);
      const newPassword = body.password;
      const newName = cleanOptionalText(body.name, 60) ?? "관리자";

      const supabase = await createClientFromRequest(req);
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!currentUser) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }

      const { data: currentProfile } = await serviceClient
        .from("profiles")
        .select("is_admin")
        .eq("id", currentUser.id)
        .single();
      if (!currentProfile?.is_admin) {
        return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });
      }

      if (!newEmail || !newPassword) {
        return NextResponse.json(
          { error: "이메일과 비밀번호를 입력해주세요." },
          { status: 400 }
        );
      }
      if (!isStrongAdminPassword(newPassword)) {
        return NextResponse.json({ error: ADMIN_PASSWORD_ERROR }, { status: 400 });
      }

      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email: newEmail,
        password: newPassword,
        email_confirm: true,
      });

      if (createError) {
        if (
          createError.message.includes("already been registered") ||
          createError.message.includes("already exists")
        ) {
          return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
        }
        console.error("admin_auth_create_failed", {
          code: safeErrorDiagnostic(createError).code,
        });
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      const { error: profileError } = await serviceClient.from("profiles").upsert({
        id: newUser.user.id,
        name: newName,
        email: newEmail,
        onboarding_completed: true,
        onboarding_step: 5,
        is_admin: true,
      });

      if (profileError) {
        const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(
          newUser.user.id,
        );
        console.error("Admin profile persistence failed", safeErrorDiagnostic(profileError));
        if (rollbackError) {
          console.error("Admin Auth rollback failed", safeErrorDiagnostic(rollbackError));
        }
        return NextResponse.json(
          { error: "관리자 계정 생성이 완료되지 않았습니다." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "새 관리자 계정이 생성되었습니다.",
      });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profile?.is_admin) {
      const response = NextResponse.json({
        success: true,
        message: "관리자 로그인 성공",
      });
      if (!setAdminStepUpCookie(response, user.id)) {
        return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
      }
      return response;
    }

    return NextResponse.json(
      { error: "관리자 권한이 없는 계정입니다. 기존 관리자에게 권한을 요청하세요." },
      { status: 403 }
    );
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return withPrivateResponseHeaders(await handleGet(req));
}

export async function POST(req: Request) {
  return withPrivateResponseHeaders(await handlePost(req));
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  clearAdminStepUpCookie(response);
  return withPrivateResponseHeaders(response);
}
