import { redirect } from "next/navigation";

/**
 * 정품 `/login` 으로 보낸다.
 *
 * ## 여기 있던 것
 *
 * `/login` 의 복제본(481줄)이었다. 두 화면이 갈라져 있었고 복제본 쪽이 나빴다:
 *
 * 1. **`INTERNAL DEV` 배지가 조건 없이 렌더됐다.** `/price` 와 공시가 상세에서
 *    "아모라가 무엇을 하고 무엇을 하지 않는지 먼저 보기" → `/demo` → 상단
 *    "로그인" 두 번이면 닿는 공개 자리다. 처음 온 사람이 그 화면에서 비밀번호를 넣는다.
 * 2. **"로그인 없이 체험하기" 입구가 없었다.** 정품 `/login` 에는 있다
 *    (`handleDemo` → `/api/demo/start`). 즉 **데모를 보러 온 사람을 데모를
 *    못 쓰는 화면으로** 보내고 있었다.
 *
 * 실측(2026-08-27 운영):
 *
 *     /login       "또는 로그인 없이 체험하기 · 체험 대화와 변경은 계정 기록에 남지 않아요"
 *     /demo/login  "INTERNAL DEV" — 체험 입구 0개
 *
 * ## 왜 지우지 않고 리다이렉트인가
 *
 * `api/auth/callback/route.ts` 가 `from=demo` 인 소셜 로그인 실패를 이 주소로
 * 돌려보낸다. 404 로 만들면 그 오류 문구가 사용자에게 영영 안 보인다.
 * 그래서 **쿼리를 그대로 달고** 넘긴다 — `/login` 도 같은 `?error=` 를 읽는다
 * (login/page.tsx:125). 해시 조각은 브라우저가 리다이렉트에서 알아서 옮긴다.
 *
 * 데모 자체는 그대로다. `/demo`(설명)와 `StartDemoButton`(실제 체험)은 손대지 않았다.
 */
export default async function DemoLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value.length > 0) query.set(key, value[0]);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(`/login${suffix}`);
}
