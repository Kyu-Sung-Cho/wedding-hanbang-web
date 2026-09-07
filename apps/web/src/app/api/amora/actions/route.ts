import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  getManualAmoraActionFailure,
  mutateOwnAmoraActionRecord,
  isAmoraActionStorageUnavailable,
  readAmoraActionPage,
  InvalidAmoraActionCursorError,
} from "@/lib/amora/actionRepository";
import {
  createAmoraActionId,
  getAmoraActions,
  normalizeAmoraAction,
  type AmoraActionItem,
  type AmoraActionPriority,
  type AmoraActionSource,
  type AmoraActionStatus,
} from "@/lib/amora/actions";
import {
  cleanIntegerInRange,
  cleanOptionalEnum,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const STATUS_VALUES = ["open", "done", "dismissed"] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;
const SOURCE_VALUES = ["chat", "quote", "schedule", "budget", "guardrail", "manual"] as const;

/**
 * 조회 실패와 "커플이 아직 없음"을 같은 null로 뭉개면, 준비 도구가 DB 장애를
 * **"할 일 0건"**으로 보여준다. 사용자는 챙길 게 없다고 믿고 화면을 닫는다.
 * 둘을 반환값에서 가른다.
 */
type CoupleLookup =
  | { ok: true; coupleId: string | null }
  | { ok: false };

async function getCoupleIdForUser(
  client: SupabaseClient,
  userId: string,
): Promise<CoupleLookup> {
  const { data: profile, error } = await client
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (error) {
    log.error("amora actions profile read failed:", error.message);
    return { ok: false };
  }

  return {
    ok: true,
    coupleId: typeof profile?.couple_id === "string" ? profile.couple_id : null,
  };
}

/** 응답 객체는 한 번만 소비되므로 요청마다 새로 만든다. */
function coupleLookupFailed() {
  return NextResponse.json(
    { error: "준비 상황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
    { status: 503 },
  );
}

async function getLegacyActions(client: SupabaseClient, coupleId: string) {
  const { data, error } = await client
    .from("wedding_journeys")
    .select("progress")
    .eq("couple_id", coupleId)
    .maybeSingle();

  if (error) throw new Error("Amora action legacy read failed");
  const progress = isRecord(data?.progress) ? data.progress : {};
  const raw = Array.isArray(progress.__amora_actions) ? progress.__amora_actions : [];
  return getAmoraActions({ ...progress, __amora_actions: raw.map((item) => isRecord(item)
    ? { ...item, createdAt: typeof item.createdAt === "string" ? item.createdAt : "1970-01-01T00:00:00.000Z" }
    : item) });
}

function cleanHref(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().slice(0, 180);
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

function parseStatusParam(request: Request): AmoraActionStatus | "all" {
  const status = new URL(request.url).searchParams.get("status");
  if (status === "all") return "all";
  return cleanOptionalEnum(status, STATUS_VALUES) ?? "open";
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = supabase;
    const lookup = await getCoupleIdForUser(client, user.id);
    if (!lookup.ok) {
      return coupleLookupFailed();
    }
    const coupleId = lookup.coupleId;
    if (!coupleId) {
      return NextResponse.json({ actions: [], count: 0, open_count: 0, next_cursor: null });
    }

    const params = new URL(request.url).searchParams;
    const limit = cleanIntegerInRange(params.get("limit"), 1, 80) ?? 40;
    const status = parseStatusParam(request);
    const legacyActions = await getLegacyActions(client, coupleId);

    const snapshot = await readAmoraActionPage(client, coupleId, legacyActions, status, limit, params.get("cursor"));
    const actions = snapshot.actions;
    return NextResponse.json({
      actions,
      count: snapshot.count,
      open_count: snapshot.openCount,
      truncated: actions.length < snapshot.count,
      source: snapshot.source,
      next_cursor: snapshot.nextCursor,
    });
  } catch (error) {
    if (error instanceof InvalidAmoraActionCursorError) return NextResponse.json({ error: "페이지 정보가 바뀌었어요. 처음부터 다시 불러와 주세요." }, { status: 400 });
    log.error("amora actions get failed:", error);
    return NextResponse.json({ error: "아모라 행동을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const scoped = Object.hasOwn(body, "expectedOwnerId") || Object.hasOwn(body, "expectedCoupleId");
    if (scoped && (body.expectedOwnerId !== user.id
      || typeof body.expectedCoupleId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.expectedCoupleId))) {
      return NextResponse.json({ error: "계정 또는 커플 연결이 바뀌었어요. 내용을 다시 확인해 주세요." }, { status: 403 });
    }

    const title = cleanOptionalText(body.title, 120);
    if (!title) {
      return NextResponse.json({ error: "제목이 필요합니다." }, { status: 400 });
    }

    const client = supabase;
    const lookup = await getCoupleIdForUser(client, user.id);
    if (!lookup.ok) {
      return coupleLookupFailed();
    }
    const coupleId = lookup.coupleId;
    if (!coupleId) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }
    if (scoped && body.expectedCoupleId !== coupleId) {
      return NextResponse.json({ error: "커플 연결이 바뀌었어요. 내용을 다시 확인해 주세요." }, { status: 403 });
    }

    const now = new Date().toISOString();
    const action: AmoraActionItem = normalizeAmoraAction({
      id: createAmoraActionId(),
      title,
      description: cleanOptionalText(body.description, 500) ?? undefined,
      dueDate: cleanOptionalText(body.due_date, 40) ?? undefined,
      categoryKey: cleanOptionalText(body.category_key, 80) ?? undefined,
      priority: (cleanOptionalEnum(body.priority, PRIORITY_VALUES) as AmoraActionPriority | null) ?? "medium",
      status: (cleanOptionalEnum(body.status, STATUS_VALUES) as AmoraActionStatus | null) ?? "open",
      source: (cleanOptionalEnum(body.source, SOURCE_VALUES) as AmoraActionSource | null) ?? "manual",
      href: cleanHref(body.href),
      createdAt: now,
      updatedAt: now,
    });

    const saved = await mutateOwnAmoraActionRecord(supabase, coupleId, action.id, "create", action);
    if (!saved) throw new Error("Amora action create returned no receipt");
    return NextResponse.json({ action: saved }, { status: 201 });
  } catch (error) {
    const failure = getManualAmoraActionFailure(error);
    if (failure) return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
    if (isAmoraActionStorageUnavailable(error)) {
      return NextResponse.json(
        { error: "아모라 행동 저장소가 아직 배포되지 않았습니다." },
        { status: 503 }
      );
    }
    log.error("amora actions create failed:", error);
    return NextResponse.json({ error: "아모라 행동을 저장하지 못했습니다." }, { status: 500 });
  }
}
