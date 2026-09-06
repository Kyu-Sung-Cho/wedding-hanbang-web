import {
  kstMidnightFromYmd,
  todayKstMidnight,
} from "@/lib/utils/kstDate";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

export type GuestGuaranteeRiskLevel = "low" | "medium" | "high";

export interface GuestGuaranteeInput {
  estimatedGuests?: number;
  guaranteedGuests?: number;
  mealPriceManwon?: number;
  confirmedRsvpGuests?: number;
  noShowRatePercent?: number;
  noticeDeadlineYmd?: string;
  venueName?: string;
  memo?: string;
}

export interface GuestGuaranteeScenario {
  id: "conservative" | "expected" | "optimistic";
  label: string;
  attendanceGuests: number;
  payableGuests: number;
  mealTotalManwon: number;
  emptySeats: number;
  emptySeatLossManwon: number;
}

export interface GuestGuaranteeResult {
  mode: "input_needed" | "analysis";
  riskLevel: GuestGuaranteeRiskLevel;
  riskLabel: string;
  summaryTitle: string;
  summaryText: string;
  venueName: string | null;
  estimatedGuests: number | null;
  confirmedRsvpGuests: number | null;
  guaranteedGuests: number | null;
  mealPriceManwon: number | null;
  noShowRatePercent: number | null;
  expectedAttendanceGuests: number | null;
  payableGuests: number | null;
  expectedMealTotalManwon: number | null;
  emptySeats: number | null;
  emptySeatLossManwon: number | null;
  scenarios: GuestGuaranteeScenario[];
  missingFields: string[];
  recommendation: string;
  vendorQuestions: string[];
  venueMessage: string;
  sourceNote: string;
}

const RISK_LABELS: Record<GuestGuaranteeRiskLevel, string> = {
  low: "보증 범위 안",
  medium: "차이 확인",
  high: "마감 확인",
};

