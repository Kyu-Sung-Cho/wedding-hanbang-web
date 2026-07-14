# 아모라 OpenAI GPT-5.6 전환 보수 검토 (2026-07-10)

## 2026-07-11 현재 증거

이 문서는 2026-07-10 당시의 감사 기록이다. 아래의 “실제 OpenAI·Supabase를 검증하지 못했다”, “fresh DB 재현 불가”, 과거 테스트 수 같은 문장은 현재 상태가 아니라 당시 상태를 설명한다. 최신 판정은 다음과 같다.

> **2026-07-14 WeddingCode 운영 정정:** 이 정정은 WeddingCode containment 범위만 다루며 Amora나 전체 제품의 출시 승인이 아니다. 초기 “운영 table absent / 백업 없음 / pre-deploy” 가정은 폐기됐다. Management API로 과거 creator SQL이 직접 적용돼 `wedding_code_responses`에 13개 행이 있었고, 프로젝트는 Pro Plan/Daily Backup 상태였다. 암호화 logical backup과 isolated PostgreSQL restore로 13개 행·13개 distinct ID·digest `2743544526a9db04c7b8ed1c83754b5c`를 검증한 뒤 별도 standalone targeted transaction을 적용했다. 행과 digest는 보존됐고 policy, runtime-role ACL, named RPC, trigger/view/publication dependency는 0이다. ledger는 repair/mark하지 않았으며 raw `supabase db push`와 전체 pending chain은 금지한다. PR #39와 #40은 각각 exact-SHA 검증, Production 배포와 apex canary를 완료했다. 자세한 영수증은 [`SESSION_HANDOFF_2026-07-14_WEDDING_CODE_CONTAINMENT.md`](./codex-tasks/SESSION_HANDOFF_2026-07-14_WEDDING_CODE_CONTAINMENT.md)를 따른다.

- 폐기 가능한 Supabase preview를 완전히 비운 뒤 baseline부터 `20260711148000`까지 migration 107개를 연속 재실행했다. 함수 50개·cron 5개·직접 호출 차단 trigger 함수와 실제 binding 각 8개의 exact contract, DB lint도 통과했다.
- lifecycle smoke에서 합류·재시작·차단 코드·legacy 코드 복구·zero-member 거부·계정 삭제 격리가 통과했다.
- anonymous probe는 민감 테이블 10개 모두의 접근 거부를 확인했다.
- AI 보존·persistent rate-limit 함수의 anon/auth 실행 권한을 제거하고 service role 전용 계약으로 고정했다. service role의 bucket 직접 INSERT/UPDATE도 회수해 canonical RPC만 사용하며, 인증 사용자 rate-limit 행은 탈퇴 lifecycle에 연결한다. provenance가 없는 업체 upload surface는 차단했다.
- 최종 fresh DB 상태에서 실제 OpenAI `gpt-5.6-luna`와 `gpt-5.6-terra`가 각각 SSE 스트리밍, replay, 정확한 DB 감사 모델 기록까지 통과했다. 마지막 응답은 259자·386자였고 테스트 행을 정리했다.
- 최종 로컬 검증은 Web Vitest 120개 파일·833개 테스트, 정적 페이지 104개 production build, 모바일 소비자 계약 11개·release check 56개, production dependency 취약점 0건이다.
- 웹·모바일은 커플 재연결 응답이 모호할 때 과거 여정을 계속 편집하지 않도록 fail-closed 복구 흐름을 사용한다.

다만 tool follow-up·PDF·이미지·refusal·abort·429/5xx, 높은 동시성·KST 경계·cron, 운영 clone upgrade는 아직 별도 검증 대상이다. **이 문장이 작성된 2026-07-11 당시** 전체 product production은 NO-GO였고 배포하지 않았다. 2026-07-14에 완료된 PR #39/#40은 WeddingCode containment 한정 배포이며 Amora·전체 migration·모바일을 포함한 일반 출시 판정을 GO로 바꾸지 않는다.

최신 종합 판정은 [`CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`](./CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md), 실행 절차는 [`SUPABASE_REMOTE_OPERATIONS.md`](./SUPABASE_REMOTE_OPERATIONS.md)를 따른다.

---

