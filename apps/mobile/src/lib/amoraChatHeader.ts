/**
 * 아모라 탭 머리 — 공유 할 일 입구와 좁은 화면 배치 (2026-09-18, 모양은 2026-11-17).
 *
 * 웹은 아모라 화면 머리의 탐색 줄(`AmoraWorkspaceNav`)에 「결정 보드」 입구를 둔다. 앱 아모라 탭 머리에는
 * 그 목록(`/amora-preparation`)으로 가는 길이 없었다. 범위 줄(role=tab 두 개)은 그대로 두고, 머리 오른쪽에
 * 조용한 버튼 하나를 둔다. 화면 이동만 한다 — 목록을 부르거나 바꾸지 않는다.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 머리는 가운데 아모라 오브 64px 와
 * "듣고 있어요"다(`Chat.dc`). 공유 할 일·대화 화면 정리 버튼은 오브 오른쪽에 떠 있다. 여기의 숫자가 `chat.tsx`
 * 머리 스타일의 정본이고, 같은 숫자로 폭을 어림해 오브와 겹칠 폭이면 공유 할 일의 글자를 빼고 아이콘만 둔다
 * (읽어 주는 이름은 그대로다). 어림은 한글 한 자를 글자 크기만큼, 숫자는 0.62배로 넉넉하게 잡는다 — 실제
 * 글꼴보다 좁게 어림하면 겹침을 못 본다. 실기기 스크린샷은 이 어림을 대신하지 않는다.
 */

export const AMORA_BOARD_ENTRY = {
  label: "공유 할 일",
  accessibilityLabel: "공유 할 일 보기",
  pathname: "/amora-preparation",
} as const;

export const AMORA_CHAT_HEADER_LAYOUT = {
  paddingX: 16,
  /** `Chat.dc` 머리: 위 16, 아래 8. */
  paddingTop: 16,
  paddingBottom: 8,
  /** 가운데 오브. */
  orb: 64,
  /** 버튼 묶음의 위쪽. 44pt 버튼을 오브 가운데에 맞춘다: 16 + (64 - 44) / 2. */
  actionsTop: 26,
  /** 오브와 오른쪽 버튼 묶음 사이 최소 간격. */
  sideGap: 8,
  actionGap: 4,
  /** 누르는 자리의 최소 크기(pt). */
  button: 44,
  boardPaddingX: 10,
  boardIcon: 16,
  boardIconGap: 4,
  boardFontSize: 13,
} as const;

/** 넉넉한 폭 어림: 한글·기타 1em, 숫자·라틴 0.62em, 공백 0.35em. */
export function estimateTextWidth(text: string, fontSize: number, fontScale = 1): number {
  let ems = 0;
  for (const character of text) {
    if (character === " ") ems += 0.35;
    else if (/[0-9A-Za-z]/.test(character)) ems += 0.62;
    else ems += 1;
  }
  return ems * fontSize * fontScale;
}

/** 오른쪽 버튼 묶음(공유 할 일 + 대화 화면 정리)의 폭. */
export function estimateAmoraChatHeaderActionsWidth({
  showBoardLabel,
  showClear,
  fontScale = 1,
}: {
  showBoardLabel: boolean;
  showClear: boolean;
  fontScale?: number;
}): number {
  const layout = AMORA_CHAT_HEADER_LAYOUT;
  const actions: number[] = [showBoardLabel
    ? Math.max(
      layout.button,
      layout.boardPaddingX * 2 + layout.boardIcon + layout.boardIconGap
        + estimateTextWidth(AMORA_BOARD_ENTRY.label, layout.boardFontSize, fontScale),
    )
    : layout.button];
  if (showClear) actions.push(layout.button);
  return actions.reduce((sum, width) => sum + width, 0) + layout.actionGap * (actions.length - 1);
}

/** 버튼 묶음이 쓸 수 있는 폭. 가운데 오브의 오른쪽 절반에서 바깥 여백과 간격을 뺀 것이다. */
export function amoraChatHeaderActionsRoom(windowWidth: number): number {
  const layout = AMORA_CHAT_HEADER_LAYOUT;
  return (windowWidth - layout.orb) / 2 - layout.paddingX - layout.sideGap;
}

/**
 * 「공유 할 일」 글자를 보일 만큼 넓은가. 가장 넓은 경우(대화 화면 정리 버튼까지 있을 때)로 정한다 —
 * 정리 버튼이 나타났다 사라질 때마다 글자가 사라졌다 나타나지 않게 한다.
 */
export function shouldShowAmoraBoardLabel(windowWidth: number, fontScale = 1): boolean {
  return estimateAmoraChatHeaderActionsWidth({ showBoardLabel: true, showClear: true, fontScale })
    <= amoraChatHeaderActionsRoom(windowWidth);
}
