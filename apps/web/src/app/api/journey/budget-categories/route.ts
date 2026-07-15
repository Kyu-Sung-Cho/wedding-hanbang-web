import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";
import { parseLocalDateOnly } from "@hanbang/shared";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_AMOUNT_WON = 10_000_000_000;
const CATEGORY_KEY_RE = /^[a-z][a-z0-9_-]{0,79}$/;
const FORBIDDEN_CATEGORY_KEYS = new Set(["constructor", "prototype", "__proto__"]);
const AMOUNT_FIELDS = [
  "budget",
  "contractedTotal",
  "paidToDate",
  "nextPaymentAmount",
] as const;
const SET_FIELDS = new Set([...AMOUNT_FIELDS, "nextPaymentDate", "label"]);
const REMOVE_FIELDS = new Set([
  ...AMOUNT_FIELDS,
  "nextPaymentDate",
  "spent",
  "cost",
  "payer",
  "label",
]);

interface CleanMutation {
  categoryKey: string;
  setFields: Record<string, number | string>;
  removeFields: string[];
  visibility: "visible" | "hidden" | null;
}

function cleanMutation(body: unknown): CleanMutation | null {
  if (!isRecord(body) || typeof body.categoryKey !== "string") return null;
  if (Object.keys(body).some(
    (field) => !["categoryKey", "set", "remove", "visibility"].includes(field),
  )) {
    return null;
  }
  const categoryKey = body.categoryKey;
  if (!CATEGORY_KEY_RE.test(categoryKey) || FORBIDDEN_CATEGORY_KEYS.has(categoryKey)) {
    return null;
  }

  if (body.set !== undefined && !isRecord(body.set)) return null;
  const rawSet = body.set === undefined ? {} : body.set;
  if (Object.keys(rawSet).some((field) => !SET_FIELDS.has(field))) return null;

  const setFields: Record<string, number | string> = {};
  for (const field of AMOUNT_FIELDS) {
    const value = rawSet[field];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_AMOUNT_WON
    ) {
      return null;
    }
    setFields[field] = value;
  }

  if (rawSet.nextPaymentDate !== undefined) {
    if (
      typeof rawSet.nextPaymentDate !== "string" ||
      parseLocalDateOnly(rawSet.nextPaymentDate) === null
    ) {
      return null;
    }
    setFields.nextPaymentDate = rawSet.nextPaymentDate;
  }
  if (
    typeof setFields.contractedTotal === "number" &&
    typeof setFields.paidToDate === "number" &&
    setFields.paidToDate > setFields.contractedTotal
  ) {
    return null;
  }
  if (rawSet.label !== undefined) {
    if (
      !categoryKey.startsWith("custom_") ||
      typeof rawSet.label !== "string" ||
      rawSet.label !== rawSet.label.trim() ||
      rawSet.label.length < 1 ||
      rawSet.label.length > 60 ||
      /[\u0000-\u001f\u007f]/.test(rawSet.label)
    ) {
      return null;
    }
    setFields.label = rawSet.label;
  }

  if (body.remove !== undefined && !Array.isArray(body.remove)) return null;
  const rawRemove = body.remove ?? [];
  if (
    rawRemove.length > REMOVE_FIELDS.size ||
    rawRemove.some((field) => typeof field !== "string" || !REMOVE_FIELDS.has(field)) ||
    new Set(rawRemove).size !== rawRemove.length ||
    rawRemove.some((field) => Object.hasOwn(setFields, field))
  ) {
    return null;
  }
  const removeFields = [...rawRemove] as string[];

  const visibility = body.visibility === undefined ? null : body.visibility;
  if (visibility !== null && visibility !== "visible" && visibility !== "hidden") {
    return null;
  }
  if (Object.keys(setFields).length === 0 && removeFields.length === 0 && visibility === null) {
    return null;
  }

  return { categoryKey, setFields, removeFields, visibility };
}

function isAuthoritativeProgress(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.__hidden === undefined) return true;
  return Array.isArray(value.__hidden) &&
    value.__hidden.every((key) => typeof key === "string" && CATEGORY_KEY_RE.test(key)) &&
    new Set(value.__hidden).size === value.__hidden.length;
}

function isValidManualRecordState(category: Record<string, unknown>): boolean {
  for (const field of AMOUNT_FIELDS) {
    if (!Object.hasOwn(category, field)) continue;
    const value = category[field];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_AMOUNT_WON
    ) {
      return false;
    }
  }
  if (
    Object.hasOwn(category, "nextPaymentDate") &&
    (
      typeof category.nextPaymentDate !== "string" ||
      parseLocalDateOnly(category.nextPaymentDate) === null
    )
  ) {
    return false;
  }
  return !(
    typeof category.contractedTotal === "number" &&
    typeof category.paidToDate === "number" &&
    category.paidToDate > category.contractedTotal
  );
}

function confirmsMutation(progress: Record<string, unknown>, mutation: CleanMutation): boolean {
  const category = progress[mutation.categoryKey];
  if ((Object.keys(mutation.setFields).length > 0 || mutation.removeFields.length > 0) && !isRecord(category)) {
    return false;
  }
  if (isRecord(category)) {
    if (category.category !== mutation.categoryKey) return false;
    if (!isValidManualRecordState(category)) return false;
    if (Object.entries(mutation.setFields).some(([field, value]) => category[field] !== value)) {
      return false;
    }
    if (mutation.removeFields.some((field) => Object.hasOwn(category, field))) {
      return false;
    }
  }
  if (mutation.visibility) {
    const isHidden = Array.isArray(progress.__hidden) && progress.__hidden.includes(mutation.categoryKey);
    if ((mutation.visibility === "hidden") !== isHidden) return false;
  }
  return true;
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

    const body = await request.json().catch(() => null);
    const mutation = cleanMutation(body);
    if (!mutation) {
      return NextResponse.json({ error: "예산 항목 입력값을 확인해 주세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보를 확인할 수 없습니다." }, { status: 404 });
    }

    const { data, error } = await admin.rpc("mutate_journey_budget_category", {
      p_couple_id: profile.couple_id,
      p_category_key: mutation.categoryKey,
      p_set_fields: mutation.setFields,
      p_remove_fields: mutation.removeFields,
      p_visibility: mutation.visibility,
    });
    if (error) {
      console.error("atomic budget category mutation failed:", error);
      return NextResponse.json(
        { error: error.code === "P0002" ? "웨딩 여정을 찾을 수 없습니다." : "예산 항목을 저장하지 못했습니다." },
        { status: error.code === "P0002" ? 404 : 500 },
      );
    }

    if (
      !isRecord(data) ||
      data.categoryKey !== mutation.categoryKey ||
      !isAuthoritativeProgress(data.progress) ||
      !confirmsMutation(data.progress, mutation)
    ) {
      console.error("atomic budget category mutation returned malformed data");
      return NextResponse.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      progress: data.progress,
      categoryKey: data.categoryKey,
    });
  } catch (error) {
    console.error("Budget category API error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
