import { INVITATION_REGIONS } from "@hanbang/shared/invitation";
import { z } from "zod";

/**
 * 운영자가 넣는 웨딩홀 자료 검사. 가격은 업체가 공개한 곳의 주소(https)와 확인한 날을 함께 적어야 한다.
 * 같은 규칙을 DB 검사 제약이 한 번 더 지킨다. 공개 여부(active)의 기본값은 꺼짐이다.
 * 지역은 커플 조건과 같은 정본 목록(`INVITATION_REGIONS`)에서만 고른다. 그래야 비교가 글자 그대로 맞는다.
 */

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const safeText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !UNSAFE.test(value), "숨은 문자가 있어요.");
const httpsUrl = z.string().trim().max(500).regex(/^https:\/\/\S+$/, "https 주소만 받아요.");

export const hallListingFields = {
  name: safeText(60),
  region: z.enum(INVITATION_REGIONS),
  areaLabel: safeText(40),
  kindLabel: safeText(30),
  mealPriceWon: z.number().int().min(1_000).max(1_000_000),
  rentalIncluded: z.boolean(),
  rentalFeeWon: z.number().int().min(0).max(200_000_000).nullable(),
  minimumGuarantee: z.number().int().min(1).max(3_000).nullable(),
  stationWalkMinutes: z.number().int().min(0).max(120).nullable(),
  transitNote: safeText(40).nullable(),
  photoUrl: httpsUrl.nullable(),
  sourceUrl: httpsUrl,
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean(),
};

export const hallListingCreateSchema = z.object(hallListingFields).strict();
export const hallListingPatchSchema = z.object(hallListingFields).partial().strict();

export type HallListingInput = z.infer<typeof hallListingCreateSchema>;

/** 서로 엮인 칸: 대관료는 "식대에 포함"이거나 금액이 있어야 하고, 확인일은 2024년 뒤 오늘까지다. */
export function crossCheckListing(value: Pick<HallListingInput, "rentalIncluded" | "rentalFeeWon" | "checkedOn">, todayYmd: string): string | null {
  if (value.rentalIncluded && value.rentalFeeWon !== null) return "식대에 포함이면 대관료 금액을 비워 주세요.";
  if (!value.rentalIncluded && value.rentalFeeWon === null) return "대관료 금액을 적거나 식대에 포함을 골라 주세요.";
  if (value.checkedOn < "2024-01-01" || value.checkedOn > todayYmd || Number.isNaN(Date.parse(`${value.checkedOn}T00:00:00Z`))) {
    return "확인한 날을 다시 적어 주세요.";
  }
  return null;
}

/** API 이름을 DB 칸 이름으로. 보낸 칸만 담는다. */
export function toListingColumns(value: Partial<HallListingInput>): Record<string, unknown> {
  const map: Record<keyof HallListingInput, string> = {
    name: "name",
    region: "region",
    areaLabel: "area_label",
    kindLabel: "kind_label",
    mealPriceWon: "meal_price_won",
    rentalIncluded: "rental_included",
    rentalFeeWon: "rental_fee_won",
    minimumGuarantee: "minimum_guarantee",
    stationWalkMinutes: "station_walk_minutes",
    transitNote: "transit_note",
    photoUrl: "photo_url",
    sourceUrl: "source_url",
    checkedOn: "checked_on",
    active: "active",
  };
  return Object.fromEntries(
    (Object.keys(value) as (keyof HallListingInput)[]).map((key) => [map[key], value[key]]),
  );
}
