import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  insertAmoraActionRecord,
  isAmoraActionStorageUnavailable,
  listAmoraActionRecords,
} from "@/lib/amora/actionRepository";
import {
  createAmoraActionId,
  getAmoraActions,
  mergeAmoraActions,
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

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const STATUS_VALUES = ["open", "done", "dismissed"] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;
const SOURCE_VALUES = ["chat", "quote", "schedule", "budget", "guardrail", "manual"] as const;

async function getCoupleIdForUser(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("amora actions profile read failed:", error.message);
  }

  return typeof profile?.couple_id === "string" ? profile.couple_id : null;
}

async function getLegacyActions(admin: ReturnType<typeof createAdminClient>, coupleId: string) {
  const { data } = await admin
    .from("wedding_journeys")
    .select("progress")
    .eq("couple_id", coupleId)
    .maybeSingle();

  return getAmoraActions((data?.progress ?? {}) as Record<string, unknown>);
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

    const admin = createAdminClient();
    const coupleId = await getCoupleIdForUser(admin, user.id);
    if (!coupleId) {
      return NextResponse.json({ actions: [], count: 0, open_count: 0 });
    }

    const params = new URL(request.url).searchParams;
    const limit = cleanIntegerInRange(params.get("limit"), 1, 80) ?? 40;
    const status = parseStatusParam(request);
    const legacyActions = await getLegacyActions(admin, coupleId);

    try {
      const storedActions = await listAmoraActionRecords(admin, coupleId, { status: "all", limit: 80 });
      const merged = mergeAmoraActions(storedActions, legacyActions);
      const actions = status === "all" ? merged : merged.filter((action) => action.status === status);
      return NextResponse.json({
        actions: actions.slice(0, limit),
        count: actions.length,
        open_count: merged.filter((action) => action.status === "open").length,
        source: "table",
      });
    } catch (error) {
      if (!isAmoraActionStorageUnavailable(error)) throw error;
      const actions = status === "all"
        ? legacyActions
        : legacyActions.filter((action) => action.status === status);
      return NextResponse.json({
        actions: actions.slice(0, limit),
        count: actions.length,
        open_count: legacyActions.filter((action) => action.status === "open").length,
        source: "legacy",
      });
    }
  } catch (error) {
    console.error("amora actions get failed:", error);
    return NextResponse.json({ error: "아모라 행동을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    const title = cleanOptionalText(body.title, 120);
    if (!title) {
      return NextResponse.json({ error: "제목이 필요합니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const coupleId = await getCoupleIdForUser(admin, user.id);
    if (!coupleId) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
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

    const saved = await insertAmoraActionRecord(admin, coupleId, action, user.id);
    return NextResponse.json({ action: saved }, { status: 201 });
  } catch (error) {
    if (isAmoraActionStorageUnavailable(error)) {
      return NextResponse.json(
        { error: "아모라 행동 저장소가 아직 배포되지 않았습니다." },
        { status: 503 }
      );
    }
    console.error("amora actions create failed:", error);
    return NextResponse.json({ error: "아모라 행동을 저장하지 못했습니다." }, { status: 500 });
  }
}
