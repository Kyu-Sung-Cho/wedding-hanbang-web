import { NextResponse } from "next/server";

const CLOSED_RESPONSE = {
  code: "CUSTOMER_SURVEY_INTAKE_CLOSED",
  error: "현재 설문 응답을 받지 않습니다.",
} as const;

export function POST() {
  return NextResponse.json(CLOSED_RESPONSE, {
    status: 410,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
