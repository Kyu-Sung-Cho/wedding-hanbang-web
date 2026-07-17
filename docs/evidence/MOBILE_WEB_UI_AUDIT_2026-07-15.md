# 모바일 웹 UI 감사 및 아모라 버튼 충돌 수정 증적

> **SUPERSEDED HISTORICAL RECEIPT — 현재 Engine V2 실기기 증거가 아님.** 아래
> 브라우저 viewport·Expo export 결과는 당시 UI 수정만 검증한다. 최종 Engine V2
> commit의 signed Android/iOS EAS build와 실제 기기 VoiceOver/TalkBack 검증은
> `NOT RUN`이다.

- 감사일: 2026-07-15 (KST)
- 기준 브랜치: `fix/mobile-amora-overlap-20260715`
- 기준 `main`: `2f3c8fe66a268cc19346fb28a6930e46e6b03c56`
- 대상: 웹 모바일 390×844, 360×800

## 결론

`/wedding` 하단 오른쪽에서 글쓰기 FAB과 아모라 FAB가 1,600 px² 겹치던 문제를 재현했다. 수정 후 두 해상도 모두 겹침 면적은 0 px², 수직 간격은 16px이다.

추가로 모바일 주제 카드 압축, 40px 이하 터치 타겟, 게시글 링크 안의 버튼 중첩을 수정했다. 주요 13개 경로를 익명/데모 사용자 상태에서 재검증한 결과 가로 넘침, 실제 고정 요소 충돌, 콘솔 오류는 모두 0건이었다.

## 재현 증거

| viewport | 글쓰기 FAB | 아모라 FAB | 수정 전 겹침 | 수정 후 겹침 | 수정 후 간격 |
| --- | --- | --- | ---: | ---: | ---: |
| 390×844 | 56×56 | 48×48 | 1,600 px² | 0 px² | 16px |
| 360×800 | 56×56 | 48×48 | 1,600 px² | 0 px² | 16px |

수정 후 두 FAB의 오른쪽 끝을 같은 축에 맞추고, 글쓰기를 주 액션, 아모라를 아이보리 배경의 보조 액션으로 구분했다.

## 원인과 수정

1. 모바일 글쓰기와 아모라가 같은 하단 영역과 `z-40`을 사용했다.
   - 글쓰기를 safe-area 기준 상단으로 올리고 아모라와 16px 간격을 확보했다.
2. 전역 `.flex > *, .grid > * { min-width: 0; }`가 Tailwind 유틸리티 레이어를 덮어써 `min-w-[96px]`가 무효화됐다.
   - 안전 규칙을 `@layer base`로 옮겨 명시적 유틸리티가 우선하게 했다.
   - 주제 카드는 두 viewport 모두 96×64px로 복구됐고 페이지 자체의 가로 넘침은 없다.
3. 전역 주석은 44×44px을 요구했지만 실제 CSS는 높이 40px만 보장했다.
   - 모바일 `button`/button role에 최소 44×44px을 보장했다.
   - 명시적 `.no-min-tap` 예외는 유지했다.
4. 최신 글 행이 `<a>` 안에 `button`을 넣어 클릭·키보드 경계가 중첩됐다.
   - 전체 행 링크를 독립 오버레이 링크로 분리했다.
   - `a button` 개수는 0, 좋아요 클릭 후 URL은 유지, 게시글 링크는 상세 경로로 이동함을 확인했다.

## 검증 경로

- 공개: `/wedding`, `/wedding/market-prices`, `/login`, `/sai`, `/wedding-code`
- 데모 인증: `/wedding/lounge`, `/wedding/chat`, `/wedding/budget`, `/wedding/schedule`, `/wedding/vendors`, `/wedding/bookings`, `/wedding/etiquette`, `/wedding/settings`
- 각 경로를 390px, 360px에서 검증했다.
- 모든 경로: HTTP 200, 문서 `scrollWidth === clientWidth`, 콘솔/페이지 오류 0, 실제 fixed 충돌 0.

## 자동 게이트

- `git diff --check`: PASS
- web ESLint: PASS
- web TypeScript: PASS
- web Vitest: 86 files, 580 tests PASS
- Next.js production build: PASS, 100 static pages generated
- mobile release readiness: 70 PASS, 0 warnings, 0 failures
- mobile tests: 7 PASS
- mobile TypeScript/ESLint: PASS
- Expo export: Web/iOS/Android PASS
- shared/design-token TypeScript: PASS
- `pnpm qa:local`: PASS

## 비차단 주의 사항

- 전체 ESLint에서 `apps/web/src/app/api/auth/delete/__tests__/route.test.ts` 미사용 `_payload` 경고 1건이 남아 있다. 오류가 아니며 이 변경과 무관하다.
- 실제 iOS EAS 상용 빌드/제출은 Apple 계정 인증이 필요한 별도 운영 게이트다. 이 문서의 Expo export PASS와 구분해야 한다.
