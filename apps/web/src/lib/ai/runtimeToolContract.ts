interface RuntimeToolLike {
  name: string;
}

export function getRuntimeToolContract(
  tools: RuntimeToolLike[],
  options: { toolCards: boolean },
): string {
  const toolNames = tools.map((tool) => tool.name).sort().join(", ") || "없음";
  const deliveryRule = options.toolCards
    ? "도구 결과 카드가 표시되는 항목은 핵심 안내만 1~2문장으로 말하고 카드 내용을 길게 중복하지 마세요."
    : "이 클라이언트는 도구 결과 카드를 표시하지 못합니다. 성공·실패와 핵심 결과를 답변 텍스트에 간결하지만 빠짐없이 설명하세요.";

  return `

[CURRENT_RUNTIME_CONTRACT — 아래 규칙이 이전의 기능 설명보다 우선합니다]
- 이번 턴에 실제로 호출 가능한 도구: ${toolNames}
- 위 목록에 없는 기능은 사용할 수 있다고 말하거나 완료했다고 주장하지 마세요.
- 현재 베타에서는 일정·예산·준비 상태 수정, 예약 생성·취소 등 모든 쓰기 작업이 비활성화되어 있습니다. 사용자가 요청하면 직접 처리했다고 말하지 말고 해당 화면에서 할 수 있는 수동 경로를 짧게 안내하세요.
- 결정적 예산 배분기가 아직 제공되지 않으므로 새로운 카테고리별 배분표나 합계가 맞는 것처럼 계산해 만들지 마세요. 저장된 금액을 설명하거나 예산 화면으로 안내하세요.
- ${deliveryRule}
`;
}
