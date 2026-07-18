import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  COMBO_CATEGORIES,
  parseComboSaveBody,
  repriceComboSelections,
  type PublicComboOption,
  type PublicComboPrice,
} from "@/lib/priceCombo/serverValidation";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_SAVED_COMBOS = 100;
const SAVED_COMBO_COLUMNS = [
  "id",
  "name",
  "selections",
  "total_krw",
  "created_at",
  "updated_at",
  "request_hash",
].join(", ");

type SavedComboRow = Record<string, unknown> & { request_hash: string };

function comboRequestHash(body: NonNullable<ReturnType<typeof parseComboSaveBody>>) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function publicCombo(row: SavedComboRow) {
  const combo: Record<string, unknown> = { ...row };
  delete combo.request_hash;
  return combo;
}

export async function GET(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("combos")
    .select("id, name, selections, total_krw, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_COMBOS);
  if (error) {
    return NextResponse.json(
      { error: "저장한 조합을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
  return NextResponse.json({ combos: data ?? [] });
}

export async function POST(request: Request) {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = checkRateLimit(rateLimitKey("price-combos:create", request, user.id), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "요청을 읽을 수 없습니다." }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  let unknownBody: unknown;
  try {
    unknownBody = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "JSON 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const body = parseComboSaveBody(unknownBody);
  if (!body) {
    return NextResponse.json({ error: "조합 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!isUuid(idempotencyKey)) {
    return NextResponse.json(
      { error: "저장 요청 식별자가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const requestHash = comboRequestHash(body);
  const { data: existingComboData, error: existingComboError } = await supabase
    .from("combos")
    .select(SAVED_COMBO_COLUMNS)
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  const existingCombo = existingComboData as unknown as SavedComboRow | null;
  if (existingComboError) {
    return NextResponse.json(
      { error: "저장 요청 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  if (existingCombo) {
    if (existingCombo.request_hash !== requestHash) {
      return NextResponse.json(
        { error: "같은 저장 요청 식별자를 다른 조합에 사용할 수 없습니다." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      combo: publicCombo(existingCombo),
      replayed: true,
    });
  }

  const vendorIds = [...new Set(COMBO_CATEGORIES.flatMap((category) => {
    const selection = body.selections[category];
    return selection ? [selection.vendor_id] : [];
  }))];
  const { data: prices, error: pricesError } = await supabase
    .from("v_public_prices")
    .select("official_price_id, vendor_id, category, agency_id, price_min_krw")
    .in("vendor_id", vendorIds)
    .eq("is_current", true);
  if (pricesError) {
    return NextResponse.json(
      { error: "현재 공개 가격을 확인하지 못했습니다." },
      { status: 503 },
    );
  }

  const publicPrices = (prices ?? []) as PublicComboPrice[];
  const officialPriceIds = [...new Set(publicPrices.map((price) => price.official_price_id))];
  const { data: options, error: optionsError } = await supabase
    .from("v_public_price_options")
    .select("official_price_id, name, price_min_krw")
    .in("official_price_id", officialPriceIds);
  if (optionsError) {
    return NextResponse.json(
      { error: "현재 공개 추가금을 확인하지 못했습니다." },
      { status: 503 },
    );
  }

  let repriced: ReturnType<typeof repriceComboSelections>;
  try {
    repriced = repriceComboSelections(body.selections, {
      prices: publicPrices,
      options: (options ?? []) as PublicComboOption[],
    });
  } catch {
    return NextResponse.json(
      { error: "가격이 갱신되었습니다. 최신 가격으로 다시 조합해 주세요." },
      { status: 409 },
    );
  }

  const insertPayload = {
    idempotency_key: idempotencyKey,
    user_id: user.id,
    name: body.name,
    request_hash: requestHash,
    selections: repriced.selections,
    total_krw: repriced.totalKrw,
  };
  const { data, error } = await supabase
    .from("combos")
    .insert(insertPayload)
    .select("id, name, selections, total_krw, created_at, updated_at")
    .single();
  if (error?.code === "23505") {
    const { data: raceWinnerData, error: raceWinnerError } = await supabase
      .from("combos")
      .select(SAVED_COMBO_COLUMNS)
      .eq("user_id", user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const raceWinner = raceWinnerData as unknown as SavedComboRow | null;
    if (raceWinnerError || !raceWinner) {
      return NextResponse.json(
        { error: "조합 저장 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." },
        { status: 503 },
      );
    }
    if (raceWinner.request_hash !== requestHash) {
      return NextResponse.json(
        { error: "같은 저장 요청 식별자를 다른 조합에 사용할 수 없습니다." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      combo: publicCombo(raceWinner),
      replayed: true,
    });
  }
  if (error || !data) {
    return NextResponse.json(
      { error: "조합을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    combo: publicCombo({ ...data, ...insertPayload } as SavedComboRow),
  }, { status: 201 });
}
