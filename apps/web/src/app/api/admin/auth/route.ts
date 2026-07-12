import { timingSafeEqual } from "node:crypto";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimitPersistentStrict, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalText, isRecord, normalizeEmail } from "@/utils/requestValidation";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
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

async function removeIncompleteAdminUser(
  serviceClient: ReturnType<typeof getServiceClient>,
  userId: string,
  context: "initial-setup" | "create-admin",
) {
  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) {
    console.error("ADMIN_AUTH_COMPENSATION_FAILED", {
      severity: "critical",
      context,
    });
  }
}

function isStrongAdminAccessSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 24;
}

function isInitialAdminSetupEnabled() {
  return process.env.NODE_ENV !== "production" &&
    process.env.ADMIN_INITIAL_SETUP_ENABLED === "true";
}

const ADMIN_PASSWORD_ERROR =
  "관리자 계정 비밀번호는 12자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다.";
const ADMIN_AUTH_UNAVAILABLE_ERROR =
  "관리자 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const ADMIN_ACCOUNT_CREATE_ERROR =
  "관리자 계정을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.";
const ADMIN_ACTIONS = new Set(["login", "initial-setup", "create-admin"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const checkOnly = url.searchParams.get("check") === "exists";

    if (checkOnly) {
      const limited = await checkRateLimitPersistentStrict(rateLimitKey("admin-auth-check", req), {
        maxRequests: 30,
        windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;

      const { count, error } = await getServiceClient()
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      if (error) {
        console.error("ADMIN_AUTH_ADMIN_INVENTORY_LOOKUP_FAILED", {
          context: "exists-check",
        });
        return NextResponse.json(
          { hasAdmin: false, initialSetupEnabled: false, error: ADMIN_AUTH_UNAVAILABLE_ERROR },
          { status: 503 }
        );
      }
      return NextResponse.json({
        hasAdmin: (count ?? 0) > 0,
        initialSetupEnabled: isInitialAdminSetupEnabled(),
      });
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

    const { data: profile, error: profileError } = await getServiceClient()
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (profileError) {
      console.error("ADMIN_AUTH_PROFILE_LOOKUP_FAILED", {
        context: "session-check",
      });
      return NextResponse.json(
        { isAdmin: false, error: ADMIN_AUTH_UNAVAILABLE_ERROR },
        { status: 503 }
      );
    }

    return NextResponse.json({
      isAdmin: profile?.is_admin === true,
      email: user.email,
    });
  } catch {
    console.error("ADMIN_AUTH_UNEXPECTED_FAILURE", { context: "get" });
    return NextResponse.json(
      { isAdmin: false, error: ADMIN_AUTH_UNAVAILABLE_ERROR },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!isStrongAdminAccessSecret(ADMIN_PASSWORD)) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 503 });
  }

  try {
    const body = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const action = body.action === undefined ? "login" : body.action;
    if (typeof action !== "string" || !ADMIN_ACTIONS.has(action)) {
      return NextResponse.json({ error: "지원하지 않는 관리자 요청입니다." }, { status: 400 });
    }

    const limited = await checkRateLimitPersistentStrict(rateLimitKey("admin-auth", req), {
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
      if (!isInitialAdminSetupEnabled()) {
        return NextResponse.json(
          { error: "최초 관리자 설정은 운영에서 비활성화되어 있습니다." },
          { status: 403 }
        );
      }
      const initEmail = normalizeEmail(body.email);
      const initPassword = body.password;
      const initName = cleanOptionalText(body.name, 60) ?? "어드민 관리자";

      const { count, error: countError } = await serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);

      if (countError) {
        console.error("ADMIN_AUTH_ADMIN_INVENTORY_LOOKUP_FAILED", {
          context: "initial-setup",
        });
        return NextResponse.json(
          { error: ADMIN_AUTH_UNAVAILABLE_ERROR },
          { status: 503 }
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
        console.error("ADMIN_AUTH_USER_CREATE_FAILED", {
          context: "initial-setup",
        });
        return NextResponse.json(
          { error: ADMIN_ACCOUNT_CREATE_ERROR },
          { status: 503 }
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
        console.error("ADMIN_AUTH_PROFILE_WRITE_FAILED", {
          context: "initial-setup",
        });
        await removeIncompleteAdminUser(serviceClient, newUser.user.id, "initial-setup");
        return NextResponse.json(
          { error: "관리자 프로필을 안전하게 저장할 수 없습니다." },
          { status: 503 }
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

      const { data: currentProfile, error: currentProfileError } = await serviceClient
        .from("profiles")
        .select("is_admin")
        .eq("id", currentUser.id)
        .single();
      if (currentProfileError) {
        console.error("ADMIN_AUTH_PROFILE_LOOKUP_FAILED", {
          context: "create-admin-authorizer",
        });
        return NextResponse.json(
          { error: ADMIN_AUTH_UNAVAILABLE_ERROR },
          { status: 503 }
        );
      }
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
        console.error("ADMIN_AUTH_USER_CREATE_FAILED", {
          context: "create-admin",
        });
        return NextResponse.json(
          { error: ADMIN_ACCOUNT_CREATE_ERROR },
          { status: 503 }
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
        console.error("ADMIN_AUTH_PROFILE_WRITE_FAILED", {
          context: "create-admin",
        });
        await removeIncompleteAdminUser(serviceClient, newUser.user.id, "create-admin");
        return NextResponse.json(
          { error: "관리자 프로필을 안전하게 저장할 수 없습니다." },
          { status: 503 }
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

    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("ADMIN_AUTH_PROFILE_LOOKUP_FAILED", {
        context: "login",
      });
      return NextResponse.json(
        { error: ADMIN_AUTH_UNAVAILABLE_ERROR },
        { status: 503 }
      );
    }

    if (profile?.is_admin) {
      return NextResponse.json({ success: true, message: "관리자 로그인 성공" });
    }

    return NextResponse.json(
      { error: "관리자 권한이 없는 계정입니다. 기존 관리자에게 권한을 요청하세요." },
      { status: 403 }
    );
  } catch {
    console.error("ADMIN_AUTH_UNEXPECTED_FAILURE", { context: "post" });
    return NextResponse.json({ error: ADMIN_AUTH_UNAVAILABLE_ERROR }, { status: 500 });
  }
}
