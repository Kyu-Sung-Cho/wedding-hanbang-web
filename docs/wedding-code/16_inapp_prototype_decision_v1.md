# WeddingCode 수집 채널 결정: 노코드 폼 → 인앱 프로토타입 (2026-07-05)

> [!WARNING]
> **폐기된 연구 결정 스냅샷입니다.** 익명 응답 수집, 파트너 초대·페어링, 커플 리포트 API는 현재 HTTP 410으로 하드 비활성입니다. 개인 결과만 브라우저에서 계산하며, 최신 기준은 `../CONSUMER_JOURNEY_AND_AMORA_REVIEW_2026-07-11.md`를 따릅니다.

## 결정

v0.3 스모크 테스트를 Tally 등 외부 노코드 폼 대신 **hanbang.ai/wedding-code 인앱
프로토타입 페이지**로 수집한다. (사용자 승인, 2026-07-05)

이는 `15_no_code_form_v0.3_build_pack.md` §15 Non-Goals 중 **"No product UI / No routes /
No DB migrations / No DB storage" 4항을 수집 수단에 한해 해제**하는 결정이다.

## 왜 바꿨나

Non-Goals의 본질은 "채점·유형·캐릭터를 성급히 제품화하지 말라"는 것이지 수집 수단
제한이 아니다. 노코드 전제는 "코드가 비싸다"였는데 이 팀 구성에선 반대다:

| | Tally | 인앱 |
|---|---|---|
| 빌드 노동 | 사용자가 직접 1시간+ 클릭 | Claude가 전부 구현 |
| 응답 데이터 | 외부, CSV 수동 export | DB — 판독 쿼리 즉시 |
| UTM/퍼널 | 끊김 | 기존 first-touch UTM·PostHog 그대로 |
| 완료 후 흐름 | 없음 | /check·베타로 일반 탐색 CTA |
| 모집 | 지인 부탁 | 유통 테스트 링크에 편승 가능 |
| v0.4 진화 | 폼→제품 이관 절벽 | 같은 자리에서 진화 |

## 유지되는 가드레일 (변경 없음 — 구현에서 강제됨)

- **채점·가중치·공개 4글자 코드·최종 16유형·캐릭터·궁합 표현 없음** — DB에 점수 컬럼
  자체가 없고(원시 선택지 JSONB만), 클라이언트에 계산 코드 없음.
- 심리 진단·관계 상담·법률 자문·결혼 성공/이혼 예측 아님 — 인트로에 원문 유지.
- 동의 체크 필수, "정답 없음" 고지, 감사 화면에서 "최종 결과 없는 프로토타입" 재고지.
- 구성개념 라벨 비노출. 단계 게이팅(§6 Option B)·가정 섹션·stage_flags 기록 유지.
- **PII 미수집** — 이메일·이름·전화 없음. 응답 테이블은 service_role 전용
  (anon/authenticated 권한 0, 원격 검증 완료).
- 완료 화면 CTA(/check·베타)는 **일반 탐색 링크**다 — 답변 기반 개인화 라우팅이
  아니므로 §11 "Do not route users into production features"의 취지(결과 기반 라우팅
  금지)를 위반하지 않는다.
- 아모라 프롬프트 무변경.

## 구현 위치

| 구성요소 | 위치 |
|---|---|
| 페이지 (noindex + robots disallow, 미링크) | `apps/web/src/app/wedding-code/` |
| 폼 카피 (15번과 동기 유지 의무) | `apps/web/src/constants/weddingCodeForm.ts` |
| 서버 검증 (+테스트 9종) | `apps/web/src/lib/weddingCode/validate.ts` |
| 수집 API (IP rate limit 10/h, 32KB 캡) | `apps/web/src/app/api/wedding-code/response/route.ts` |
| 테이블 (service_role 전용) | `supabase/migrations/20260705160000_wedding_code_responses.sql` |

15번 문서의 §13 성공/실패 임계값·§14 운영 체크리스트는 그대로 유효하다.
드라이런 실행은 `17_dry_run_kit_v1.md`.
