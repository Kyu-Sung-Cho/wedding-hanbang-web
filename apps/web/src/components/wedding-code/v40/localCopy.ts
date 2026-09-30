/**
 * 입력 컴포넌트가 쓰는 문구 중 lib/weddingCode/v40/copy.ts 에 아직 없는 것. 리드가 copy.ts 로 옮길 수 있게 이 파일에 모아 둔다.
 * 문항 자체의 글(캡션, 앞말, 카드, 보기, 끝 이름)은 뷰에서 오므로 여기에 없다.
 */
export const V40_INPUT_LOCAL_COPY = {
  /** 두 가지 중 고르기와 자기 선택의 카드 이름. 화면 낭독기에만 읽힌다(보이는 글자에는 위아래 말도 쓰지 않는다). */
  pairCardNames: ["위 카드", "아래 카드"],
  /** 이럴 때 내 마음의 인용 블록에서 말한 사람 앞에 붙는 낭독용 말. */
  quoteSpeakerLabel: "말한 사람",
  /**
   * 가장·가장 아닌 것에서 다른 그룹에서 이미 고른 카드에 붙는 작은 표시(눈에 보이는 글). label 은 그 다른 그룹의 이름(뷰의 bestLabel 또는 worstLabel).
   * 「~에서」는 받침과 상관없이 쓰는 조사라 그룹 이름이 바뀌어도 어색하지 않다.
   */
  bestWorstTakenChip: (label: string) => `「${label}」에서 골랐어요`,
  /** 위 표시가 붙은 카드의 낭독 설명. 여기서 고르면 앞의 선택이 지워진다는 것을 고르기 전에 알린다. */
  bestWorstTakenHelp: (label: string) => `「${label}」에서 이미 골랐어요. 여기서 고르면 그쪽 선택은 지워져요.`,
} as const;
