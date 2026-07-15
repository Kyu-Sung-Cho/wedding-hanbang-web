# 2026-07-15 Amora 동기화 수정 · WeddingCode 재감사 인수인계

## 결론

- Amora의 OpenAI GPT-5.6 도구 호출과 운영 DB 저장은 정상 동작했다.
- 사용자가 본 문제는 DB 저장 뒤 웹 상태 동기화가 누락된 클라이언트 결함이었다.
- WeddingCode는 아직 검증된 성향 검사가 아니다. Production 차단과 DB write fence를 유지한다.

## Amora 장애 원인

2026-07-15 운영 `ai_interactions_log`의 최신 GPT-5.6 Luna 대화는 성공했고
`log_wedding_event`를 2회 tool round 안에 호출했다. 같은 시각 `wedding_journeys`에도 이벤트가
저장됐다. 모델 전환이나 OpenAI 도구 호출 실패가 원인이 아니었다.

`apps/web/src/stores/chatStore.ts`가 변경 도구 이름을 별도로 복제 관리하면서
`log_wedding_event`를 빠뜨렸다. 서버는 DB에 저장했지만 클라이언트는 다음 두 작업을 하지 않았다.

1. 반환된 이벤트를 현재 `journey.progress.__events`에 즉시 합치기
2. `/api/auth/me`에서 authoritative journey를 다시 불러오기

그래서 사용자는 Amora가 일정을 저장했다고 답한 직후 일정·예산·라운지 화면에서 변경을 보지
못했다.

## 적용한 수정

- 변경 도구 목록을 `apps/web/src/lib/ai/mutationTools.ts` 한 곳으로 통합했다.
- 서버의 중복 실행 방지 ledger와 클라이언트의 화면 동기화가 같은 목록을 사용한다.
- `log_wedding_event` 결과를 일정 이벤트와 동일하게 로컬 상태에 즉시 반영한다.
- 변경 도구가 성공한 대화는 `refreshJourney()` 완료까지 기다린다.
- 일정 moment와 총예산 변경을 각각 재현하는 회귀 테스트를 추가했다.

## 검증 근거

- 수정 전 회귀 테스트: `/api/auth/me` 재조회가 없어 실패
- 수정 후 대상 테스트: 일정 moment 로컬 반영, refresh 대기, 예산 authoritative refresh 통과
- 전체 웹 테스트 589/589, 타입 검사, lint(오류 0), production build가 통과했다.
- 모바일 release readiness 70/70, 테스트 7/7, 타입·lint, iOS/Android/Web Expo export가 통과했다.
- 환경변수를 Git에 복사하지 않고 프로세스에만 주입한 로컬 production 서버에서 live smoke 5/5가
  통과했다. 비로그인 redirect, demo lounge, 390px Amora 패널을 실제 Chrome으로 확인했다.
- WeddingCode 로컬 HTTP 경계는 안내 200, 결과 redirect 307, 세 쓰기/비교 API 410을 반환했다.
- 운영 DB의 사용자 내용은 문서나 로그에 복사하지 않았다.

## WeddingCode 판정

- `/wedding-code`는 검증 준비 안내만 표시한다.
- 결과 경로는 안내 페이지로 이동하고, response/pair/couple-report API는 `410 Gone`이다.
- 서로 다른 candidate 버전은 동등성 자료 없이 커플 비교하지 않는다.
- 결과 UI의 개인 축·커플 겹침 백분율은 측정 근거가 없어 제거했다.
- 16문항 독립 재감사 결과: BLOCK 6, REWRITE 7, INTERVIEW 3.
- 세부 근거와 재개 게이트는
  `docs/wedding-code/55_conservative_readiness_audit_2026-07-15.md`를 따른다.

## 다음 컴퓨터에서 확인할 순서

```bash
git switch main
git pull --ff-only origin main
```

이 변경의 PR과 merge commit은 GitHub 기록을 기준으로 확인한다. WeddingCode를 다시 공개하기
전에는 문서 55의 사람 검증 게이트를 모두 통과해야 한다. Production SQL이나 RETIRED 문서 48·49를
사용해 수집을 재개하지 않는다.

## 운영 카나리 범위

병합 뒤 다음을 확인한다.

1. `hanbang.ai`와 핵심 공개 경로가 200으로 응답한다.
2. `/wedding-code`가 containment 안내를 유지한다.
3. WeddingCode 쓰기 API가 계속 410을 반환한다.
4. 모바일 320px/390px에서 overflow와 콘솔 오류가 없다.
5. Amora 채팅 API의 demo smoke와 운영 오류 로그를 확인한다.
6. 인증 사용자 변경 도구의 최종 확인은 실제 계정에서 한 번 수행하고 DB와 화면이 함께 바뀌는지 본다.
