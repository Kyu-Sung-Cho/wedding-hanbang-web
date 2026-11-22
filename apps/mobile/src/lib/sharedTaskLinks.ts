import { checklistCategoryFromSearch, checklistRoute } from "@/lib/checklistCategoryParam";

/**
 * 공유 할 일 카드의 "연결된 화면 보기" 가 앱 안 어디로 갈 수 있는가.
 *
 * 카드의 `href` 는 웹 경로로 저장돼 있다(아모라 도구·중재 흐름·레거시 기록). 앱은 그 주소를
 * 그대로 열지 않고 **아는 화면만** 네이티브로 옮긴다. 나머지는 링크를 그리지 않는다.
 *
 * - `/budget` · `/schedule` → 같은 앱 화면
 * - `/checklist[?category=…]` → 체크리스트(21개 분야 키만 분야 시트로, 나머지는 목록)
 * - `/chat` → 기존 채팅 탭으로 돌아간다(`dismissTo`). 준비 기록은 루트 스택 화면이라 push 는
 *   (tabs)를 한 벌 더 쌓는다(rootStackChatNavigation.test.mjs).
 * - `/quote-check` · 옛 `/community/quote-check` → 앱의 견적 확인. 웹은 2026-11-22 견적 확인을 커뮤니티 밖
 *   (`/wedding/quote-check`)으로 옮겼고, 그 전에 저장된 카드에는 옛 주소가 남아 있다.
 *
 * 앞의 `/wedding` 한 번은 걷어 낸다(웹 경로 접두사). 링크를 주지 않는 것:
 * - `/chat/personal` — 공유 카드에서 나만 상담으로 넘어가면 공개 범위가 섞인다.
 * - `/actions` — 이 보드 자신이다. `/lounge` · `/vendors` · `/bookings` · 모르는 경로.
 * - `//…`, 절대 URL, 공백·제어문자·역슬래시가 든 값.
 */
export type SharedTaskLink = { kind: "push"; route: string } | { kind: "chat" };

/** 역슬래시(92)·공백과 제어문자(0–32)·DEL(127)이 든 값은 경로로 읽지 않는다. */
const hasUnsafeCharacter = (value: string) => Array.from(value).some((char) => {
  const code = char.charCodeAt(0);
  return code === 92 || code <= 32 || code === 127;
});

export function sharedTaskLinkTarget(href: unknown): SharedTaskLink | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || hasUnsafeCharacter(href)) return null;
  const withoutHash = href.split("#", 1)[0] ?? "";
  const queryAt = withoutHash.indexOf("?");
  const rawPath = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  const search = queryAt >= 0 ? withoutHash.slice(queryAt) : "";
  const path = rawPath.startsWith("/wedding/") ? rawPath.slice("/wedding".length) : rawPath;
  switch (path) {
    case "/budget":
    case "/schedule":
      return { kind: "push", route: path };
    case "/checklist":
      return { kind: "push", route: checklistRoute(checklistCategoryFromSearch(search)) };
    case "/chat":
      return { kind: "chat" };
    case "/quote-check":
    case "/community/quote-check":
      return { kind: "push", route: "/quote-check" };
    default:
      return null;
  }
}
