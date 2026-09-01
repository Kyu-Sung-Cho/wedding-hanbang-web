import { timingSafeEqual } from "node:crypto";
import { log } from "@/utils/log";
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
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 16 * 1024;
const ADMIN_ACTIONS = new Set(["login", "initial-setup", "create-admin"]);

function getServiceClient() {
  return createAdminClient();
}

function safeEqualString(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isStrongAdminPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

const ADMIN_PASSWORD_ERROR =
  "관리자 계정 비밀번호는 12자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다.";

export async function GET(req: Request) {
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

    return NextResponse.json({
      isAdmin: profile?.is_admin === true,
      email: user.email,
    });
  } catch (err) {
    log.error("api/admin/auth", err);
    return NextResponse.json({ isAdmin: false, error: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "신뢰할 수 없는 요청입니다." },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  try {
    const limited = await checkRateLimitPersistent(rateLimitKey("admin-auth:post", req), {
      maxRequests: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (limited) return limited;

    const rawBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다." },
        { status: rawBody.reason === "too_large" ? 413 : 400 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const action = typeof body.action === "string" ? body.action : "login";
    if (!ADMIN_ACTIONS.has(action)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    if (!safeEqualString(body.setupPassword, ADMIN_PASSWORD)) {
      return NextResponse.json(
        { error: "관리자 인증 비밀번호가 틀렸습니다." },
        { status: 403 }
      );
    }

    const serviceClient = getServiceClient();

    if (action === "initial-setup") {
      const initEmail = normalizeEmail(body.email);
      const initPassword = body.password;
      const initName = cleanOptionalText(body.name, 60) ?? "어드민 관리자";

      const { count, error: adminCountError } = await serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);

      if (adminCountError) {
        console.error("Initial admin count failed:", adminCountError.message);
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
        console.error("Initial admin Auth creation failed:", createError.message);
        return NextResponse.json(
          { error: "관리자 계정을 생성하지 못했습니다." },
          { status: 500 }
        );
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      const { error: profileError } = await serviceClient.from("profiles").upsert({
        id: newUser.user.id,
        name: initName,
        email: initEmail,
        onboarding_completed: true,
        onboarding_step: 5,
        is_admin: true,
      });

      if (profileError) {
        const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(
          newUser.user.id,
        );
        console.error("Initial admin profile persistence failed:", profileError.message);
        if (rollbackError) {
          console.error("Initial admin Auth rollback failed:", rollbackError.message);
        }
        return NextResponse.json(
          { error: "관리자 계정 생성이 완료되지 않았습니다." },
          { status: 500 },
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
        console.error("Admin Auth creation failed:", createError.message);
        return NextResponse.json(
          { error: "관리자 계정을 생성하지 못했습니다." },
          { status: 500 }
        );
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
        console.error("Admin profile persistence failed:", profileError.message);
        if (rollbackError) {
          console.error("Admin Auth rollback failed:", rollbackError.message);
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
      return NextResponse.json({ success: true, message: "관리자 로그인 성공" });
    }

    return NextResponse.json(
      { error: "관리자 권한이 없는 계정입니다. 기존 관리자에게 권한을 요청하세요." },
      { status: 403 }
    );
  } catch (err) {
    log.error("api/admin/auth", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
