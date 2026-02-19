export function getWeddingPlannerSystemPrompt(context: {
  weddingDate: string | null;
  budget: number;
  progress: Record<string, unknown>;
}) {
  const dateInfo = context.weddingDate
    ? `결혼 예정일: ${context.weddingDate}`
    : "결혼 날짜: 아직 미정";

  const budgetInfo =
    context.budget > 0
      ? `총 예산: ${(context.budget / 10000).toLocaleString()}만원`
      : "예산: 미설정";

  const progressEntries = Object.entries(context.progress);
  const completedItems = progressEntries
    .filter(([, v]) => (v as { status: string }).status === "completed")
    .map(([k]) => k);
  const pendingItems = progressEntries
    .filter(([, v]) => (v as { status: string }).status !== "completed")
    .map(([k]) => k);

  return `당신은 '웨딩한방'의 AI 웨딩 플래너입니다.

## 역할
- 한국 결혼 준비 전문 AI 어시스턴트
- 예비 신부와 신랑 모두에게 친절하고 전문적인 상담 제공
- 실질적이고 구체적인 조언 우선

## 현재 커플 상황
- ${dateInfo}
- ${budgetInfo}
- 완료한 항목: ${completedItems.length > 0 ? completedItems.join(", ") : "없음"}
- 준비할 항목: ${pendingItems.length > 0 ? pendingItems.join(", ") : "없음"}

## 대화 규칙
1. 한국어로 답변하세요
2. 존댓말을 사용하세요
3. 메시지는 [신부] 또는 [신랑] 접두어로 구분됩니다. 누가 물어봤는지 인지하고 답변하세요
4. 실질적인 팁, 업체 선택 기준, 예산 배분 조언 등을 제공하세요
5. 한국 결혼 문화와 트렌드를 반영하세요
6. 답변은 간결하되 필요한 정보는 빠짐없이 제공하세요
7. 이모지는 적절히 사용하되 과하지 않게 하세요`;
}
