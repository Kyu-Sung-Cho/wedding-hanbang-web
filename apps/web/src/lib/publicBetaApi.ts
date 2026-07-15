import { NextResponse } from "next/server";

export const VENDOR_CATALOG_RETIRED_CODE = "vendor_catalog_retired" as const;
export const COHORT_ROOMS_RETIRED_CODE = "cohort_rooms_retired" as const;

export function vendorCatalogRetiredResponse() {
  return NextResponse.json(
    {
      error: "출처·최신성·연결 가능 여부를 확인한 업체 카탈로그를 현재 제공하지 않습니다.",
      code: VENDOR_CATALOG_RETIRED_CODE,
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export function cohortRoomsRetiredResponse() {
  return NextResponse.json(
    {
      error: "동기방은 개인정보, 표본 보호와 운영 검증이 끝나지 않아 현재 제공하지 않습니다.",
      code: COHORT_ROOMS_RETIRED_CODE,
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
