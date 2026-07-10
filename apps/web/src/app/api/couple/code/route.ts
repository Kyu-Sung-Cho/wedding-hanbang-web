import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type InviteState = {
  invite_code?: unknown;
  is_fully_linked?: unknown;
  requires_relink_confirmation?: unknown;
};

async function getAuthenticatedUser(req: NextRequest) {
  const supabase = await createClientFromRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function readInviteState(
  userId: string,
  rotate: boolean
) {
  const { data, error } = await getAdmin().rpc("get_or_rotate_invite_code_safely", {
    p_user_id: userId,
    p_rotate: rotate,
  });
  if (error) throw error;

  return normalizeInviteState(data);
}

function normalizeInviteState(data: unknown) {
  const state = data as InviteState | null;
  const requiresRelinkConfirmation = state?.requires_relink_confirmation === true;
  const inviteCode = typeof state?.invite_code === "string" ? state.invite_code : null;
  if (!state
    || typeof state.is_fully_linked !== "boolean"
    || (inviteCode === null && !requiresRelinkConfirmation)
    || (inviteCode !== null && !/^WH-[A-F0-9]{12}$/.test(inviteCode))) {
    throw new Error("Invalid invite-code RPC response");
  }
  return {
    inviteCode,
    isFullyLinked: state.is_fully_linked,
    requiresRelinkConfirmation,
  };
}

// GET: 현재 커플 코드 조회 + 연결 상태
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    return NextResponse.json(await readInviteState(user.id, false));
  } catch (err) {
    console.error("커플 코드 조회 오류:", err);
    return NextResponse.json({ error: "커플 코드를 확인할 수 없습니다." }, { status: 500 });
  }
}

// POST: 코드 재발급 (양쪽 다 연결된 경우 불가)
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { confirmLegacyRelink?: unknown };
    let state;
    if (body.confirmLegacyRelink === true) {
      const { data, error } = await getAdmin().rpc("restart_blocked_amora_couple_safely", {
        p_user_id: user.id,
      });
      if (error) throw error;
      state = normalizeInviteState(data);
    } else {
      state = await readInviteState(user.id, true);
      if (state.requiresRelinkConfirmation) {
        return NextResponse.json(
          { error: "기존 자료를 공유하지 않는 새 커플 공간 생성 확인이 필요합니다." },
          { status: 409 }
        );
      }
    }
    return NextResponse.json(state);
  } catch (err) {
    console.error("코드 재발급 오류:", err);
    const message = err instanceof Error ? err.message : "";
    if (message.includes("after linking")) {
      return NextResponse.json(
        { error: "이미 파트너와 연결되어 코드를 재발급할 수 없습니다." },
        { status: 409 }
      );
    }
    if (message.includes("active provider lease")) {
      return NextResponse.json(
        { error: "진행 중인 아모라 응답이 끝난 뒤 다시 시도해 주세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "코드를 재발급할 수 없습니다." }, { status: 500 });
  }
}
