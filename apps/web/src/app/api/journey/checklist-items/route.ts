import { NextResponse } from "next/server";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;
const ALLOWED_FIELDS = new Set(["categoryKey", "itemId", "done", "expectedDone"]);

interface ChecklistMutation {
  categoryKey: string;
  itemId: string;
  done: boolean;
  expectedDone: boolean;
  defaultChecklist: Array<{ id: string; label: string; done: boolean }>;
}

function parseMutation(body: unknown): ChecklistMutation | null {
  if (
    !isRecord(body) ||
    Object.keys(body).some((field) => !ALLOWED_FIELDS.has(field)) ||
    typeof body.categoryKey !== "string" ||
    typeof body.itemId !== "string" ||
    typeof body.done !== "boolean" ||
    typeof body.expectedDone !== "boolean" ||
    body.done === body.expectedDone
  ) {
    return null;
  }
  const template = CHECKLIST_MAP[body.categoryKey];
  if (!template || !template.items.some((item) => item.id === body.itemId)) return null;
  return {
    categoryKey: body.categoryKey,
    itemId: body.itemId,
    done: body.done,
    expectedDone: body.expectedDone,
    defaultChecklist: template.items.map((item) => ({
      id: item.id,
      label: item.label,
      done: false,
    })),
  };
}

function isChecklistItem(value: unknown): value is { id: string; label: string; done: boolean } {
  return isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && value.label.length > 0 &&
    typeof value.done === "boolean";
}

function validateResult(
  data: unknown,
  mutation: ChecklistMutation,
): { conflict: boolean; progress: Record<string, unknown>; item: { id: string; label: string; done: boolean } } | null {
  if (
    !isRecord(data) ||
    typeof data.conflict !== "boolean" ||
    !isRecord(data.progress) ||
    data.categoryKey !== mutation.categoryKey ||
    data.itemId !== mutation.itemId ||
    !isChecklistItem(data.item)
  ) {
    return null;
  }
  const category = data.progress[mutation.categoryKey];
  if (
    !isRecord(category) ||
    category.category !== mutation.categoryKey ||
    !["not_started", "in_progress", "completed"].includes(String(category.status)) ||
    !Array.isArray(category.checklist) ||
    !category.checklist.every(isChecklistItem)
  ) {
    return null;
  }
  const ids = category.checklist.map((item) => item.id);
  if (new Set(ids).size !== ids.length) return null;
  const stored = category.checklist.find((item) => item.id === mutation.itemId);
  if (
    !stored ||
    stored.id !== data.item.id ||
    stored.label !== data.item.label ||
    stored.done !== data.item.done ||
    (!data.conflict && stored.done !== mutation.done)
  ) {
    return null;
  }
  return data as unknown as {
    conflict: boolean;
    progress: Record<string, unknown>;
    item: { id: string; label: string; done: boolean };
  };
}

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const mutation = parseMutation(await request.json().catch(() => null));
    if (!mutation) {
      return NextResponse.json({ error: "체크리스트 항목을 확인해 주세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    const { data, error } = await admin.rpc("mutate_journey_checklist_item", {
      p_couple_id: profile.couple_id,
      p_category_key: mutation.categoryKey,
      p_item_id: mutation.itemId,
      p_done: mutation.done,
      p_expected_done: mutation.expectedDone,
      p_default_checklist: mutation.defaultChecklist,
    });
    if (error) {
      console.error("atomic checklist item mutation failed:", error);
      return NextResponse.json(
        { error: error.code === "P0002" ? "웨딩 여정을 찾을 수 없습니다." : "체크리스트를 저장하지 못했습니다." },
        { status: error.code === "P0002" ? 404 : 500 },
      );
    }

    const result = validateResult(data, mutation);
    if (!result) {
      console.error("atomic checklist item mutation returned malformed data");
      return NextResponse.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 500 });
    }

    if (result.conflict) {
      return NextResponse.json(
        { error: "다른 기기에서 먼저 변경했습니다. 최신 상태로 다시 확인해 주세요.", progress: result.progress },
        { status: 409 },
      );
    }

    return NextResponse.json({
      progress: result.progress,
      categoryKey: mutation.categoryKey,
      itemId: mutation.itemId,
      item: result.item,
    });
  } catch (error) {
    console.error("Checklist item API error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