> **역사 스냅샷:** 이 문서는 2026-07-10 당시의 검토 기록이며 현재 출시 판정이 아니다. 이후 요청별 멱등 비용 예약, 실패 무료 턴 환불, 비소모 preflight, 의도별 도구 축소와 결정적 위기 응답이 추가됐다. 최신 기준은 [`CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`](./CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md)와 [`../WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md)를 따른다. 일반 신규 migration chain의 운영 적용은 확인·승인되지 않았고 ledger도 repair하지 않았다. 단, WeddingCode에는 저장소 raw migration과 다른 standalone targeted fence가 적용됐으므로 “아무 DB 운영 변경도 없었다”거나 그 artifact hash를 repo migration hash라고 쓰지 않는다.

## 결론

코드 기준 아모라 런타임의 Anthropic 의존은 제거했다. 일반 상담·도구 오케스트레이션은
`gpt-5.6-luna`가 맡고, 계약·분쟁/안전 신호·같은 세션의 반복 수정 턴만
`gpt-5.6-terra`로 승격한다. 별도 요약/분류, 갈등 자동 판정, 커뮤니티 AI 댓글,
프로액티브 채팅·케어 이메일은 숨은 비용과 삭제 경합을 줄이기 위해 코드에서 꺼져 있다.
정적 검증과 프로덕션 빌드는 통과했지만, 아래 운영 게이트가 끝나기 전에는 배포하지 않는다.

1. 빈 DB fresh reset은 통과했다. production catalog와 migration history를 대조하고 production snapshot upgrade를 통과
2. Terra/Luna 접근·기본 한국어 SSE·replay는 통과했다. 2라운드 도구·PDF/이미지·refusal·abort·429/5xx canary를 추가 통과
3. `20260710010000` 이후 DB 마이그레이션을 provider/traffic drain 유지보수 창에서 순서대로 적용하고 권한·RPC·동시성 원격 검증
4. OpenAI 프로젝트 예산·알림·rate limit과 운영 환경변수 설정
5. Supabase/Vercel/Resend/OpenAI의 실제 계약 법인·처리 리전·DPA를 확인한 국외 처리 고지 확정

## 모델과 비용 정책

| 용도 | 모델 | 기본 추론 | 제한 |
|---|---|---|---|
| 일반 상담·도구 계획 | `gpt-5.6-luna` | `none` | 출력 800, 입력 48K, 도구 라운드 1회·최대 생성 2회 |
| 계약·분쟁/안전·반복 수정 | `gpt-5.6-terra` | `none` | 결정적 규칙으로만 승격, 같은 출력·입력 상한 |
| 별도 요약·결정 추출·분류·프로필·AI 댓글 | `gpt-5.6-luna` | `none` | 코드 하드 비활성, 재도입 전 별도 승인 |

- 모든 생성은 `store:false`, standard service tier, SDK 자동 재시도 0회다.
- 모델 ID는 코드에서 정확히 `gpt-5.6-luna`/`gpt-5.6-terra`만 허용하고 reasoning은
  `none`만 허용한다. 환경변수 suffix·고추론 설정으로 비용 정책이 바뀌면 호출 전에 실패한다.
- 선택된 Terra/Luna 입력은 공식 input-token count를 실제 생성 전에 실행하고 48K를 넘으면 차단한다.
- 사용자 무료 상담 턴(커플 30)과 실제 provider 생성(커플당 일일 20, 전역 일일 60)을 분리했다. 이 값은
  production 코드의 하드 상한이라 과거 환경변수가 100/300으로 남아도 올라가지 않고 더 낮추는 것만 가능하다.
- production에서는 비용 장부를 환경변수로 끄거나 장부 장애를 fail-open으로 바꿀 수 없다.
- 도구 후속 생성은 무료 상담 횟수를 추가 차감하지 않지만 전역 provider 천장은 소모한다.
- 프롬프트 캐시는 Terra/Luna 모두 explicit/no-breakpoint로 두어 애플리케이션이 사용자 원문에 대한
  cache write를 선택하지 않는다. 이 요청 설정은 ZDR을 뜻하지 않는다. OpenAI 정책상 ZDR이 확인되지 않은
  조직은 오남용 모니터링 로그가 원칙적으로 최대 30일 보관될 수 있고, 프롬프트 캐시가 적용되는 경우
  암호화된 계산 텐서가 최대 24시간 보관될 수 있으므로 운영 조직·프로젝트의 데이터 보존 설정을 별도
  증거로 확인해야 한다.
- 비용 장부는 요청별 usage를 따로 계산해 여러 라운드 합산 때문에 장문 요율을 오적용하지 않는다.

## 보안·정합성 수정

- 클라이언트 이름·역할·예식 상태를 비데모 요청에서 신뢰하지 않고 DB 값으로 재구성한다.
- 요청 3.5MiB, 첨부 총 2MiB/3개, PDF 20페이지, 첨부 추출문자 15K, 최근 메시지 20개·
  총 24K문자로 제한한다.
- URL 첨부를 제거해 SSRF 경로를 없애고 이미지/PDF/DOCX 실제 형식·압축폭탄·픽셀 수를 검증한다.
- 모든 도구 인자를 서버에서 타입·enum·금액 상한·날짜·중첩 크기까지 다시 검증한다.
- 비공개 상담과 첨부가 있는 턴은 읽기 전용 도구만 허용한다.
- 예약 생성·취소 및 삭제성 도구는 서버 발급 exact-action 확인 토큰 전까지 모델에서 비활성이다.
- 요청 전체를 해시 장부로 먼저 선점하고, 완료 요청은 저장된 메시지를 SSE로 재생한다.
- 도구별 장부도 원자 선점하며 불확실한 상태에서는 재실행하지 않는다.
- 최종 메시지·성공 감사 로그·요청 완료를 하나의 DB 트랜잭션으로 commit한다.
- 비공개 삭제와 비공개 응답 저장은 같은 profile 행을 잠그고 삭제 세대를 검증한다.
- 비공개 턴은 파생 요약/결정/프로필을 만들지 않고 감사 장부에도 원문을 복제하지 않는다.
- `progress` RPC 실패 시 stale 전체 JSON 덮어쓰기 폴백을 제거해 동시 수정 유실을 막는다.
- 계정 탈퇴는 lifecycle marker와 service-only 영속 작업을 한 DB 트랜잭션으로 접수한다.
  서버 worker가 provider lease 종료를 확인하고, 소유가 증명된 storage prefix를 지운 뒤
  DB 비식별화·Auth 삭제를 계속한다. 앱/브라우저가 닫혀도 재시도하며 8회 실패는 dead-letter로
  격리한다. 커플 초기화는 기존처럼 202 polling으로 완료를 확인한다.
- 한 명이 떠난 기존 couple은 초대 재사용을 영구 차단해 새 파트너가 과거 shared 대화·AI 기억·
  예약 개인정보를 상속하지 못하게 한다.
- 모바일 가입·비밀번호 복구는 위조 가능한 헤더 우회를 제거하고 Turnstile이 있는 웹 흐름으로만
  연결한다. 모바일 소셜 로그인은 PKCE·검증된 App/Universal Link 적용 전까지 코드에서 꺼져 있다.
- 관리자 seed API는 인증과 production seed gate를 통과한 요청 안에서만 service client를 만든다.
  네 route의 import·인증 실패·gate 차단 순서를 15개 회귀 테스트로 고정해 빌드 시 비밀값 없는
  모듈 평가와 우회 요청이 privileged client를 먼저 만들지 못하게 했다.
- 커뮤니티 신규 업로드는 JPEG/PNG/GIF/WebP만 허용하며 magic byte와 실제 디코더 형식,
  가로·세로·픽셀·애니메이션 프레임/누적 픽셀을 검증한다. 일일 20개 한도는 service-only DB
  예약 장부와 user/day advisory lock으로 원자화했다. Storage metadata INSERT가 같은 트랜잭션에서
  활성 예약을 소비하므로 만료 예약은 안전하게 해제되고 늦은 commit은 거절된다. 영상 신규 업로드 UI/API는 함께 비활성이다.
- 외부 처리 계약과 리전 고지가 확정될 때까지 웹/모바일 PostHog·Sentry 송신은 키와 무관하게
  코드에서 비활성이다.

## 데이터·보존

- AI 원문·직접 식별자는 90일 경과 후 일일 비식별화 처리한다.
- 비식별 비용·보안 장부와 원문 없는 요청 해시 tombstone은 1년 경과 후 일일 삭제한다.
- private 삭제 RPC는 메시지·피드백·요약·결정·프로필·연결 감사 payload를 한 트랜잭션에서
  삭제/비식별화하고 요청 tombstone의 메시지 링크도 제거한다.
- `chat_feedback.message_id`의 legacy TEXT와 메시지 UUID 비교 타입 불일치를 수정했다.

## UX·디자인 검토 반영

- 웹 메인 채팅·사이드패널·모바일에 AI 생성 고지와 정책 링크를 일관되게 표시했다.
- 배지 대비·12px 최소 글자·모바일 터치 타깃·선택 상태를 보강했다.
- 첨부 선택 UI를 서버 정책(3개/총 2MiB, 이미지·PDF·DOCX)과 맞추고 `.doc` 오허용을 제거했다.
- 비공개 삭제/공유 초기화 문구가 실제 동작 범위를 과장하지 않도록 고쳤다.
- WeddingCode source에는 16문항 브라우저 계산 후보가 남아 있지만 현재 Production은 입력·제출 없이 검증 준비 안내만 표시한다. 과거 plaintext `ct`는 rendering·analytics 전에 제거되고 커플 초대·비교 및 익명 응답 수집 API는 모두 410으로 하드 차단됐다. 운영 DB의 기존 13개 행이나 token 값은 이번 대응에서 삭제·NULL 처리하지 않았다. 별도 standalone fence가 앱 역할 권한·policy·named RPC를 제거하고 `CHECK (false) NOT VALID`로 새 INSERT·UPDATE를 거부하며, 보유·삭제는 별도 법적·사업적 결정으로 남는다.

## 검증 결과

- `pnpm qa:local`: CI와 같은 비밀값 없는 정적검증용 placeholder 환경에서 통과
- Web TypeScript / ESLint / Vitest: 통과 (`65 files`, `503 tests`)
- Next.js production build: 통과 (`101` static pages 생성)
- Mobile release readiness: `56 passed`, warning/failure 0
- Mobile lint/typecheck, shared/design-token typecheck: 통과
- `pnpm audit --prod`: 알려진 취약점 0
- `git diff --check`, 비밀값 패턴 검사, 비용 보고 스크립트 syntax: 통과
- 로컬 Docker와 실제 OpenAI/Supabase 운영 자격증명이 없어 DB 실행 검증·실모델 canary는 미수행

## 남은 보수적 위험

- **P0 — fresh DB 재현 불가**: 기존 migration chain은 `profiles`, `vendors`,
  `vendor_products`, `vendor_images`, `vendor_bookings`, `vendor_favorites`를 생성하지 않은 채
  ALTER한다. 운영 catalog를 추측해 baseline을 만들면 데이터·제약을 틀릴 수 있으므로,
  검토된 schema dump와 fresh/snapshot 양방향 staging 검증 전에는 어떤 신규 migration도 배포 금지다.
- **해결된 역사 blocker — 2026-07-14 정정:** 당시에는 production `ct`/response UUID의 DB 폐기를 확인하지 못했다. 이후 Pro physical backup과 암호화 logical backup·isolated restore를 확보하고 standalone targeted fence SHA-256 `9F9C36B62A05AAE9D9552B37C67294CA7FC160DAD101F055FDA8FEE098B26D88`를 적용했다. postcheck에서 13개 행·digest 보존, policy/runtime ACL/named RPC/dependency 0을 확인했고 PR #39/#40 canary도 통과했다. QA row나 기존 token을 삭제·NULL 처리한 것은 아니며 그 결정은 별도 승인 대상이다.
- 가입 메일은 전송 실패 시 방금 만든 Auth 사용자를 보상 삭제하지만, 영속 email outbox와
  재시도/dead-letter가 없다. 공급자가 성공을 반환한 뒤 실제 전달이 유실되는 경우까지 보장하려면
  outbox를 추가해야 한다.
- 계정 삭제 큐의 dead-letter 알림·운영 대시보드와 legacy/공유 storage의 수동 reconciliation
  절차는 배포 전 확정해야 한다. 소유가 불명확한 파일은 다른 사용자 보호를 위해 자동 삭제하지 않는다.
- mutation commit과 도구 결과 장부 갱신은 서로 다른 트랜잭션이다. 요청 전체 tombstone이 같은
  ID 재실행을 막고 고위험 도구는 비활성이나, 사용자가 새 요청 ID로 동일 작업을 다시 명령하면
  내부 상태를 먼저 확인해야 한다. 장기적으로 mutation별 DB RPC 안에 semantic idempotency를 둔다.
- 모바일은 SSE를 provider 중립 형식으로 파싱하지만 현재 응답 전체를 받은 뒤 처리한다. 실시간
  토큰 표시가 필요하면 React Native 스트림 지원 경로를 별도로 구현한다.
- PDF 페이지 수의 정규식 검사는 보조 방어다. 실제 비용 경계는 OpenAI exact token count가 맡는다.
- 외부 처리 리전·계약 고지가 확정되지 않았으므로 법무 검토 전 운영 배포는 금지한다.
- existing one-slot couple·legacy private derived rows·owner 없는 축의금 행은 마이그레이션 preflight가
  자동 추정하지 않고 중단한다. 백업·inventory·운영자 repair 후 재실행해야 한다.
- 0500 DDL과 0800 Storage trigger는 runtime lock 순서·구버전 업로드 route와 교차할 수 있으므로
  live traffic 및 provider를 완전히 drain한 유지보수 창에서만 적용한다. 새 route-before-DB는 503,
  DB-before-old-route는 업로드 거절로 fail-closed지만 무중단 rolling deploy 계약은 아니다.

## 공식 근거

- OpenAI 모델 가이드: https://developers.openai.com/api/docs/guides/latest-model
- Terra: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- 가격: https://developers.openai.com/api/docs/pricing
- 프롬프트 캐시: https://developers.openai.com/api/docs/guides/prompt-caching
- 데이터 제어: https://developers.openai.com/api/docs/guides/your-data
