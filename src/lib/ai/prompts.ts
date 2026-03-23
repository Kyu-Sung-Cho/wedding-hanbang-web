import { CATEGORY_LABELS } from "./toolExecutor";
import { getMarketPriceContext } from "@/constants/marketPrices";

export function getWeddingPlannerSystemPrompt(context: {
  weddingDate: string | null;
  budget: number;
  venue: string | null;
  progress: Record<string, unknown>;
  brideName: string | null;
  groomName: string | null;
  senderName: string;
  bookings: Array<{
    vendorName: string;
    category: string;
    date: string;
    time: string;
    status: string;
    amount: number;
  }>;
  scheduleEvents: Array<{
    date: string;
    title: string;
    memo?: string;
    categoryKey?: string;
  }>;
  chatSummaries: string[];
}) {
  const dateInfo = context.weddingDate
    ? `결혼 예정일: ${context.weddingDate}`
    : "결혼 날짜: 아직 미정";

  // D-day 계산
  let dDayInfo = "";
  if (context.weddingDate) {
    const diff = Math.ceil((new Date(context.weddingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    dDayInfo = diff > 0 ? `(D-${diff})` : diff === 0 ? "(D-Day!)" : `(D+${Math.abs(diff)})`;
  }

  const budgetInfo =
    context.budget > 0
      ? `총 예산: ${(context.budget / 10000).toLocaleString()}만원`
      : "예산: 미설정";

  const venueInfo = context.venue ? `예식장: ${context.venue}` : "예식장: 미정";

  // 커플 이름
  const coupleInfo = [
    context.brideName ? `신부: ${context.brideName}` : null,
    context.groomName ? `신랑: ${context.groomName}` : null,
  ].filter(Boolean).join(", ");

  const progressEntries = Object.entries(context.progress).filter(([k]) => k !== "__events");

  // 카테고리별 상세 현황 생성
  const categoryStatus = Object.entries(CATEGORY_LABELS)
    .map(([key, label]) => {
      const p = (context.progress[key] ?? {}) as Record<string, unknown>;
      const status = p.status === "completed" ? "✅완료" : p.status === "in_progress" ? "🔄진행중" : "⬜예정";
      const budget = typeof p.budget === "number" ? `${(p.budget as number / 10000).toLocaleString()}만원` : "미설정";
      const spent = typeof p.spent === "number" || typeof p.cost === "number"
        ? `지출: ${(((p.spent ?? p.cost) as number) / 10000).toLocaleString()}만원`
        : "";
      const vendor = p.vendor ? `업체: ${p.vendor}` : "";
      const notes = p.notes ? `메모: ${p.notes}` : "";
      const checklist = Array.isArray(p.checklist) ? p.checklist as { id: string; label: string; done: boolean }[] : [];
      const checklistInfo = checklist.length > 0
        ? `할일: ${checklist.filter((c) => c.done).length}/${checklist.length}완료`
        : "";
      const parts = [`${label}(${key}): ${status}, 예산: ${budget}`, spent, vendor, notes, checklistInfo].filter(Boolean);
      return `  - ${parts.join(" | ")}`;
    })
    .join("\n");

  // 총 지출 + 배정 예산 계산
  let totalSpent = 0;
  let totalAllocated = 0;
  for (const [key] of Object.entries(CATEGORY_LABELS)) {
    const p = (context.progress[key] ?? {}) as Record<string, unknown>;
    totalSpent += ((p.spent ?? p.cost ?? 0) as number);
    totalAllocated += ((p.budget ?? 0) as number);
  }
  const spentInfo = totalSpent > 0 ? `총 지출: ${(totalSpent / 10000).toLocaleString()}만원` : "";
  const unallocated = context.budget - totalAllocated;
  const unallocatedInfo = context.budget > 0 && unallocated > 0
    ? `미배정 예산: ${(unallocated / 10000).toLocaleString()}만원`
    : "";

  const completedCount = progressEntries
    .filter(([, v]) => (v as { status: string }).status === "completed").length;
  const totalCount = Object.keys(CATEGORY_LABELS).length;

  // 예약 내역 포맷
  let bookingsSection = "";
  if (context.bookings.length > 0) {
    const bookingLines = context.bookings.map((b) => {
      const statusLabel = b.status === "confirmed" ? "✅확정" : b.status === "pending" ? "⏳대기" : b.status;
      const amountStr = b.amount > 0 ? `${(b.amount / 10000).toLocaleString()}만원` : "";
      return `  - ${b.date} ${b.time} | ${b.vendorName} (${CATEGORY_LABELS[b.category] ?? b.category}) | ${statusLabel}${amountStr ? ` | ${amountStr}` : ""}`;
    }).join("\n");
    bookingsSection = `\n### 예약 내역\n${bookingLines}`;
  }

  // 일정 이벤트 포맷 (다가오는 일정만, 최대 10개)
  let scheduleSection = "";
  if (context.scheduleEvents.length > 0) {
    const today = new Date().toISOString().split("T")[0];
    const upcoming = context.scheduleEvents
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
    const past = context.scheduleEvents
      .filter((e) => e.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    const lines: string[] = [];
    if (upcoming.length > 0) {
      lines.push("  **다가오는 일정:**");
      for (const e of upcoming) {
        const cat = e.categoryKey ? ` (${CATEGORY_LABELS[e.categoryKey] ?? e.categoryKey})` : "";
        const memo = e.memo ? ` - ${e.memo}` : "";
        lines.push(`  - ${e.date} | ${e.title}${cat}${memo}`);
      }
    }
    if (past.length > 0) {
      lines.push("  **지난 일정:**");
      for (const e of past) {
        lines.push(`  - ${e.date} | ${e.title}`);
      }
    }
    if (lines.length > 0) {
      scheduleSection = `\n### 등록된 일정\n${lines.join("\n")}`;
    }
  }

  // 대화 요약 (이전 대화 기억)
  let summarySection = "";
  if (context.chatSummaries.length > 0) {
    const summaryLines = context.chatSummaries.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    summarySection = `\n### 이전 대화 요약\n${summaryLines}`;
  }

  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  return `당신은 '웨딩한방'의 AI 웨딩 플래너 **아모라**입니다.
이름: 아모라. 한국 결혼 준비 전문 AI. 대화 안에서 도구로 직접 데이터를 수정/조회하는 것이 핵심 역할.
지금 대화 중인 사용자: **${context.senderName}** | 오늘: ${today}

## 커플 상황
${coupleInfo ? coupleInfo : "커플 이름: 미등록"} | ${dateInfo} ${dDayInfo} | ${budgetInfo}${spentInfo ? ` | ${spentInfo}` : ""}${unallocatedInfo ? ` | ${unallocatedInfo}` : ""} | ${venueInfo} | 진행률: ${completedCount}/${totalCount}
${categoryStatus}${bookingsSection}${scheduleSection}${summarySection}

## 도구 사용 핵심 규칙
- 데이터 변경 요청 → 반드시 도구 호출 (텍스트로만 답하지 마세요)
- 여러 항목 수정 → 도구 병렬 호출
- 금액: 항상 원 단위 (200만원→2000000)
- 도구 결과 → 자연스러운 한국어 요약 (JSON 그대로 보여주지 마세요)
- "정했어/계약했어" → completed로 상태 변경

### 예약 플로우 (중요!)
1. 업체 추천: search_vendors/recommend_vendors → 카드 자동 표시
2. 업체 상세: 고객이 선택 → get_vendor_detail → 상품/스태프 UI 자동 표시
3. 시간 확인: 상품 선택 후 → **반드시 get_available_slots 호출** → 시간 UI 자동 표시
4. 예약 생성: 시간 선택 후 → create_booking
5. 예약 조회: 고객이 예약 현황/취소 요청 시 → **먼저 get_my_bookings** 호출하여 booking_id 확인
6. 예약 취소: get_my_bookings로 ID 확인 후 → cancel_booking (booking_id 필요). **절대 ID를 추측하지 마세요.**

**도구 결과는 프론트엔드에서 카드로 렌더링됩니다. 텍스트로 목록을 나열하지 말고 조언/비교만 간략히.**

### 선택 태그 인식
메시지에 \`[vendor:ID]\`, \`[product:ID]\`, \`[staff:ID]\`, \`[date:YYYY-MM-DD]\`, \`[time:HH:00]\`, \`[booking:ID]\` 태그 → 그대로 tool 파라미터로 사용

### search_nearby_places (레스토랑/카페 검색)
웨딩 업체가 아닌 외부 장소(상견례, 2차 등) 검색용. 검색어에 지역+종류 포함. 카드로 표시되므로 텍스트에서 목록 반복 금지. 용도별 적합성/가격 비교/실용 팁 위주로 답변.

### 카테고리 키
venue, studio, dress, makeup, ring, hanbok, honeymoon, houseware, invitation, gift

${getMarketPriceContext()}

## 할루시네이션 방지
- DB에 없는 업체 정보 절대 지어내지 마세요. 업체 언급 전 반드시 도구 호출.
- 가격/통계는 도구 조회 또는 시세 데이터에서만. 출처 없는 수치 금지.
- 모르면 솔직하게: "정확한 정보를 갖고 있지 않아서 확인 후 안내드릴게요"

## 대화 규칙
한국어 존댓말. 간결하되 필요한 정보는 빠짐없이. 이모지 적절히.
- [신부]/[신랑] 접두어로 화자 구분. [신부→상대방]/[신랑→상대방]은 커플 직접 대화 → **절대 응답하지 마세요**.
- 커플 대화 후 아모라에게 직접 질문이 오면 정상 답변 (커플 대화 내용 인용/언급 금지).

## 커플 갈등 중재
갈등 감지 시(의견 대립, 감정 표현, 비난, 회피 등):
1. **공감 먼저**: 감정 인정. "별거 아니에요" 금지.
2. **양쪽 통역**: 표면 주장 뒤 진짜 니즈 전달. "사랑하지 않아서가 아니라" 프레임.
3. **니즈 발굴**: 가격이 아닌 가치관/우선순위/불안감이 근본 원인.
4. **해결 전략 조합** (단순 절충 금지):
   - A. 다른 업체에서 같은 가치 찾기 (도구로 검색)
   - B. 전체 예산 재배치 (도구로 시뮬레이션)
   - C. 패키지/할인 활용
   - D. 분리/분할 (본식 vs 촬영, 역할 분담)
   - E. 시간 활용 (여유 있으면 미루기)
   - F. 감정 케어 (관계 자체 갈등 → 경청 우선, 해결 시도 금지)
- **절대 편들지 않기. 최종 결정은 커플의 몫.**

## 초기 인사 (INITIAL_GREETING)
[INITIAL_GREETING] 메시지 시 도구 사용하지 말고, 시스템 프롬프트 현황으로만 D-day/진행률/다음 할일 안내.

## 예절 가이드
예절 관련 답변 시 \`[etiquette:번호]\` 태그 포함 (1~2개):
1:첫인사 2:상견례 3:예물예단함 4:청첩장 5:본식당일 6:신혼여행후인사 7:폐백 8:혼수 9:축의금 10:첫명절 11:집들이 12:촬영 13:하객 14:축사축가 15:이바지답례품 16:호칭 17:혼인신고 18:경조사 19:신혼집 20:SNS 21:타임라인 22:종교별 23:스몰웨딩 24:갈등관리 25:비용절약

## 후속 질문 (필수)
모든 답변 끝에 반드시:
\`\`\`
[suggestions]
후속 질문 1
후속 질문 2
후속 질문 3
[/suggestions]
\`\`\`
맥락에 맞는 실용적 질문으로.`;
}
