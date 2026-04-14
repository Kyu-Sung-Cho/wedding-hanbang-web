import { NextResponse } from "next/server";

// 관계별 평균 축의금 (2024 기준, 원)
const AVERAGE_AMOUNTS: Record<string, number> = {
  family: 500_000,
  relative: 200_000,
  friend: 70_000,
  coworker: 50_000,
  boss: 100_000,
  acquaintance: 50_000,
};

const RELATION_LABELS: Record<string, string> = {
  family: "가족",
  relative: "친척",
  friend: "친구",
  coworker: "직장동료",
  boss: "직장상사",
  acquaintance: "지인",
};

const VALID_RELATIONS = Object.keys(AVERAGE_AMOUNTS);
const VALID_SIDES = ["bride", "groom"];

interface GuestGroup {
  relation: string;
  count: number;
  side: string;
}

// 축의금 예측 팁
const TIPS = [
  "친구 축의금은 3만원~10만원으로 편차가 큽니다",
  "직장 상사는 직급에 따라 10만원~30만원까지 차이가 날 수 있습니다",
  "가족 축의금은 관계 친밀도에 따라 30만원~100만원 이상도 가능합니다",
  "축의금은 홀수 금액(3, 5, 7, 10만원)이 일반적입니다",
  "요즘은 계좌이체로 축의금을 보내는 경우도 많아졌습니다",
  "친척은 촌수에 따라 10만원~50만원까지 다양합니다",
  "회사 동료들은 단체로 모아서 내는 경우도 있습니다",
];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { guests } = body;

    // 입력 검증
    if (!Array.isArray(guests) || guests.length === 0) {
      return NextResponse.json(
        { error: "guests 배열이 필요합니다" },
        { status: 400 }
      );
    }

    for (const guest of guests) {
      if (!VALID_RELATIONS.includes(guest.relation)) {
        return NextResponse.json(
          { error: `유효하지 않은 관계: ${guest.relation}` },
          { status: 400 }
        );
      }
      if (typeof guest.count !== "number" || guest.count < 0 || !Number.isInteger(guest.count)) {
        return NextResponse.json(
          { error: "count는 0 이상의 정수여야 합니다" },
          { status: 400 }
        );
      }
      if (!VALID_SIDES.includes(guest.side)) {
        return NextResponse.json(
          { error: `유효하지 않은 side: ${guest.side}` },
          { status: 400 }
        );
      }
    }

    // 계산
    let totalGuests = 0;
    let predictedTotal = 0;

    const breakdown: Array<{
      relation: string;
      label: string;
      count: number;
      averagePerPerson: number;
      subtotal: number;
      side: string;
    }> = [];

    for (const guest of guests as GuestGroup[]) {
      const avg = AVERAGE_AMOUNTS[guest.relation];
      const subtotal = guest.count * avg;
      totalGuests += guest.count;
      predictedTotal += subtotal;

      breakdown.push({
        relation: guest.relation,
        label: RELATION_LABELS[guest.relation],
        count: guest.count,
        averagePerPerson: avg,
        subtotal,
        side: guest.side,
      });
    }

    // 신랑/신부측 합계
    const brideSideTotal = breakdown
      .filter((b) => b.side === "bride")
      .reduce((sum, b) => sum + b.subtotal, 0);
    const groomSideTotal = breakdown
      .filter((b) => b.side === "groom")
      .reduce((sum, b) => sum + b.subtotal, 0);

    // 관련 팁 선별 (입력된 관계에 맞는 팁 우선 + 일반 팁)
    const relationSet = new Set(guests.map((g: GuestGroup) => g.relation));
    const relevantTips: string[] = [];

    if (relationSet.has("friend")) relevantTips.push(TIPS[0]);
    if (relationSet.has("boss")) relevantTips.push(TIPS[1]);
    if (relationSet.has("family")) relevantTips.push(TIPS[2]);
    relevantTips.push(TIPS[3]);
    if (relationSet.has("relative")) relevantTips.push(TIPS[5]);
    if (relationSet.has("coworker")) relevantTips.push(TIPS[6]);
    if (relevantTips.length < 3) relevantTips.push(TIPS[4]);

    const result = {
      total_guests: totalGuests,
      predicted_total: predictedTotal,
      breakdown,
      side_totals: {
        bride: brideSideTotal,
        groom: groomSideTotal,
      },
      range: {
        min: Math.round(predictedTotal * 0.7),
        max: Math.round(predictedTotal * 1.3),
      },
      tips: relevantTips,
    };

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=60",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청입니다" },
      { status: 400 }
    );
  }
}
