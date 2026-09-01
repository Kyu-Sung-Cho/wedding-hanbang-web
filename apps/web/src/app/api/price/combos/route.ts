import { createHash } from "node:crypto";
import { log } from "@/utils/log";

import {
  COMBO_CATEGORIES,
  parseComboSaveBody,
  repriceComboSelections,
  type PublicComboOption,
  type PublicComboPrice,
} from "@/lib/priceCombo/serverValidation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { mobileBridgeJson as boundedMobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 32 * 1024;
const LATEST_SAVED_COMBO_LIMIT = 1;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
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
type SavedComboServiceRow = SavedComboRow & { replayed: boolean };

function mobileBridgeJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(PRIVATE_NO_STORE_HEADERS);
  new Headers(init.headers).forEach((headerValue, headerName) => {
    headers.set(headerName, headerValue);
  });
  return boundedMobileBridgeJson(value, { ...init, headers });
}

function comboRequestHash(body: NonNullable<ReturnType<typeof parseComboSaveBody>>) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function publicCombo(row: SavedComboRow) {
  const combo: Record<string, unknown> = { ...row };
  delete combo.request_hash;
  delete combo.replayed;
  return combo;
}

export async function GET(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return mobileBridgeJson({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("combos")
    .select("id, name, selections, total_krw, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(LATEST_SAVED_COMBO_LIMIT);
  if (error) {
    return mobileBridgeJson(
      { error: "저장한 조합을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
  return mobileBridgeJson({ combos: data ?? [] });
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403 },
    );
  }

  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return mobileBridgeJson({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return mobileBridgeJson({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = checkRateLimit(rateLimitKey("price-combos:create", request, user.id), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return mobileBridgeJson(
      {
        error: bodyResult.reason === "too_large"
          ? "요청 본문이 너무 큽니다."
          : "요청을 읽을 수 없습니다.",
      },
      { status: bodyResult.reason === "too_large" ? 413 : 400 },
    );
  }
  const rawBody = bodyResult.text;

  let unknownBody: unknown;
  try {
    unknownBody = JSON.parse(rawBody) as unknown;
  } catch {
    return mobileBridgeJson({ error: "JSON 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const body = parseComboSaveBody(unknownBody);
  if (!body) {
    return mobileBridgeJson({ error: "조합 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!isUuid(idempotencyKey)) {
    return mobileBridgeJson(
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
    return mobileBridgeJson(
      { error: "저장 요청 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  if (existingCombo) {
    if (existingCombo.request_hash !== requestHash) {
      return mobileBridgeJson(
        { error: "같은 저장 요청 식별자를 다른 조합에 사용할 수 없습니다." },
        { status: 409 },
      );
    }
    return mobileBridgeJson({
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
    return mobileBridgeJson(
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
    return mobileBridgeJson(
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
    return mobileBridgeJson(
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
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    log.error("api/price/combos", err);
    return mobileBridgeJson(
      { error: "조합 저장 경로를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  const { data: serviceData, error } = await admin
    .rpc("save_price_combo_service_v1", {
      p_user_id: insertPayload.user_id,
      p_name: insertPayload.name,
      p_selections: insertPayload.selections,
      p_total_krw: insertPayload.total_krw,
      p_idempotency_key: insertPayload.idempotency_key,
      p_request_hash: insertPayload.request_hash,
    })
    .single();
  const data = serviceData as unknown as SavedComboServiceRow | null;
  if (error?.code === "23505") {
    const { data: raceWinnerData, error: raceWinnerError } = await supabase
      .from("combos")
      .select(SAVED_COMBO_COLUMNS)
      .eq("user_id", user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const raceWinner = raceWinnerData as unknown as SavedComboRow | null;
    if (raceWinnerError || !raceWinner) {
      return mobileBridgeJson(
        { error: "조합 저장 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." },
        { status: 503 },
      );
    }
    if (raceWinner.request_hash !== requestHash) {
      return mobileBridgeJson(
        { error: "같은 저장 요청 식별자를 다른 조합에 사용할 수 없습니다." },
        { status: 409 },
      );
    }
    return mobileBridgeJson({
      combo: publicCombo(raceWinner),
      replayed: true,
    });
  }
  if (error || !data) {
    return mobileBridgeJson(
      { error: "조합을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  return mobileBridgeJson({
    combo: publicCombo(data),
    ...(data.replayed ? { replayed: true } : {}),
  }, { status: data.replayed ? 200 : 201 });
}
