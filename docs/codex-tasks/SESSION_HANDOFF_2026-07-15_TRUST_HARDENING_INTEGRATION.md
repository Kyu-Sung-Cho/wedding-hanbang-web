# 웨딩한방 신뢰 경계 고도화·통합 WIP 인수인계 — 2026-07-15

> 이 문서는 2026-07-15 로컬 통합 작업을 다른 컴퓨터에서 그대로 이어가기 위한 기준 문서다. 현재 제품 계약은 `PROJECT_STATUS.md`와 `WEDDINGHANBANG_SERVICE_DOC.md`, 운영 변경 절차는 `docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md` 및 `docs/operations/AMORA_PRODUCTION_RELEASE.md`, 실제 동작은 코드·migration·계약 테스트를 우선한다.

## 1. 인수인계 결론

- 작업 브랜치: `agent/production-integration`
- 작업 시작 기준: `ed499ffc8f96` (`fix: harden privacy, trust, and release safety`)
- 전체 코드 체크포인트: `8357197f270592b25164234d3816ef80b0ce71f4`
- GitHub Draft PR: [#46 — INTEGRATION WIP / DO NOT MERGE](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/46)
- 감사 시점 최신 원격 기준: `origin/main` `56b7fee1ad3688cc44370dd9c45244c6da461c42`
- 게시 위치: 이 문서를 포함한 최종 commit과 Draft PR의 head SHA가 최종 인수인계 identity다.
- 브랜치 성격: **유실 방지·선택 이식 검토용 WIP 체크포인트. `main` 병합 후보가 아니다.**
- 운영 판정: **NO-GO**
- 이번 작업에서 허용한 외부 변경: Git commit, 새 원격 브랜치 push, Draft PR 생성
- 이번 작업에서 하지 않는 것: `main` 병합, Vercel 배포, EAS build, 원격 Supabase migration/repair, 운영 환경변수 변경, 실사용 OpenAI 호출

현재 branch HEAD와 최신 `main`은 merge base `8d8933e1` 이후 서로 갈라져 있으며, 체크포인트 commit 전 기준으로 로컬은 137 commits ahead / 18 commits behind다. committed tree끼리의 3-way merge simulation만으로 실제 텍스트 conflict가 최소 95개이고, 최신 PR #43 변경 경로 중 59개 파일은 로컬 worktree에 물리적으로 없다. 따라서 “로컬 변경이 최신 `main`의 상위 호환”이라고 판단하지 않았고, 이번 체크포인트에 `main`을 merge/rebase하지 않는다.

이번 변경의 제품 핵심은 기능을 많이 보이는 서비스가 아니라, 소비자가 실제로 믿고 쓸 수 있는 범위만 남기는 것이다. 현재 웨딩한방은 업체 중개·예약·전자계약·결제·개인 견적 판정 서비스가 아니다. 아모라는 질문과 확인 항목을 정리하고, 사용자가 직접 확인한 일정·예산·준비 기록을 읽어 맥락을 이어주는 역할로 제한한다.

체크포인트 범위 감사 결과:

- 751 files: 402 modified, 111 deleted, 238 added
- diff 규모: 47,889 insertions / 65,013 deletions
- web API/test, page/component, AI/community/auth library, mobile, shared package, release script, 24 migrations, 문서가 모두 이번 신뢰 경계 변경과 연결됨
- 신규 파일 확장자는 `.ts`, `.tsx`, `.mjs`, `.sql`, `.md`뿐임
- binary, screenshot, log, build output, cache, `.env.local` 포함 없음

## 2. 제품 방향 판단

### 남긴 핵심 흐름

1. 사용자가 직접 확인한 준비 상태, 일정, 예산 기록
2. 아모라의 질문 정리, 정보 구조화, 다음 확인 항목 안내
3. 출처·기준일·범위를 표시하는 공식 시세 참고 정보
4. 텍스트 중심 커뮤니티의 제한된 읽기·게시 흐름
5. 중요한 판단은 원문·업체·전문가에게 다시 확인하게 하는 신뢰 경계

### 소비자용 코드에서 퇴역하거나 하드 비활성한 흐름

- 개인 견적의 적정성·정상/비정상·예상 추가금 판정
- 업체 검색·추천·매칭·상담 연결·예약 생성/조회/변경/취소
- 전자계약·전자서명·결제·정산을 실제 제공하는 듯한 흐름
- WeddingCode 설문·점수·결과·공유·커플 비교·응답 수집
- 익명 고객 설문과 사용자 연구 접수
- 동기방, 동기 메시지, 가격·계약 기록, 타임라인
- 커뮤니티 사진/슬라이드/구조화 가격 입력/빠른 후기/새 투표
- 새 댓글·답글 작성
- 축의금 장부의 새 조회·입력·수정
- 푸시 알림 등록·전송
- 검증되지 않은 계정 삭제 접수
- 아모라의 일정·예산·체크리스트·업체·예약 쓰기 도구

퇴역은 단순 메뉴 숨김이 아니다. 소비자 API는 인증·본문·DB 접근 전에 `410` 또는 출시 모드에 맞는 고정 실패 응답을 반환하고, 관련 실행 스키마·도구 선택·공개 DTO·브라우저 직접 권한을 제거하거나 닫는다. 과거 테이블은 보존·삭제·명시적 공개 해제와 호환을 위해 남을 수 있으나, 테이블이 존재한다는 이유로 기능을 복구하면 안 된다.

## 3. 영역별 변경 내용

### 3.1 공개 진입과 출시 모드

- 승인 가능한 공개 배포 모드는 현재 `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`뿐이다.
- 누락·공백·알 수 없는 launch mode는 공개 권한으로 해석하지 않는다.
- `/demo`, `/support`, `/beta`, 약관·개인정보 등 공개 화면의 문구를 실제 미제공 범위와 맞췄다.
- 가입·설문 경로는 공개 기능처럼 보이지 않도록 닫힘 안내 또는 안전한 리디렉션을 사용한다.
- `full` 모드는 계정 삭제 전 과정, 운영자 대응, 법적 주체·약관·개인정보·처리자 검토와 운영 E2E가 완료되기 전까지 금지한다.

### 3.2 아모라

- 공급자는 OpenAI Responses API만 사용하며 Anthropic fallback을 두지 않는다.
- 허용 모델은 일반 상담 `gpt-5.6-luna`, 안전·복잡도 승격 `gpt-5.6-terra`로 제한한다.
- 이번 로컬 변경에서는 모델 기반 쓰기 도구를 제거하고 읽기·정리 중심 도구만 노출한다.
- 일정·예산·체크리스트·업체·예약을 생성·수정·삭제했다는 허위 실행 주장을 차단한다.
- 가격 판정, 법률 검토, 계약 승인, 업체 보증을 하지 않는다.
- 테스트 단계에서는 `AMORA_USAGE_LIMITS_ENABLED=false`로 상담 횟수 차단을 두지 않는다. 호출 계량·비용·감사 기록은 유지하며, 상용 무료 무제한 약속으로 표현하지 않는다.
- 이미지/PDF는 현재 고지를 확인한 첨부 상담에서만 전송한다. 이미지는 방향 적용 후 재인코딩해 EXIF/GPS를 제거하고, DOCX는 받지 않는다.
- 관계 폭력·위기 표현은 일반 웨딩 조언과 분리된 안전 응답을 사용한다.
- provider 실제 권한, Luna/Terra streaming, 도구 후속, PDF, 거절, 중단, 비용 상한은 새 회전 키로 별도 canary가 필요하다.

### 3.3 예산·일정·준비 기록

- 예산은 계획액, 계약 금액, 지급액, 다음 지급액을 사용자가 직접 구분해 기록한다.
- 공식 평균이나 비율을 개인 예산·적정 견적으로 자동 저장하지 않는다.
- 일정과 체크리스트는 사용자가 직접 저장한 사실과 선택 항목만 진척도로 계산한다.
- 원자적 schedule event, budget category, checklist item, journey preference mutation 경계를 추가했다.
- 부분 실패가 성공처럼 보이거나, 모델이 실행하지 않은 행동을 완료로 말하지 않게 계약 테스트를 추가했다.

### 3.4 커뮤니티

- 웹은 text-only 게시글 읽기·쓰기를 유지하고, 모바일은 text-only 읽기 중심으로 제한한다.
- 새 댓글·답글 POST, 빠른 후기, 새 투표, 사진/슬라이드, 구조화 가격 입력은 퇴역했다.
- 기존 댓글 조회와 웹 작성자의 기존 댓글 수정·삭제는 원자적 service-only RPC와 권한 확인을 거친다.
- 공개 DTO에서 auth UUID, 원본 작성자 UUID, 내부 등급·배지를 제외하고 opaque actor id와 안전한 별명·아바타만 노출한다.
- 작성자 숨김은 비공개 사용자 관계로 저장하고 피드·검색·상세·과거 댓글에 일관되게 적용한다.
- Realtime/publication과 브라우저 직접 SELECT에서 legacy price/media/private payload를 제외한다.
- 설정·DB 오류 시 빈 데이터나 성공으로 위장하지 않고 fail-closed 상태를 보여준다.

### 3.5 업체·예약·계약·견적

- 업체 카탈로그, 즐겨찾기, 업체 대화, 예약 목록/상세, 견적 분석·공유는 미제공 안내 또는 고정 retired 응답으로 닫았다.
- 개인별 계약 조건을 평균 가격으로 판정하거나 “안전한 계약”으로 보증하지 않는다.
- 문서에서 확인 질문은 정리할 수 있지만, 법률 검토·가격 정상성·계약 승인 의견은 제공하지 않는다.
- 관리자 booking history API와 UI의 과거 PII 탐색 경로를 제거했다. 해당 API는 인증이나 DB 조회 없이 `410 ADMIN_BOOKING_HISTORY_RETIRED`와 `private, no-store`를 반환한다.
- 관리자 vendor mutation과 synthetic seed 경로도 퇴역 상태·권한·cache 경계를 고정했다.

### 3.6 인증·계정·개인정보

- `/api/auth/me`와 관리자 customer 상태 조회는 profile/couple/journey 부분 실패를 성공 또는 빈 값으로 축소하지 않는다.
- 내부 DB/provider 오류 문자열을 그대로 반환하지 않고 안정적인 오류 코드와 일반 메시지로 redaction한다.
- 민감 응답과 retired 응답에 `private, no-store`를 적용한다.
- 공개 사용자 연구, 익명 설문, 계정 삭제 접수는 운영 절차가 없는 동안 하드 비활성이다.
- raw customer tracking, 공개 vendor data API, 직접 profile SELECT, legacy community payload와 money ownership 경계를 migration으로 닫는다.
- 사용자별 브라우저 저장소가 계정 전환 뒤 섞이지 않도록 scope 계약을 추가했다.

### 3.7 모바일

- 퇴역한 업체·예약·커뮤니티 작성·미디어·WeddingCode 흐름을 웹 경계와 맞췄다.
- 인증, 라우팅, 채팅 전달, 예산·일정 기록의 실패 표시와 소비자 문구를 동기화했다.
- 모바일 release readiness는 일반 개발 검증만 통과했으며, 소셜 로그인·signed association·새 exact-SHA EAS build·실기기 증거가 없어 store release는 승인하지 않는다.

### 3.8 DB, RLS, ACL, release harness

2026-07-13 suffix의 신규 migration은 다음 신뢰 경계를 구현한다.

| migration | 목적 |
|---|---|
| `20260713101000` | 테스트 단계 아모라 횟수 제한 해제와 계량 유지 |
| `20260713102000` | private money ownership 고정 |
| `20260713103000` | schedule event 원자적 mutation |
| `20260713104000` | public vendor catalog data API 폐쇄 |
| `20260713105000` | disabled browser write surface 폐쇄 |
| `20260713106000` | budget category 원자적 mutation |
| `20260713107000` | checklist item 원자적 mutation |
| `20260713108000` | journey preference 원자적 mutation |
| `20260713109000` | quote-check write 퇴역 |
| `20260713110000` | community price-data write 퇴역 |
| `20260713111000` | budget manual-record 의미 계약 |
| `20260713112000` | raw customer tracking 퇴역 |
| `20260713112500` | profile direct SELECT 폐쇄 |
| `20260713113000` | public community media 퇴역 |
| `20260713114000` | congratulatory money 퇴역 |
| `20260713115000` | community legacy payload 노출 폐쇄 |
| `20260713116000` | 사용자별 community mute |
| `20260713117000` | comment safety 원자화 |
| `20260713118000` | opaque community actor id |
| `20260713119000` | community post lifecycle 원자화 |
| `20260713120000` | research cohort consent version |
| `20260713121000` | community post update 원자화 |
| `20260713122000` | service_role table ACL 최소화 |
| `20260713123000` | disposable preview smoke fixture harness |

중요: 이 migration들은 로컬 parser·계약 검증을 통과했지만, 최신 `main`의 2026-07-14 production migration/ledger 이후에 새로 합류하는 **더 이른 timestamp의 파일**이다. 원격 ledger에 그대로 적용하거나 `db push --include-all`, repair/mark를 실행하면 안 된다. disposable preview에서 fresh replay와 실제 production ledger snapshot 기반 upgrade plan을 다시 설계하고 승인해야 한다.

ACL 결과:

- SQL parser: 142/142 통과
- release/ACL 계약: 114/114 통과
- 독립 P0/P1 잔여: 0
- private table의 browser/service direct ACL: 0
- 네 개 public RPC만 service-only 실행 경계 유지
- `ALL`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, grant option 잔여: 0
- production Supabase ref를 preview smoke target으로 사용하는 경로는 JS와 DB에서 모두 거부
- cleanup은 transaction 안에서 fixture 소유 데이터만 지우며 제3자 데이터를 삭제하지 않음

고정 파일 SHA-256:

- `scripts/sql/supabase-production-preflight.sql`: `86d56d1f542c6fa8b16d924e74c9463e7003dcf634c2e08f3cac9c9ccf2a908b`
- `scripts/sql/supabase-post-deploy-contract.sql`: `341fbc11d805d4fb7e439e800e3adaeacfff13c3955b29e7cd8efc805372a8c3`
- `20260713118000_opaque_community_actor_ids.sql`: `3f381f4537a93960fa8f9e5d962f1032942f376b97d7e24dc89001c3f5b5d03c`
- `20260713122000_lock_service_role_table_acl.sql`: `2777e5af81722c4e324147f013bcd1e360b7f002b089407ccfbc8d12ccc76abc`
- `20260713123000_preview_smoke_fixture_harness.sql`: `2d93e60334126fbb1c43ede5d3ffafefa2f9ac0ac1020cf759d3716a18eecc48`

## 4. 다른 컴퓨터에서 올라온 작업과의 관계

### 최신 `main`

2026-07-14~15에 다른 컴퓨터에서 다음 작업이 PR #39~#43으로 `main`에 병합됐다. 이번 WIP 체크포인트는 해당 `main`을 코드로 병합하지 않았으며, 원격 작업의 존재·운영 증거·충돌 범위만 감사했다.

- WeddingCode 수집 containment와 PostgreSQL 17 privilege fence
- OpenAI Responses API 기반 아모라 런타임 foundation
- 아모라 feedback 개인정보 hotfix
- DB/Storage expand, signup profile integrity, release fence와 운영 증거

해당 작업의 최신 운영 기록은 다음 문서를 따른다.

- `docs/codex-tasks/SESSION_HANDOFF_2026-07-15_AMORA_OPENAI_RELEASE.md`
- `docs/operations/AMORA_PRODUCTION_RELEASE.md`
- `docs/evidence/AMORA_PRODUCTION_EXPAND_2026-07-15.md`

원격 기록상 production DB/Storage expand와 hosted synthetic 검증은 수행됐지만, OpenAI production enable, Vercel release, EAS native build, contract-phase ACL/policy 제거는 완료되지 않았다. 이 로컬 브랜치의 더 보수적인 제품 범위·퇴역 경계를 **최신 `main` 기반 새 reconciliation branch에 선택 이식할 때**도 그 운영 증거를 삭제하거나 과장하면 안 된다.

PR #43의 129개 마지막 변경 경로를 로컬 worktree와 대조한 결과, exact-equal 0, 내용 상이 68, 로컬 부재 59, 동일 삭제 2였다. 빠진 범위에는 OpenAI 요청 원자성, 채팅 저장·privacy migration, immutable attachment storage contract, 가입·계정 삭제 무결성, backup/release fence가 포함된다. 이 때문에 현재 WIP commit 전체를 최신 `main`에 merge하거나 cherry-pick하지 않는다.

### Couple Court 보존 브랜치

`origin/integration/couple-court-reconciled-20260714`는 작업 유실 방지용 통합 브랜치다. 자체 handoff가 “큰 PR로 병합하거나 운영 배포하지 말 것”이라고 명시한다. 현재 제품 방향은 관계 판단·개입을 새 공개 기능으로 추가하기보다 핵심 웨딩 준비 기록과 신뢰 경계를 먼저 완성하는 것이므로, 이번 브랜치에는 Couple Court 기능을 통째로 병합하지 않는다.

필요하면 향후 `origin/main`에서 별도 작은 브랜치를 만들어 abuse limit, JSON stream limit, attachment 복구, 접근성처럼 재사용 가능한 안전 패치만 독립 PR로 검토한다. Couple Court 기능 자체는 별도 소비자 문제 정의·법무/안전·실패 복구·실사용 검증 없이 복구하지 않는다.

### archive PR #38

PR #38 `agent/amora-openai-gpt56`은 역사 보존용 Draft이며 merge target이 아니다. 그 뒤 원격에 추가된 다음 두 commit은 현재 체크포인트와 겹치는 파일이 있어 자동 병합하지 않았다.

- `ee1f4340`: Kakao admin credential과 public app key scanner 구분
- `08f13097`: Windows write-fence JSON type 보존

두 수정은 최신 `main` 기반 reconciliation에서 현재 scanner/write-fence 변경과 의미 단위로 합쳐야 한다. PR #38을 Ready로 바꾸거나 force-push하지 않는다.

## 5. 로컬 검증 영수증

다음 결과는 최신 제품/보안 수정 뒤 같은 로컬 worktree에서 확인했다. 최신 `main` 기반 reconciliation branch에 선택 이식한 뒤 영향을 받은 검사는 다시 실행하고, 최종 결과가 다르면 이 절을 갱신해야 한다.

| 검증 | 결과 |
|---|---|
| 웹 Vitest 전체 | 274 files, 1,669/1,669 PASS |
| 모바일 소비자 계약 | 109/109 PASS |
| monorepo typecheck | 4/4 packages PASS |
| monorepo lint | PASS |
| Next production build | Next 16.2.6, 104 pages, PASS |
| Node release/security contracts | 14/14 PASS |
| mobile release readiness | 76 PASS, 1 WARN, 0 FAIL |
| SQL parser | 142/142 PASS |
| release/ACL contracts | 114/114 PASS |
| `git diff --check` | PASS |

모바일 경고는 email login만 검증된 상태이며 store 제출 증거가 아니라는 뜻이다.

최종 production build를 로컬 `127.0.0.1`에서 확인한 브라우저 결과:

- `/demo`, `/support`, `/beta`, `/terms`, `/privacy` 정상 렌더
- `/customersurvey`, signup/login 공개 경로는 허용된 닫힘 흐름으로 이동
- 브라우저 console error/warning 0
- survey/bookings/quote/proactive/vendors API는 출시 차단 응답
- preregister는 research intake closed 응답
- admin vendor mutation과 booking history는 고정 `410`
- 모든 민감/retired 응답은 `no-store`

이 브라우저 검증은 로컬 build 증거이며 Vercel deployment, 실제 Supabase, Turnstile, OAuth, OpenAI provider의 운영 증거가 아니다.

## 6. 비밀정보 검사와 Git 게시 경계

- 현재 tree의 tracked/untracked 소스에는 새 live key, private key, `.env.local`, build artifact가 없다.
- `.env.local`은 web/mobile 모두 ignore 상태이며 Git에 포함하지 않는다.
- full-history scanner는 과거 Git history의 Kakao platform key 형태 값 3개 때문에 의도적으로 실패한다.
- 값은 이 문서·PR·로그에 적지 않는다.
- 이 값들은 원격 history에 이미 존재하지만, Kakao Developers에서 폐기·재발급, 실제 consumer 갱신, 구 값 거부, 사용량 검토가 확인되기 전에는 merge·배포하지 않는다.
- history rewrite나 fingerprint allowlist는 저장소 소유자·협업자의 명시 승인 없이 하지 않는다.

따라서 새 feature branch push는 다른 컴퓨터에서 이어가기 위한 보존 작업으로 허용하지만, Draft PR은 **DO NOT MERGE / NO-GO** 상태를 유지한다.

## 7. 아직 완료되지 않은 출시 조건

1. 최신 `main`에서 새 reconciliation branch를 만들고 도메인별 선택 이식
2. scanner/write-fence의 `ee1f4340`, `08f13097` 의미 보존
3. 선택 이식 뒤 전체 exact-SHA CI 재검증
4. 2026-07-13 migration suffix의 disposable preview fresh/upgrade/replay
5. 승인된 non-production Supabase ref 등록과 preview smoke
6. production ledger를 다시 읽은 뒤 timestamp/repair 없는 안전한 migration 계획
7. Kakao key 3개 provider-side 회전·구 키 거부·사용량 검토
8. 새 회전 OpenAI key로 Luna/Terra streaming·tool follow-up·PDF·refusal·abort·cost canary
9. Turnstile, OAuth, hosted Auth, 지원 채널, 외부 처리자·DPA/region/retention 결정
10. 현재 코드와 호환되는 DB/Storage contract phase와 legacy policy 제거 검증
11. 새 exact-SHA EAS iOS/Android build와 실기기 login/deep-link/attachment 검증
12. 계정 삭제 worker, Storage/외부 처리자 삭제, 장애 복구 증거
13. 새 clean-tree backup과 독립 restore drill
14. 보호된 staged deployment의 immutable SHA/ID와 post-deploy canary

`scripts/release-targets.json`의 `approvedNonProductionSupabaseProjectRefs`는 현재 빈 배열이다. 이는 remote preview smoke를 실행하지 못한 이유이며 안전한 fail-closed 상태다. production ref를 여기에 넣어 우회하면 안 된다.

## 8. 다른 컴퓨터에서 이어가는 정확한 절차

### 새 clone

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --all --prune
git switch --track origin/agent/production-integration
git status --short --branch
git log --oneline --decorate -8
corepack enable
corepack pnpm install --frozen-lockfile
```

### 기존 clone

```powershell
git fetch --all --prune
git switch agent/production-integration
git pull --ff-only
git status --short --branch
corepack enable
corepack pnpm install --frozen-lockfile
```

로컬 미커밋 변경이 있으면 먼저 별도 branch/commit으로 보존한다. `reset --hard`, force-push, 임의 checkout 덮어쓰기를 하지 않는다.

환경변수는 `apps/web/.env.example`과 `apps/mobile/.env.example`의 이름만 참고해 각 컴퓨터에서 새 `.env.local`을 구성한다. `.env.local`, backup, DPAPI artifact, provider receipt, key를 Git·메신저·문서로 복사하지 않는다.

### 첫 로컬 확인

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/mobile test
corepack pnpm --filter @hanbang/web build
corepack pnpm mobile:release-check
git -c core.safecrlf=false diff --check
```

full-history secret scan은 Kakao history blocker 때문에 실패해야 정상이다. 이를 green으로 만들려고 값을 allowlist하거나 검사를 끄지 않는다.

### 실제 reconciliation 시작

현재 WIP 브랜치 위에서 `main`을 merge/rebase하지 않는다. 최신 `main`에서 별도 branch를 만들고, 이 체크포인트의 변경을 아래 순서의 작은 vertical slice로 선택 이식한다.

```powershell
git fetch --all --prune
git switch main
git pull --ff-only origin main
git switch -c agent/trust-hardening-reconcile
```

권장 이식 순서:

1. 공개 launch mode와 과장 없는 카피
2. 업체·예약·견적·WeddingCode·설문 retired route/UI
3. 아모라 read-only 도구와 가격·계약 판단 금지
4. auth/admin error redaction과 `no-store`
5. 커뮤니티 text-only·opaque actor·mute 경계
6. 일정·예산·체크리스트 원자적 mutation
7. service_role ACL과 preview smoke harness
8. 모바일 parity와 최종 문서

각 slice마다 최신 `main`의 PR #43 privacy/attachment/signup/account-deletion/release-fence 파일을 보존하고, 관련 테스트·typecheck를 통과한 뒤 독립 commit한다. 2026-07-13 migration은 파일 단위 copy보다 먼저 version/ledger 재설계를 승인받는다.

### DB/외부 provider 작업 전

1. `PROJECT_STATUS.md`, 이 문서, 최신 Amora release handoff와 두 운영 runbook을 다시 읽는다.
2. production이 아닌 disposable Supabase project를 새로 만들고 정확한 ref를 별도 검토한다.
3. production ref가 아닌지 JS guard와 DB harness가 함께 거부/허용하는지 확인한다.
4. fresh replay, 기존 schema upgrade, rollback/cleanup, ACL pre/post, preview smoke를 순서대로 실행한다.
5. 실제 production ledger snapshot과 pending set을 read-only로 다시 확인한다.
6. 사람이 승인한 exact plan과 backup/restore evidence가 없으면 원격 쓰기를 하지 않는다.

## 9. 절대 하지 말아야 할 것

- 과거 문서의 기능 목록만 보고 퇴역 기능을 복구하지 않는다.
- 업체·예약·계약·견적 판정·WeddingCode·설문을 환경변수 하나로 다시 열지 않는다.
- `supabase db push --include-all`, unscoped repair/mark, production ref preview 등록을 하지 않는다.
- 로컬 테스트 통과를 production proof로 말하지 않는다.
- OpenAI 모델 이름이 코드에 있다는 이유로 실제 provider 권한·성능을 보장하지 않는다.
- `.env.local`, key, receipt, backup, 고객 식별자를 commit하지 않는다.
- PR #38이나 Couple Court 보존 브랜치를 통째로 merge하지 않는다.
- history rewrite, force-push, squash/rebase로 증거 체인을 바꾸지 않는다.
- Kakao key rotation, preview DB replay, provider canary가 끝나기 전에 Draft PR을 Ready로 바꾸거나 배포하지 않는다.

## 10. 완료 기준

이번 인수인계의 완료는 다음 네 가지가 모두 충족된 상태다.

1. 최신 원격 작업과 충돌·누락 범위를 대조했다.
2. 현재 전체 변경과 이 문서를 같은 새 원격 브랜치에 WIP 체크포인트로 push했다.
3. Draft PR에 검증 결과, 원격 divergence와 NO-GO 사유를 기록했다.
4. 다른 컴퓨터에서 `origin/agent/production-integration`을 checkout해 동일한 소스와 문서를 받을 수 있다.

이는 최신 `main` 통합, 제품 출시나 운영 배포 완료를 의미하지 않는다. 최종 branch tip과 Draft PR URL은 GitHub가 제공하는 immutable handoff pointer로 사용하고, 실제 병합 후보는 최신 `main` 기반의 별도 reconciliation branch에서 만든다.
