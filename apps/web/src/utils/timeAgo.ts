import { ymdInKst } from "@/lib/utils/kstDate";

/**
 * 상대 시간 포맷팅 유틸리티.
 *
 * ## 이 함수가 운영에서 React #418 을 내고 있었다 (2026-08-27)
 *
 * Sentry 에 `Minified React error #418` 이 계속 쌓이고 있었다. React 문서의 원문은
 * "Hydration failed because the server rendered X didn't match the client" 이고,
 * 문서가 드는 원인 중 둘이 이 함수에 그대로 있었다:
 *
 *   - `Date.now()` 처럼 부를 때마다 달라지는 값
 *   - 사용자 로케일 날짜 포맷이 서버와 다름
 *
 * 이 함수는 `"use client"` 컴포넌트(`CommunityLandingClient`·`PostCard` 등)에서
 * 불리는데, App Router 는 그것도 **먼저 서버에서 그린 뒤 브라우저에서 다시 그린다.**
 * 두 번의 계산 사이에 값이 달라지면 하이드레이션이 깨진다.
 *
 * ## 두 가지가 겹쳐 있었다
 *
 * **1. 시간대 (확정적)** — 예전에는 `date.getFullYear()/getMonth()/getDate()` 로
 * 절대 날짜를 만들었다. 그건 **실행 환경의 시간대**를 따른다. 서버(Vercel)는 UTC,
 * 브라우저는 KST 다. 그래서 UTC 15시 이후(= KST 자정 이후)에 쓴 글은
 *
 *     서버      2026.07.12
 *     브라우저   2026.07.13
 *
 * 로 갈렸다. 2026-08-27 운영 실측: 공개 글 17건 중 1건이 이 경우였다. 하이드레이션은
 * 트리 전체를 대조하므로 **한 건이면 충분하다.**
 *
 * 그리고 이건 하이드레이션 문제이기 전에 **그냥 틀린 값**이다 — 한국 새벽 0~9시에
 * 쓴 글이 사용자에게 하루 전 날짜로 보였다. 그래서 `ymdInKst` 로 못박는다.
 *
 * **2. 경계 (경쟁적)** — `59분 전` → `1시간 전`, `29일 전` → 절대 날짜처럼 두 계산
 * 사이에 경계를 넘으면 값이 달라진다. 프리렌더된 HTML 이 캐시돼 있으면 그 간격이
 * 몇 시간이 되므로 사실상 확정이다. 이건 함수만으로는 못 없앤다 — 부르는 쪽이
 * `suppressHydrationWarning` 을 달아 "이 자리는 달라도 된다" 고 알려 준다
 * (시간 표시에 대한 React 의 공식 처방이다).
 */

/** 하루를 밀리초로. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ## 읽을 수 없는 값에 던지지 않는다 (2026-09-02)
 *
 * 이 함수는 커뮤니티 client component 여섯 곳에서 그려지고, 그 컴포넌트들은
 * 하이드레이션 뒤 **브라우저에서 다시** 그려진다. 그래서 여기서 던지면 API 가 200 을
 * 줬는데도 루트 경계가 「화면을 불러오지 못했어요」로 바뀐다. 글 하나, 댓글 하나의
 * 시각이 이상하면 목록 전체가 사라진다.
 *
 * 실측한 두 갈래:
 *
 *     timeAgo("not-a-date")  → RangeError: Invalid time value   (아래 Intl 포맷터)
 *     timeAgo(null)          → "1970.01.01"                      (null → 0 으로 강제됨)
 *
 * 앞은 화면을 내리고, 뒤는 **없는 사실을 적는다.** 둘 다 틀렸다. 모르는 시각은
 * 비워 둔다 — 부르는 쪽은 전부 `<span>` 안이라 빈 문자열이면 그 자리만 사라진다.
 *
 * `created_at`·`updated_at` 은 스키마에서 nullable 이고(`20260325000000_community.sql`),
 * 클라이언트가 만든 낙관적 객체에는 아예 없을 수도 있다.
 */
export function timeAgo(dateString: string, now: Date = new Date()): string {
  if (typeof dateString !== "string" || dateString.trim() === "") return "";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffMs / DAY_MS);

  if (diffSeconds < 60) {
    return "방금 전";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }
  if (diffDays < 30) {
    return `${diffDays}일 전`;
  }

  // 30일 이상이면 날짜 표시.
  //
  // **`getFullYear()` 를 쓰면 안 된다.** 실행 환경의 시간대를 따라가므로 서버(UTC)와
  // 브라우저(KST)가 같은 글을 다른 날짜로 그린다. 사용자는 한국에 있으므로 KST 로
  // 못박는다 — 하이드레이션도 맞고 값도 맞다.
  return ymdInKst(date).replace(/-/g, ".");
}