const FIELD_LABELS: Record<string, string> = {
  estimatedGuests: "예상 하객 수",
  guaranteedGuests: "계약상 최소 결제 식사 인원",
  mealPriceManwon: "한 사람당 식사비",
  noShowRatePercent: "계산에 사용할 불참률",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundManwon(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toScenario(
  id: GuestGuaranteeScenario["id"],
  label: string,
  attendanceGuests: number,
  guaranteedGuests: number,
  mealPriceManwon: number
): GuestGuaranteeScenario {
  const payableGuests = Math.max(attendanceGuests, guaranteedGuests);
  const emptySeats = Math.max(0, guaranteedGuests - attendanceGuests);
  return {
    id,
    label,
    attendanceGuests,
    payableGuests,
    mealTotalManwon: roundManwon(payableGuests * mealPriceManwon),
    emptySeats,
    emptySeatLossManwon: roundManwon(emptySeats * mealPriceManwon),
  };
}

function daysUntil(ymd?: string): number | null {
  if (!ymd || !isValidScheduleYmd(ymd)) return null;
  return Math.ceil(
    (kstMidnightFromYmd(ymd).getTime() - todayKstMidnight().getTime()) / 86_400_000,
  );
}

function buildVenueMessage(input: {
  venueName: string | null;
  estimatedGuests: number;
  guaranteedGuests: number;
  mealPriceManwon: number;
  expectedAttendanceGuests: number;
}) {
  const intro = input.venueName
    ? `${input.venueName}의 계약상 최소 결제 식사 인원 확인차 문의드립니다.`
    : "계약상 최소 결제 식사 인원 확인차 문의드립니다.";
  return `${intro}
현재 예상 하객은 ${input.estimatedGuests}명이고, 제가 입력한 불참률로 계산한 인원은 ${input.expectedAttendanceGuests}명입니다.
계약서 기준 최소 결제 식사 인원은 ${input.guaranteedGuests}명, 한 사람당 식사비는 ${input.mealPriceManwon}만원으로 이해했는데 맞을까요?
최종 인원을 알릴 날짜, 최소 결제 식사 인원을 줄일 수 있는지, 초과 인원 계산 기준을 문서로 확인 부탁드립니다.`;
}

export function simulateGuestGuarantee(input: GuestGuaranteeInput): GuestGuaranteeResult {
  const estimatedGuests = Number.isFinite(input.estimatedGuests) && (input.estimatedGuests ?? 0) > 0
    ? Math.round(input.estimatedGuests!)
    : null;
  const guaranteedGuests = Number.isFinite(input.guaranteedGuests) && (input.guaranteedGuests ?? 0) > 0
    ? Math.round(input.guaranteedGuests!)
    : null;
  const mealPriceManwon = Number.isFinite(input.mealPriceManwon) && (input.mealPriceManwon ?? 0) > 0
    ? roundManwon(input.mealPriceManwon!)
    : null;
  const confirmedRsvpGuests = Number.isFinite(input.confirmedRsvpGuests) && (input.confirmedRsvpGuests ?? 0) > 0
    ? Math.round(input.confirmedRsvpGuests!)
    : null;
  const noShowRatePercent = Number.isFinite(input.noShowRatePercent)
    && (input.noShowRatePercent ?? -1) >= 0
    && (input.noShowRatePercent ?? 101) <= 100
    ? clamp(input.noShowRatePercent!, 0, 100)
    : null;
  const venueName = input.venueName?.trim() || null;

  const missingFields = [
    estimatedGuests === null ? "estimatedGuests" : "",
    guaranteedGuests === null ? "guaranteedGuests" : "",
    mealPriceManwon === null ? "mealPriceManwon" : "",
    noShowRatePercent === null ? "noShowRatePercent" : "",
  ].filter(Boolean);

  if (missingFields.length > 0) {
    const labels = missingFields.map((field) => FIELD_LABELS[field]).join(", ");
    const referenceMealTotal = estimatedGuests !== null && mealPriceManwon !== null
      ? roundManwon(estimatedGuests * mealPriceManwon)
      : null;
    const referenceText = referenceMealTotal !== null
      ? `입력한 예상 하객 ${estimatedGuests}명 × 한 사람당 ${mealPriceManwon}만원 = ${referenceMealTotal.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}만원입니다. 보증 인원·불참률을 적용하지 않은 단순 곱셈으로, 최종 정산액이 아닙니다.`
      : null;
    return {
      mode: "input_needed",
      riskLevel: "medium",
      riskLabel: RISK_LABELS.medium,
      summaryTitle: referenceText ? "입력한 인원으로 계산한 식사비예요" : "식사비 계산에 필요한 값이 부족해요",
      summaryText: referenceText ?? `${labels}을 알려주시면 입력한 값으로 식사비를 계산할 수 있어요.`,
      venueName,
      estimatedGuests,
      confirmedRsvpGuests,
      guaranteedGuests,
      mealPriceManwon,
      noShowRatePercent,
      expectedAttendanceGuests: null,
      payableGuests: null,
      expectedMealTotalManwon: null,
      emptySeats: null,
      emptySeatLossManwon: null,
      scenarios: [],
      missingFields,
      recommendation: [
        missingFields.filter(field => field !== "noShowRatePercent").length > 0
          ? `${missingFields.filter(field => field !== "noShowRatePercent").map(field => FIELD_LABELS[field]).join(", ")}만 추가로 확인해 주세요.`
          : "입력한 인원과 식사비는 유지합니다.",
        noShowRatePercent === null ? "불참률별 비교가 필요할 때만 직접 정한 비율을 알려주세요. 모르는 비율은 임의로 정하지 않습니다." : "",
      ].filter(Boolean).join(" "),
      vendorQuestions: [
        "최종 인원 통보 마감일은 언제인가요?",
        "계약상 최소 결제 식사 인원을 줄일 수 있는 마지막 날짜가 있나요?",
        "최소 결제 식사 인원을 넘으면 같은 식사비로 계산되나요?",
      ],
      venueMessage: "",
      sourceNote: "사용자 입력값 기반 시뮬레이션입니다. 업체별 계약 조건은 별도 확인이 필요합니다.",
    };
  }

  const baseGuests = confirmedRsvpGuests && confirmedRsvpGuests > estimatedGuests!
    ? confirmedRsvpGuests
    : estimatedGuests!;
  const expectedAttendanceGuests = Math.max(0, Math.round(baseGuests * (1 - noShowRatePercent! / 100)));
  const payableGuests = Math.max(expectedAttendanceGuests, guaranteedGuests!);
  const expectedMealTotalManwon = roundManwon(payableGuests * mealPriceManwon!);
  const emptySeats = Math.max(0, guaranteedGuests! - expectedAttendanceGuests);
  const emptySeatLossManwon = roundManwon(emptySeats * mealPriceManwon!);

  const scenarios = [
    toScenario(
      "expected",
      `사용자 지정 불참률 ${noShowRatePercent}%`,
      expectedAttendanceGuests,
      guaranteedGuests!,
      mealPriceManwon!,
    ),
  ];

  const deadlineDays = daysUntil(input.noticeDeadlineYmd);
  const deadlinePassed = deadlineDays !== null && deadlineDays < 0;
  const riskLevel: GuestGuaranteeRiskLevel = deadlinePassed
    ? "high"
    : emptySeats > 0
      ? "medium"
      : "low";

  const summaryTitle =
    riskLevel === "high"
      ? "최종 인원 통보 마감일을 업체에 바로 확인해 주세요"
      : riskLevel === "medium"
      ? "입력한 불참률 계산값과 최소 결제 식사 인원 사이에 차이가 있어요"
        : "입력한 불참률 계산값은 최소 결제 식사 인원 이상이에요";

  const deadlineText =
    deadlineDays === null
      ? "최종 인원 통보 마감일은 아직 확인되지 않았습니다."
      : deadlineDays < 0
        ? "최종 인원 통보 마감일이 이미 지났을 수 있습니다."
        : `최종 인원 통보 마감일까지 약 ${deadlineDays}일 남았습니다.`;

  const summaryText =
    emptySeats > 0
      ? `사용자가 지정한 불참률 ${noShowRatePercent}%를 단순 적용한 값은 ${expectedAttendanceGuests}명입니다. 계약상 최소 결제 식사 인원 ${guaranteedGuests}명과의 차이는 ${emptySeats}명이고, 그 차이에 해당하는 식사비 계산값은 약 ${emptySeatLossManwon}만원입니다. ${deadlineText}`
      : `사용자가 지정한 불참률 ${noShowRatePercent}%를 단순 적용한 값은 ${expectedAttendanceGuests}명으로, 계약상 최소 결제 식사 인원 이상입니다. 식사비 계산값은 약 ${expectedMealTotalManwon}만원입니다. ${deadlineText}`;

  const recommendation =
    emptySeats > 0
      ? "계약상 최소 결제 식사 인원을 줄일 수 있는지와 가능한 범위를 업체에 서면으로 물어보세요. 입력한 불참률은 예측값이 아니므로 그 계산 인원에 맞춰 계약을 바꾸기 전에 실제 참석 확인과 계약 조건을 함께 봐야 합니다."
      : "현재 계산만으로 최소 결제 식사 인원을 바꿀 필요가 있는지는 정할 수 없어요. 초과 인원 계산 방식과 좌석·식사 준비 기준을 계약서에서 확인하세요.";

  const vendorQuestions = [
    "최종 인원 통보 마감일은 언제인가요?",
    "계약상 최소 결제 식사 인원을 줄일 수 있는 마지막 날짜와 변경 단위가 있나요?",
    "실제 참석자가 최소 결제 식사 인원보다 적으면 식사비는 어떤 인원을 기준으로 계산하나요?",
    "최소 결제 식사 인원을 넘는 하객은 같은 식사비로 당일 추가 계산되나요?",
    "어린이, 업체 직원, 두 사람의 부모님 식사는 같은 금액으로 계산되나요?",
  ];

  return {
    mode: "analysis",
    riskLevel,
    riskLabel: RISK_LABELS[riskLevel],
    summaryTitle,
    summaryText,
    venueName,
    estimatedGuests,
    confirmedRsvpGuests,
    guaranteedGuests,
    mealPriceManwon,
    noShowRatePercent,
    expectedAttendanceGuests,
    payableGuests,
    expectedMealTotalManwon,
    emptySeats,
    emptySeatLossManwon,
    scenarios,
    missingFields: [],
    recommendation,
    vendorQuestions,
    venueMessage: buildVenueMessage({
      venueName,
      estimatedGuests: estimatedGuests!,
      guaranteedGuests: guaranteedGuests!,
      mealPriceManwon: mealPriceManwon!,
      expectedAttendanceGuests,
    }),
    sourceNote: "사용자 입력값과 사용자가 직접 정한 불참률 시나리오의 단순 계산입니다. 예측이나 업계 평균이 아니며 최종 정산은 업체 계약서 기준으로 확인해야 합니다.",
  };
}
