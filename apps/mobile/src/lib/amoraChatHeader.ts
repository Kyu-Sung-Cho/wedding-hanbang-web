/**
 * 아모라 탭 머리 — 공유 할 일 입구와 좁은 화면 배치 (2026-09-18).
 *
 * 웹은 아모라 화면 머리의 탐색 줄(`AmoraWorkspaceNav`)에 「결정 보드」 입구를 둔다. 앱 아모라 탭 머리에는
 * 그 목록(`/amora-preparation`)으로 가는 길이 없었다. 범위 줄(role=tab 두 개)은 그대로 두고, 머리 오른쪽의
 * 메시지 수 옆에 조용한 버튼 하나를 둔다. 화면 이동만 한다 — 목록을 부르거나 바꾸지 않는다.
 *
 * 320pt 화면에서 머리에는 아모라 얼굴·두 줄 제목·메시지 수·공유 할 일·대화 화면 정리가 함께 놓인다. 여기의
 * 숫자가 `chat.tsx` 머리 스타일의 정본이고, 같은 숫자로 폭을 어림해 넘치면 공유 할 일의 글자를 빼고 아이콘만
 * 둔다(읽어 주는 이름은 그대로다). 어림은 한글 한 자를 글자 크기만큼, 숫자는 0.62배로 넉넉하게 잡는다 —
 * 실제 글꼴보다 좁게 어림하면 겹침을 못 본다. 실기기 스크린샷은 이 어림을 대신하지 않는다.
 */

export const AMORA_BOARD_ENTRY = {
  label: "공유 할 일",
  accessibilityLabel: "공유 할 일 보기",
  pathname: "/amora-preparation",
} as const;

export const AMORA_CHAT_HEADER_LAYOUT = {
  paddingX: 16,
  paddingY: 10,
  avatar: 36,
  avatarGap: 10,
  titleFontSize: 17,
  subFontSize: 11,
  /** 왼쪽 묶음과 오른쪽 버튼 묶음 사이 최소 간격. */
  sideGap: 8,
  actionGap: 4,
  /** 누르는 자리의 최소 크기(pt). */
  button: 44,
  boardPaddingX: 10,
  boardIcon: 16,
  boardIconGap: 4,
  boardFontSize: 13,
  pillPaddingX: 8,
  pillFontSize: 12,
} as const;

const HEADER_TITLE = "아모라";
const HEADER_SUBTITLE = "AI 웨딩 비서";
/** 메시지 수는 최근 200개 안팎이라 세 자리가 가장 넓다. */
const WIDEST_MESSAGE_COUNT = 999;

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

export function estimateAmoraChatHeaderWidth({
  showBoardLabel,
  showClear,
  messageCount,
  fontScale = 1,
}: {
  showBoardLabel: boolean;
  showClear: boolean;
  messageCount: number;
  fontScale?: number;
}): number {
  const layout = AMORA_CHAT_HEADER_LAYOUT;
  const left = layout.avatar + layout.avatarGap + Math.max(
    estimateTextWidth(HEADER_TITLE, layout.titleFontSize, fontScale),
    estimateTextWidth(HEADER_SUBTITLE, layout.subFontSize, fontScale),
  );
  const actions: number[] = [];
  if (messageCount > 0) {
    actions.push(layout.pillPaddingX * 2 + estimateTextWidth(String(messageCount), layout.pillFontSize, fontScale));
  }
  actions.push(showBoardLabel
    ? Math.max(
      layout.button,
      layout.boardPaddingX * 2 + layout.boardIcon + layout.boardIconGap
        + estimateTextWidth(AMORA_BOARD_ENTRY.label, layout.boardFontSize, fontScale),
    )
    : layout.button);
  if (showClear) actions.push(layout.button);
  const right = actions.reduce((sum, width) => sum + width, 0) + layout.actionGap * (actions.length - 1);
  return layout.paddingX * 2 + left + layout.sideGap + right;
}

/**
 * 「공유 할 일」 글자를 보일 만큼 넓은가. 가장 넓은 경우(세 자리 메시지 수 + 대화 화면 정리 버튼)로 정한다 —
 * 메시지가 하나 늘 때마다 글자가 사라졌다 나타나지 않게 한다.
 */
export function shouldShowAmoraBoardLabel(windowWidth: number, fontScale = 1): boolean {
  return estimateAmoraChatHeaderWidth({
    showBoardLabel: true,
    showClear: true,
    messageCount: WIDEST_MESSAGE_COUNT,
    fontScale,
  }) <= windowWidth;
}
