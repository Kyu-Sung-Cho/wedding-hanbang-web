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
  guaranteedGuests: "보증 인원",
  mealPriceManwon: "1인 식대",
  noShowRatePercent: "계산에 사용할 불참률",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundManwon(value: number): number {
  return Math.round(value * 10) / 10;
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
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const now = new Date();
  const kstNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((target - kstNow) / 86400000);
}

function buildVenueMessage(input: {
  venueName: string | null;
  estimatedGuests: number;
  guaranteedGuests: number;
  mealPriceManwon: number;
  expectedAttendanceGuests: number;
}) {
  const intro = input.venueName
    ? `${input.venueName} 보증 인원 확인차 문의드립니다.`
    : "보증 인원 확인차 문의드립니다.";
  return `${intro}
현재 예상 하객은 ${input.estimatedGuests}명이고, 노쇼를 감안한 참석 예상은 약 ${input.expectedAttendanceGuests}명입니다.
계약서 기준 보증 인원 ${input.guaranteedGuests}명, 식대 1인 ${input.mealPriceManwon}만원으로 이해했는데 맞을까요?
최종 인원 변경 가능 마감일, 보증 인원 하향 가능 여부, 초과 인원 정산 기준을 문서로 확인 부탁드립니다.`;
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
    return {
      mode: "input_needed",
      riskLevel: "medium",
      riskLabel: RISK_LABELS.medium,
      summaryTitle: "보증 인원 계산에 필요한 값이 조금 부족해요",
      summaryText: `${labels}만 알려주시면 식대 손실과 조정 기준을 바로 계산할 수 있습니다.`,
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
      recommendation: `한 번에 이렇게 알려주시면 됩니다: 예상 180명, 보증 200명, 식대 7.5만원, 계산할 불참률 5%.`,
      vendorQuestions: [
        "최종 인원 통보 마감일은 언제인가요?",
        "보증 인원 하향 조정이 가능한 마지막 날짜가 있나요?",
        "보증 초과 인원은 당일 식대 단가로만 정산되나요?",
      ],
      venueMessage: "",
      sourceNote: "사용자 입력값 기반 시뮬레이션입니다. 업체별 계약 조건은 별도 확인이 필요합니다.",
    };
  }

  const baseGuests = confirmedRsvpGuests && confirmedRsvpGuests > estimatedGuests!
    ? confirmedRsvpGuests
    : estimatedGuests!;
  const expectedAttendanceGuests = Math.max(1, Math.round(baseGuests * (1 - noShowRatePercent! / 100)));
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
        ? "입력한 불참률 시나리오와 보증 인원 사이에 차이가 있어요"
        : "입력한 불참률 시나리오에서는 보증 인원 이상으로 계산돼요";

  const deadlineText =
    deadlineDays === null
      ? "최종 인원 통보 마감일은 아직 확인되지 않았습니다."
      : deadlineDays < 0
        ? "최종 인원 통보 마감일이 이미 지났을 수 있습니다."
        : `최종 인원 통보 마감일까지 약 ${deadlineDays}일 남았습니다.`;

  const summaryText =
    emptySeats > 0
      ? `사용자가 지정한 불참률 ${noShowRatePercent}%로 계산하면 참석 시나리오는 ${expectedAttendanceGuests}명입니다. 보증 ${guaranteedGuests}명과의 차이는 ${emptySeats}명, 식대 차이 후보는 약 ${emptySeatLossManwon}만원입니다. ${deadlineText}`
      : `사용자가 지정한 불참률 ${noShowRatePercent}%로 계산하면 참석 시나리오는 ${expectedAttendanceGuests}명이고 보증 인원 이상입니다. 식대 계산값은 약 ${expectedMealTotalManwon}만원입니다. ${deadlineText}`;

  const recommendation =
    emptySeats > 0
      ? `업체가 허용하면 보증 인원을 사용자 시나리오의 ${expectedAttendanceGuests}명 쪽으로 조정할 수 있는지 먼저 서면으로 물어보세요. 실제 변경 가능 범위와 정산 기준은 계약 조건을 따라야 합니다.`
      : "보증 인원을 더 낮추기보다 초과 인원 정산 방식과 좌석·식사 여유분을 확인하는 쪽이 좋습니다.";

  const vendorQuestions = [
    "최종 인원 통보 마감일은 언제인가요?",
    "보증 인원 하향 조정이 가능한 마지막 날짜와 최소 단위가 있나요?",
    "보증 인원보다 적게 오면 식대는 보증 인원 기준으로 전액 정산되나요?",
    "보증 인원을 넘는 하객은 같은 식대 단가로 당일 추가 정산되나요?",
    "어린이, 업체 스태프, 혼주 식사는 같은 단가로 계산되나요?",
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
