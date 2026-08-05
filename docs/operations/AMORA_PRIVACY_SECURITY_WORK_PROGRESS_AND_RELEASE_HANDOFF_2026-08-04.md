# 아모라 개인정보·보안 작업 진행 및 프로덕션 판정 인수인계 — 2026-08-04

> 상태: **CURRENT FACTUAL HANDOFF / TARGET ARCHITECTURE DOCUMENTED / IMPLEMENTATION NOT COMPLETE / PRODUCTION NO-GO**
>
> 증거 확인 창: **2026-08-04 22:40–23:00 KST**
>
> 저장소: `Kyu-Sung-Cho/wedding-hanbang-web`
>
> 브랜치: `agent/release-handoff-20260731`
>
> 구현·운영 감사 기준 HEAD: `a4f3626e5f98772b340b358b00a562b4692254fd`
>
> 이 인수인계 문서의 최초 게시 commit: `aaddd8ee23e5c83ac99784eb57b9a57c4c56af73`
>
> PR: [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79) — **OPEN / DRAFT / 최종 Quality Gate FAILURE**

이 문서는 지금까지 만든 기능과 문서, 이번 개인정보·보안 감사에서 새로 확인한 위험,
실제로 검증한 증거, 아직 없는 외부 증거, 배포 판정과 다음 구현 순서를 한곳에 고정한다.
문서 작성 시점 이후 코드·DB·Storage·모바일 build·provider 설정 중 하나라도 바뀌면 이
판정을 자동 상속하지 말고 같은 절차로 다시 검증한다.

관련 목표 아키텍처:

- `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md`

관련 구현·운영 기록:

- `docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`
- `docs/operations/AMORA_SAFETY_RELEASE_HANDOFF_2026-08-04.md`
- `docs/operations/AMORA_CHAT_ATTACHMENT_ORPHAN_LIFECYCLE_RELEASE_CANDIDATE_2026-08-04.md`
- `docs/operations/COMMUNITY_DECISION_THREAD_P0_RELEASE_CANDIDATE_2026-08-04.md`
- `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
- `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`

---

## 1. 30초 결론

### 1.1 지금 배포해도 되는가

**아니다. 현재 브랜치 전체를 실제 소비자 production에 배포하면 안 된다.**

이 판정은 막연한 불안이 아니라 다음 독립 근거가 동시에 가리킨 결과다.

1. PR #79가 아직 Draft이고 review 승인이 없다.
2. 최신 GitHub Actions에서 일반 코드 품질 check는 통과했지만
   `Production Readiness: BLOCKED (Hosted Evidence Required)`와 최종 `Quality Gate`가
   실제로 실패했다.
3. Supabase successor manifest가 `deployment_blocked`이며 hosted staging, backup,
   hosted restore, Storage, finalizer 증거 5종이 모두 `missing`이다.
4. 개인정보 위협 정적 코드 감사에서 P0 5건의 실패 가능 경로가 현재 코드에 그대로 열려
   있다. 자동 RED·실운영 재현은 아직 하지 않았다.
5. 운영 읽기 전용 감사도 24개 중 22개만 통과했고, 저장 노트 2행의 성격이 미판정이며
   PITR가 비활성이다.
6. 최신 서명 production 모바일 build, 실제 두 계정·두 기기 E2E, provider 개인정보
   계약, 독립 침투 테스트와 개인정보 법률 검토가 없다.
7. 이번 개인정보 작업은 2,083줄의 목표 설계와 문서 연결이며 product code·DB·Storage
   구현 작업이 아니다.

### 1.2 지금 가능한 범위

- unit·PGlite 또는 명시적으로 격리된 non-production project의 synthetic 테스트: 가능
- 현재 이 컴퓨터의 `apps/web/.env.local` destination은 production audit 대상과 일치하므로
  로컬 앱·integration mutation 실행: 금지. 승인된 production read-only audit만 예외
- 격리된 non-production destination을 명시적으로 설정한 로컬 synthetic preview의
  비민감·비저장 shell QA: 가능
- hosted Vercel Preview 사용: 접근 보호, non-production destination, server/DB feature-off
  영수증을 먼저 확인한 경우에만 가능. 이번 감사는 현재 hosted Preview 사용을 승인하지 않음
- 실제 사용자 대화·커플 데이터·첨부·기억·push를 받는 production: 금지
- production Supabase migration apply: 금지
- Vercel production alias 승격: 금지
- EAS production build/submit: 현재 gate가 의도적으로 차단하며 실행 금지
- AI provider에 실제 민감 prompt 전송: P0-5가 닫힐 때까지 금지
- 공개 랜딩만 별도 배포: 이 브랜치 전체 승격으로 하지 않는다. 필요하면 clean commit과
  별도 release scope로 분리하고, 계정형 route·운영 credential·민감 기능을 server/DB에서
  닫은 뒤 새 build·smoke·source binding 영수증으로 다시 판정한다. 이 문서는 그 제한
  배포도 아직 승인하지 않는다.

### 1.3 소비자에게 지금 말할 수 있는 것

말할 수 있는 것:

- 개인정보와 커플 경계를 분리하는 목표 설계를 만들었다.
- 일반 회귀 테스트와 정적 release contract는 상당 부분 통과한다.
- 위험한 운영 승격을 자동으로 막는 fail-closed CI와 모바일 gate가 있다.
- 발견한 위험을 숨기지 않고 production NO-GO로 유지한다.

아직 말하면 안 되는 것:

- `나만 상담과 함께 대화가 완전히 분리됐다`
- `절대 유출되지 않는다`
- `삭제하면 모든 백업과 제공자에서 즉시 완전 삭제된다`
- `모든 테스트를 통과했으므로 배포 준비가 끝났다`
- `Vercel Preview가 성공했으므로 production도 안전하다`
- `한 대화이므로 모든 기록이 안전하게 이어진다`

---

## 2. 판정 방법과 증거 등급

이 문서의 중요한 주장은 다음처럼 구분한다.

| 등급 | 의미 | 이번 문서의 예 |
|---|---|---|
| `E` | 이번 세션에서 파일·명령·테스트·GitHub 상태로 직접 확인 | HEAD, CI 결과, 코드 순서, manifest 상태 |
| `S` | 저장소의 현재 정본·공식 외부 상태에서 확인 | PR #79, GitHub Actions job |
| `I` | E/S에서 나온 코드 기반 추론 | A 초안이 B bearer로 귀속되는 경합 결과 |
| `UNVERIFIED` | 필요한 운영·외부 증거를 확인하지 못함 | hosted migration 적용, 두 기기 E2E, provider 계약 |

다음은 완료 증거로 재사용하지 않는다.

- 날짜가 다른 과거 테스트 수치
- 다른 SHA의 Preview 또는 production 영수증
- PGlite만 통과한 SQL
- 문서의 체크 표시
- 로컬 Expo export
- 정적 manifest 검증
- `mergeable` 상태
- CI의 일반 품질 녹색만 있는 상태
- 사용자 화면 카피나 모델 응답

개인정보·보안 판단은 `PRINCIPLES.md`의 P6 출시 게이트를 우선한다. 기능 편의, 일정,
전환율, 이미 작성한 코드의 양은 P0/P1을 면제하지 않는다.

---

## 3. 정확한 source와 Git 상태

### 3.1 원격에 게시된 source snapshot

2026-08-04 22:40 KST에 `git fetch --prune origin` 뒤 확인한 값이다.

| 항목 | 값 | 해석 |
|---|---|---|
| local HEAD | `a4f3626e5f98772b340b358b00a562b4692254fd` | 현재 체크아웃된 게시 source |
| upstream HEAD | `a4f3626e5f98772b340b358b00a562b4692254fd` | local과 일치 |
| remote branch HEAD | `a4f3626e5f98772b340b358b00a562b4692254fd` | upstream과 일치 |
| `origin/main` | `0f84665e9b8828f30e5a83ca5854ef618c3f4518` | 현재 비교 기준 |
| merge base | `0f84665e9b8828f30e5a83ca5854ef618c3f4518` | branch가 main에서 직접 갈라짐 |
| main 대비 | 26 commits ahead | branch 규모가 커 독립 review가 필요 |
| 변경 규모 | 1,135 files, +252,664 / -24,316 | 통합 승격 위험이 큼 |

영역별 변경 파일 수:

| 영역 | 파일 수 |
|---|---:|
| `apps/web` | 831 |
| `apps/mobile` | 138 |
| `supabase/migrations` | 48 |
| `docs` | 41 |
| `scripts` | 32 |
| `packages/shared` | 20 |
| root/other | 16 |
| `supabase/release-candidates` | 4 |
| `supabase/platform-operations` | 3 |
| `supabase/release-manifests` | 1 |
| `.github` | 1 |

변경 규모가 크다는 사실만으로 결함이라고 단정하지 않는다. 다만 한 번의 production
승격에서 web, mobile, DB, Storage, AI, community를 함께 바꾸면 원인 격리와 rollback이
어려우므로 기능별 immutable release와 증거 분리가 필요하다.

### 3.2 작성 당시 로컬 문서 작업과 publication 상태

2026-08-04 23:00 KST audit baseline에서 이번 개인정보 작업은 아직 commit/push하지 않았다.
문서 최종화 기준 working tree는 다음 파일만 포함해야 한다. 마지막 검증에서
`git status --short`로 다시 대조한다.

- `AGENTS.md` — 목표 아키텍처와 현재 factual handoff 링크
- `README.md` — 새 컴퓨터 진입점에 현재 판정 링크
- `docs/README.md` — 문서 권한 최상단에 현재 판정 등록
- `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md` — 새 목표 아키텍처
- `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md` — 이 문서
- `docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md` — 개인정보 판정 우선 배너

위 목록 외 변경이 나타나면 이번 문서 작업으로 간주하지 말고 소유자와 의도를 확인한다.
이 baseline에는 publication receipt가 없다. 따라서 이 시점에는 다른 컴퓨터에서 문서가
보이지 않으며 GitHub에 있다고 말하지 않는다. 나중에 이 문서를 Git에서 읽고 있다면 이
문장을 현재 상태로 재사용하지 말고, 문서를 실제로 포함한 commit SHA, remote branch SHA,
PR check를 새 publication receipt로 확인한다.

| publication evidence | 작성 당시 상태 |
|---|---|
| document commit SHA | NOT CREATED |
| remote branch containing this document | NOT VERIFIED |
| PR checks for the document commit | NOT RUN |

#### 2026-08-04 23:14 KST 게시 갱신

위 표는 문서 작성 직전 audit baseline을 보존한 것이다. 이후 다음 publication evidence를
직접 확인했다.

| publication evidence | 확인값 |
|---|---|
| 문서 최초 게시 commit | `aaddd8ee23e5c83ac99784eb57b9a57c4c56af73` |
| local/upstream/remote branch | 위 SHA로 exact 일치 |
| Draft PR #79 head | 위 SHA로 갱신 |
| pre-push gate | typecheck·lint·test 8/8 task PASS, Turbo cache 8/8 |
| Vercel Preview check | SUCCESS — deployment completed |
| Static Release Contracts | SUCCESS |
| Production Readiness | FAILURE — hosted evidence 부재로 fail-closed |
| 새 CI run | [30917835270](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/30917835270), 나머지 일반 품질 job은 영수증 작성 시점 진행 중 |

이 게시 영수증을 추가한 후 remote HEAD는 더 새로울 수 있다. 문서에 적힌 SHA를 현재
branch tip으로 추정하지 말고 `git rev-parse HEAD`, `git rev-parse '@{u}'`와 PR head를 다시
확인한다. `aaddd8ee...`는 두 핵심 문서와 색인이 GitHub에서 최초로 복원 가능한 기준점이다.

### 3.3 목표 아키텍처 무결성

`docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md` 검증값:

| 항목 | 값 |
|---|---|
| 물리 줄 수 | 2,083 |
| code fence marker | 40 |
| SHA-256 | `0DCF185AAD80D570B86196E3A312FCFC840DC039A33B76ABD1DAD323A554261C` |
| 성격 | TARGET ARCHITECTURE |
| 구현 완료 여부 | 미완료 |
| 현재 release 판정 | 개인정보 안전 production NO-GO |

이 hash는 문서 내용이 바뀌면 무효다. commit/push 시 다시 계산하고 최종 commit SHA와 함께
새 영수증에 묶는다.

### 3.4 이번 branch의 26개 commit

| 순서 | commit | 날짜 | 제목 |
|---:|---|---|---|
| 1 | `04f0ea16` | 2026-07-31 | `chore(wip): preserve integrated 2026-07-31 snapshot` |
| 2 | `e4211676` | 2026-07-31 | `test: align integrated release contracts` |
| 3 | `441aa844` | 2026-07-31 | `docs: align production build fence contract` |
| 4 | `62f2035c` | 2026-07-31 | `test: stabilize shared-action migration integration checks` |
| 5 | `41686ad6` | 2026-07-31 | `test: bound PGlite workers for stable release checks` |
| 6 | `793603bb` | 2026-07-31 | `docs: record GitHub and preview release receipts` |
| 7 | `2a13e265` | 2026-07-31 | `test: retain worker throughput after targeted timeout fix` |
| 8 | `a7412a73` | 2026-07-31 | `docs: finalize portable release handoff` |
| 9 | `a66da0d8` | 2026-07-31 | `test: keep merged release checks within stable worker bound` |
| 10 | `61ea71c6` | 2026-07-31 | `docs: record stable merged-test bound` |
| 11 | `764fb213` | 2026-07-31 | `docs: clarify snapshot and mobile preview boundaries` |
| 12 | `a617d268` | 2026-08-03 | `feat: 아모라·커뮤니티 통합 인수인계 반영` |
| 13 | `94a430f9` | 2026-08-03 | `docs: 최종 검증 상태를 인수인계에 반영` |
| 14 | `f0ce08d1` | 2026-08-03 | `docs: 최종 검증 상태를 인수인계에 반영` |
| 15 | `54ee8f6c` | 2026-08-03 | `merge: 동시 인수인계 갱신 통합` |
| 16 | `6fd5f771` | 2026-08-03 | `docs: 웹 빌드 검증 증거 확정` |
| 17 | `1d672397` | 2026-08-03 | `docs: 다른 컴퓨터 개발 인수인계 최종화` |
| 18 | `bf4540ee` | 2026-08-03 | `fix: 웹 CI 검증 시간 예산 보정` |
| 19 | `6c3d5809` | 2026-08-03 | `docs: 모바일 우선 제품 완료 기준 정립` |
| 20 | `e10226b2` | 2026-08-03 | `test: 오늘의 한 가지 일시정지 날짜 안정화` |
| 21 | `97640916` | 2026-08-04 | `feat: 랜딩 첫 방문 경험과 신뢰 안내 개선` |
| 22 | `2d9e0710` | 2026-08-04 | `feat: 랜딩 전환과 배포 완성도 강화` |
| 23 | `c0c4ee73` | 2026-08-04 | `test: 랜딩 제품 방향 계약 갱신` |
| 24 | `cedd7a1b` | 2026-08-04 | `feat: harden Amora decision and community release candidate` |
| 25 | `7d39645d` | 2026-08-04 | `fix(qa): expand transferred Amora draft for review` |
| 26 | `a4f3626e` | 2026-08-04 | `docs: record Amora release candidate verification` |

이 표는 변경 이력을 찾는 색인이다. 각 commit 제목이 production 완료를 뜻하지 않는다.

---

## 4. PR·CI·Preview의 실제 상태

### 4.1 PR #79

2026-08-04 확인값:

| 항목 | 값 |
|---|---|
| URL | `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79` |
| 상태 | OPEN |
| Draft | true |
| base | `main` |
| head | `agent/release-handoff-20260731` |
| head SHA | `a4f3626e5f98772b340b358b00a562b4692254fd` |
| mergeable | MERGEABLE |
| merge state | UNSTABLE |
| review decision | 없음 |
| submitted review | 0 |
| review request | 0 |
| 마지막 GitHub 갱신 | `2026-08-04T08:13:33Z` |

`MERGEABLE`은 Git 충돌을 자동 계산한 값일 뿐 개인정보·DB·운영 승인 상태가 아니다.
Draft와 review 없음, failed release-policy gate가 있는 상태에서 병합하지 않는다.

추가 governance 확인:

- 저장소에서 `CODEOWNERS` 파일을 찾지 못했다.
- 현재 private repository 요금제에서 branch protection API와 repository ruleset API는
  `403`으로 확인돼 required review·required check가 GitHub server에서 강제된다는 증거를
  확보하지 못했다.
- 따라서 maintainer가 버튼을 누를 수 있다는 사실과 release 승인을 분리해야 한다.
- production 병합 전에는 최소 2인 review, security/privacy owner 승인과 exact check list를
  별도 운영 절차 또는 지원되는 GitHub protection으로 강제한다.

### 4.2 최신 CI run

GitHub Actions [run 30890978893](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/30890978893)의
현재 결과:

| check | 결과 | 의미 |
|---|---|---|
| Web Quality | SUCCESS | 일반 웹 품질 회귀 신호 |
| Mobile Quality | SUCCESS | 일반 모바일 품질 회귀 신호 |
| Vendor Disclosure Quality | SUCCESS | 업체 공시 정적/테스트 신호 |
| Static Release Contracts (Non-Deploy) | SUCCESS | 정적 contract만 검증, 배포 아님 |
| Code Quality (breakage signal only) | SUCCESS | 이름 그대로 파손 신호만 의미 |
| Vercel | SUCCESS | Preview deployment check |
| Vercel Preview Comments | SUCCESS | Preview integration |
| Production Readiness: BLOCKED | **FAILURE** | 현재 workflow의 수동 release fence가 무조건 fail-closed |
| Quality Gate | **FAILURE** | production readiness failure를 포함한 최종 실패 |

`.github/workflows/ci.yml:189-204`의 `production_readiness` job은 hosted evidence를 동적으로
검사하지 않고 현재 항상 `exit 1`하는 수동 release fence다. 별도로 successor manifest도
운영 증거 5종을 모두 `missing`으로 기록한다. 따라서 증거를 나중에 만들더라도 workflow와
release controller를 검토·갱신해 exact receipt를 검증하게 만들고 다시 통과시키기 전에는
자동으로 green이 되지 않는다. `.github/workflows/ci.yml:244-267`은 이 실패를 최종 Quality
Gate에 포함한다. 빨간 check를 “의도된 실패니까 무시해도 된다”고 해석하지 않는다.

### 4.3 Preview가 증명한 것과 못 한 것

Preview 성공이 증명하는 범위:

- 해당 commit에서 Vercel이 preview artifact를 만들 수 있었다.
- 일부 public/synthetic 화면 QA의 진입점을 제공했다.

Preview 성공이 증명하지 않는 범위:

- production alias가 같은 source를 가리킴
- production 환경변수와 destination pin
- hosted migration 적용 순서와 RLS
- 실제 사용자 두 계정 격리
- Storage object lifecycle
- 모바일 binary와 OTA
- push delivery/tap/logout
- AI provider 보존 계약
- backup/restore
- rollback과 incident drill

과거 2026-07-31 Preview 영수증은 그때의 exact SHA 전용이다. 현재 `a4f3626e`나 앞으로
생길 문서 commit에 자동 상속하지 않는다.

---

## 5. 지금까지 실제로 한 작업

### 5.1 branch에 이미 구현된 제품 기반

기존 구현 handoff와 코드에서 다음 영역의 local release candidate가 확인된다.

- 아모라 웹·모바일 채팅과 서버 canonical ingest
- private/shared/direct lane 관련 UI와 일부 DB 경계
- 계정·커플 generation을 이용한 일부 late response 폐기
- AI 응답 안전 분류와 실행 분리
- 예산·할 일·일정 변경의 명시 승인·영수증 기반
- 장기 기억 후보와 default-off auxiliary memory
- 첨부 integrity metadata와 별도 Wave C lifecycle 후보
- 커뮤니티 신고·moderation·runtime control
- responder supply, comment/post service write 후보
- single-choice set-intent poll
- session-bound push token과 default-off delivery
- DecisionThread 질문·답변·적용성·해결·outcome loop
- 공개 랜딩의 신뢰 안내와 first-action 개선
- Supabase manifest·release controller·정적 fence
- 모바일 release-readiness fail-closed gate

각 항목은 코드가 존재한다는 뜻이며 운영 적용·실사용 안전을 보증하지 않는다. 자세한 파일
지도와 기존 테스트 수치는
`docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`를 따른다.

### 5.2 이번 개인정보·무누설 작업에서 한 일

이번 작업에서는 다음을 수행했다.

1. 나만 상담, 함께 AI, 파트너 직접 대화의 실제 코드 경로를 위협 관점으로 다시 읽었다.
2. 계정 전환, 커플 연결·해제, lane 전환, 지연 응답, offline retry, provider egress,
   Storage, Realtime, 알림, 삭제, 백업, OTA까지 공격면을 확장했다.
3. `한 진입점·두 공간·세 내부 lane` 제품 모델을 확정했다.
4. C0~C5 데이터 등급, actor, audience snapshot, epoch, recipient 모델을 설계했다.
5. 모든 mutation을 actor-bound command와 DB receipt로 만드는 목표 계약을 설계했다.
6. private 파생물의 provenance와 audience 상속, declassification의 exact preview·독립
   승인을 설계했다.
7. source의 공개권과 reader의 열람권을 분리했다.
8. provider token count·moderation·generation·tool/search/file을 모두 포함하는 egress gate를
   설계했다.
9. DB field encryption, object encryption, KMS key 분리, ID-only Realtime, BFF/decrypt
   gateway 전환을 설계했다.
10. HMAC-only invite, token-only pending, 양쪽 recent re-auth handshake를 설계했다.
11. attachment quarantine→scan→attach→publish saga와 보상 삭제를 설계했다.
12. Sentry·logger·PostHog·push의 content-free allowlist를 설계했다.
13. 계정 삭제, 커플 해제, shared data disposition, backup restore 후 tombstone 재적용,
    WORM deletion journal을 설계했다.
14. privacy center, export, retention, legal hold, operator access를 설계했다.
15. write/provider뿐 아니라 read/decrypt/Realtime kill switch를 설계했다.
16. P0 5건과 P1 목록, 공격 테스트, `COMMON_PRIVACY_BASELINE`, 단계 rollout과 출시 절대
    게이트를 작성했다.
17. 별도 AI 보조 적대적 문서 위협 재검토에서 발견된 원자성·principal·암호화·삭제·provider
    모순을 반영하고, 해당 문서 범위의 P0/P1 설계 모순 재검사를 통과했다. 이는 독립 전문
    보안 감사나 침투 테스트가 아니다.
18. `AGENTS.md`, `README.md`, `docs/README.md`에서 새 factual handoff와 목표 아키텍처를
    찾을 수 있게 연결했다.

### 5.3 이번 개인정보 작업에서 하지 않은 것

완료로 오해하지 않도록 0건을 명시한다.

| 작업 | 실행 수 | 현재 상태 |
|---|---:|---|
| product code 수정 | 0 | 미구현 |
| 새 privacy migration active 적용 | 0 | 미적용 |
| production DB write | 0 | 실행하지 않음 |
| hosted staging clone apply | 0 | 증거 없음 |
| Storage policy/object 변경 | 0 | 실행하지 않음 |
| Vercel production 승격 | 0 | 실행하지 않음 |
| EAS production build/submit | 0 | gate가 차단 |
| provider 조직 ZDR/MAM/DPA 확인 | 0 | 미검증 |
| 실계정 A/B 공격 E2E | 0 | 미검증 |
| 실기기 iOS/Android 공격 E2E | 0 | 미검증 |
| 독립 전문 침투 테스트 | 0 | 미실행 |
| 개인정보 영향평가·법률 검토 | 0 | 미실행 |

이번 작업에서 운영 DB는 변경하지 않았다. 읽기 전용 readiness audit은 aggregate count와
정책 상태만 확인했고 사용자 대화·노트 원문을 열람하거나 문서에 기록하지 않았다.

---

## 6. 최종 제품 구조 결정

### 6.1 한 채팅인가

사용자에게는 아모라라는 하나의 편안한 진입점을 제공한다. 그러나 개인정보와 책임 경계는
하나의 원문 timeline이나 하나의 AI context로 합치지 않는다.

```text
사용자 진입점: 아모라 하나

사용자에게 보이는 공간 2개
├─ 나만 상담
└─ 함께 대화

내부 실행 lane 3개
├─ private_ai      본인 + AI
├─ shared_ai       현재 승인된 커플 audience + AI
└─ shared_partner  현재 승인된 상대 수신자와 직접 메시지
```

### 6.2 반드시 분리되는 상태

다음은 lane 사이에 자동 이동하지 않는다.

- composer draft
- 전송 중 request
- canonical message
- attachment
- AI prompt/context
- memory
- summary
- saved note
- search index
- notification
- analytics/log/error payload
- community post draft
- budget/schedule/task proposal
- approval receipt
- deletion/retention 상태

private 내용을 shared/public으로 옮기는 것은 별도 declassification 명령이어야 한다.
사용자는 실제로 전달될 exact preview, 수신자, 파생 결과와 회수 한계를 보고 독립 승인한다.

### 6.3 공평성과 편의성

- 성별 역할이 아니라 stable member principal과 현재 권한으로 판단한다.
- 한 사람이 다른 사람의 동의를 대신 만들 수 없다.
- private 사용량·typing·presence·오류가 파트너에게 metadata로 새지 않는다.
- 공유 변경은 누가 제안하고 누가 승인했는지 영수증으로 남긴다.
- 연결 전 shared처럼 보이는 기록도 미래 파트너에게 자동 공개하지 않는다.
- 일정·예산 알림은 사용자 설정과 실제 공유 범위를 지키며 lock screen에는 민감 내용을
  넣지 않는다.
- 사용자가 실수했을 때 비난하지 않고 전송 보류, exact preview, Undo, 복구 경로를 준다.

### 6.4 소비자 카피 원칙

좋은 카피:

- `계정이 바뀌어 이전 초안을 보내지 않았어요.`
- `이 내용은 나만 상담에 남아 있어요.`
- `이전 계정의 초안은 이 계정에 표시하지 않았어요.`
- `김지은님과 공유할 새 문장만 확인해 주세요.`
- `연결 전 기록은 자동으로 공유하지 않아요.`
- `이전 대화를 내 화면에서 숨겼어요. 원문을 삭제한 것은 아니에요.`

금지 카피:

- `100% 안전합니다`
- `절대 유출되지 않습니다`
- `완전히 회수했습니다` — 이미 전달·열람됐을 가능성이 있을 때
- `AI가 개인정보를 모두 제거했습니다`
- `커플이니까 이전 공유 기록도 자동으로 보여드려요`

---

## 7. 유지할 현재 안전 기반

다음은 코드에서 확인한 긍정적 기반이다. 각 항목은 P0/P1이나 hosted 증거를 대신하지 않는다.

| 기반 | 확인 내용 | 남은 한계 |
|---|---|---|
| 서버 canonical context | AI 문맥을 클라이언트 임의 history가 아닌 canonical message로 재구성 | 저장 actor 자체가 잘못되면 canonical도 오염 |
| private context 분리 | private AI 문맥에서 partner direct 메시지를 제외 | 모든 파생물·검색·memory까지 아직 통합 증명 안 됨 |
| private owner RLS | private 메시지는 owner 중심 정책 | active/hosted policy와 구형 read path 미증명 |
| partner recipient fence | 현재 커플 구성에 맞는 recipient 검사 기반 | current-membership production 적용 미증명 |
| AI final commit epoch | AI 처리 중 privacy epoch 변경 시 최종 저장 차단 기반 | token-count 선행 egress는 이미 발생 가능 |
| private purge RPC | source-linked 여러 파생물 정리 | source 없는 note, backup, 외부 provider까지 완전하지 않음 |
| AI audit 최소화 | 질문·답변·tool 원문을 audit log에 직접 넣지 않는 helper | 모든 logger/Sentry/provider 경로 전수 증명 안 됨 |
| mobile Sentry/push 최소화 | 모바일 scrubber와 content-free push 기반 | web 중앙 scrubber와 실제 운영 canary 없음 |
| Wave B 후보 | authenticated direct chat INSERT를 닫는 후보 | active migration·hosted 적용·fleet cutover 미완료 |
| default-off 기능 | memory, media, push 등 기본 off 기반 | 모든 기능이 DB/server에서 공통 baseline을 강제하는지 미증명 |

현재 안전 기반은 버리지 않는다. P0 수정은 이 기반 위에 actor-bound command, provenance,
encryption, read boundary와 운영 증거를 더하는 방식으로 수행한다.

---

## 8. 출시 차단 P0 — 현재 코드 재검증

아래 5건은 2026-08-04 현재 HEAD의 정적 코드 경로 감사에서 모두 OPEN으로 재확인했다.
자동 RED 테스트와 실운영 재현은 아직 없으며 실제 사고가 발생했다고 주장하지 않는다.
그러나 경합을 막는 필수 서버·DB 불변식이 없어 배포 전 공격 테스트가 반드시 필요한
실패 가능 경로다. 단순 UX 문제가 아니라 다른 사람의 원문·동의·기억이 잘못 귀속되거나
외부 제공자에게 너무 일찍 나갈 수 있다.

### P0-1. A의 모바일 초안이 B bearer로 저장될 수 있음

**현재 코드 근거**

- `apps/mobile/app/(tabs)/chat.tsx:3046-3058`
- `apps/mobile/app/(tabs)/chat.tsx:3127-3177`
- `apps/mobile/app/(tabs)/chat.tsx:1355-1388`
- `apps/mobile/app/(tabs)/chat.tsx:1402-1424`
- `apps/mobile/app/(tabs)/chat.tsx:1941-1959`
- `apps/mobile/app/(tabs)/chat.tsx:2325-2331`
- `apps/web/src/app/api/chat/messages/route.ts:385-390`
- `apps/web/src/app/api/chat/messages/route.ts:436-470`
- `apps/web/src/app/api/chat/messages/route.ts:796-831`

**공격·실수 순서**

1. 사용자 A가 문장을 입력하고 전송을 시작한다.
2. draft와 UI 상태에는 A의 문장이 남아 있다.
3. request helper는 A에 결박된 token/lease를 받지 않고 호출 시점의 현재 Supabase session을
   다시 읽는다.
4. 그 사이 같은 기기에서 B로 계정 전환된다.
5. request는 B bearer로 서버에 도착한다.
6. 서버는 현재 bearer B와 현재 couple/role을 정상 actor로 판단한다.
7. A의 문장을 B `sender_id`/`sender_type`/visibility로 먼저 INSERT한다.
8. 모바일의 expected actor 확인은 응답 뒤라 이미 생성된 B 소유 row를 되돌리지 못한다.

**영향**

- A의 private 원문이 B 소유 private 메시지가 될 수 있다.
- A의 shared 문장이 B가 보낸 문장처럼 남을 수 있다.
- audit·삭제·memory·AI context의 소유권까지 연쇄 오염될 수 있다.

**즉시 containment**

- 모바일 계정 전환 시 composer subtree를 동기식으로 unmount한다.
- active request를 abort하고 이전 generation 응답·retry를 폐기한다.
- captured expected user/couple/lane이 없으면 전송 버튼을 disabled한다.
- 이 조치만으로 DB 저장 전 race를 완전히 닫았다고 간주하지 않는다.

**영구 수정**

- 서버 발급 composer lease에 actor, couple, member, lane, recipient, epoch, draft binding을
  묶는다.
- 클라이언트가 bearer만 보내는 대신 lease ID와 idempotency key를 전송한다.
- 단일 DB transaction에서 현재 auth principal, lease actor, membership/epoch, payload binding을
  다시 잠그고 검증한 뒤 canonical message와 receipt를 함께 만든다.
- mismatch는 `identity_changed`로 fail-closed하고 원문 row를 만들지 않는다.

**필수 RED 테스트**

- 같은 커플 A가 전송 시작→B 로그인→지연 request 도착 시 message row 0
- A private draft가 B private/shared/direct 어디에도 없음
- B가 다시 같은 operation key를 보내도 A payload receipt를 재사용하지 않음
- UI에는 중립 복구 문구만 표시되고 A 원문이 B 화면에 한 프레임도 없음

**종료 영수증**

- 실계정 A/B, 실제 DB transaction, offline retry, response loss, 구형 앱을 포함한 공격 시험
- wrong actor/scope/recipient row 0
- exact code SHA·DB migration·mobile build가 하나의 release receipt에 결박

### P0-2. A가 시작한 공동 승인 명령이 B 승인으로 기록될 수 있음

**현재 코드 근거**

- `apps/mobile/app/(tabs)/chat.tsx:1467-1531`
- `apps/web/src/app/api/amora/shared-actions/[actionId]/route.ts:136-168`
- `apps/web/src/app/api/amora/shared-actions/[actionId]/route.ts:223-285`

**실패 순서**

1. A 화면에 budget/schedule/task 공동 액션 승인 버튼이 보인다.
2. A가 버튼을 누르지만 helper는 actor/generation/expected user를 명령 envelope에 넣지 않는다.
3. account switch 뒤 호출 시점 bearer가 B가 된다.
4. 서버는 현재 bearer B를 `p_user_id`로 RPC에 넘긴다.
5. B가 누르지 않은 동의가 B의 승인으로 기록될 수 있다.

**영향**

- 커플 의사결정과 예산·일정 변경 동의를 위조한다.
- `decision_nodes`와 감사 로그가 잘못된 actor를 정본으로 남길 수 있다.

**즉시 containment**

- account/lane generation 변화 시 승인 UI와 pending command를 즉시 폐기한다.
- captured actor가 현재 사용자와 다르면 request 자체를 보내지 않는다.

**영구 수정**

- shared action도 메시지와 동일한 actor-bound lease/command receipt protocol을 사용한다.
- action version, actor, couple member, membership epoch, exact proposal digest를 DB transaction에서
  검증한다.
- 재시도는 exact actor+payload만 같은 receipt를 반환한다.

**필수 RED 테스트**

- A click 뒤 B switch 시 approval/decision/budget/schedule row 0
- B의 독립 클릭 없이 B approval 0
- stale action version과 다른 payload replay는 conflict
- response loss 뒤 exact A replay는 중복 변경 없이 같은 receipt

#### 2026-08-05 갱신 — client containment 구현, 판정은 그대로 OPEN

branch `codex/amora-p02-approval-actor-20260805`(base `5b33c95b`).

**추가로 확인한 사실**

- 채팅 화면에는 이미 `chatSessionGenerationRef`와 `isCurrentChatSession(generation)`이
  있고 `onAuthStateChange`로 계정 변경도 감지한다. 그러나 그 검사는 **응답을 받은 뒤**에만
  실행된다. 서버가 이미 승인을 기록한 뒤라 되돌릴 수 없다.
- `requestAmoraSharedAction`은 호출 시점에 `supabase.auth.getSession()`을 다시 읽어
  그 토큰으로 요청했다. 누른 사람과 대조하지 않았고, 401 뒤 `refreshSession()` 재시도
  경로에도 같은 대조가 없었다.
- 이 화면은 `ForExpectedUser` 계열과 `ownerCoupleSessionFence`를 **0건** 사용한다.
  P0-1과 P0-2는 같은 화면의 같은 공백에서 나온다.

**한 일**

- `apps/mobile/src/lib/amoraSharedActionActorFence.mjs` 신규. 양쪽이 모두 사용자 ID
  형태이고 같은 사람일 때만 통과하며, 한쪽이라도 비었거나 형태가 아니면 같은 값이어도
  거부한다(fail-closed).
- `sessionUserIdRef`를 추가하고 `onAuthStateChange`의 early return **앞에서** 갱신한다.
  핸들러는 이 값을 동기적으로 읽어 요청에 싣는다.
- 공동 승인 GET·POST·DELETE·PUT 요청 5곳 전부를 누른 사람에 결박했다. 불일치면
  **요청을 보내지 않는다.** `refreshSession()` 뒤에도 다시 대조한다.
- 기존 `pendingAmoraAction.test.mjs`가 호출 인자를 문자열로 고정하고 있어 깨졌다.
  원래 의도(전송 전 lease 획득, 재시도 시 durable 확인 우선)를 유지하면서 actor 결박까지
  요구하도록 **강화**해 갱신했다. 약화시키지 않았다.

**하지 않은 일 — P0-2가 아직 OPEN인 이유**

| 남은 작업 | 상태 |
|---|---|
| 서버 actor-bound lease/command receipt | 미구현 |
| action version·membership epoch·proposal digest의 DB 검증 | 미구현 |
| exact actor+payload replay만 같은 receipt 반환 | 미구현 |
| 실계정 A/B 승인 경합 E2E | 없음 |

§8.6 원칙대로 **client 방어만으로 P0를 닫지 않는다.** 서버는 여전히 현재 bearer를
`p_user_id`로 넘긴다. 이 변경은 같은 기기의 계정 전환 창을 좁힐 뿐, 조작된 클라이언트나
직접 API 호출을 막지 못한다. production NO-GO 판정은 그대로다.

### P0-3. provenance 없는 private 내용을 공유 note로 저장할 수 있음

**현재 코드 근거**

- `apps/web/src/app/api/amora/notes/route.ts:176-224`
- `supabase/migrations/20260726120000_amora_saved_notes.sql:86-103`
- `supabase/migrations/20260731173000_private_chat_hard_delete_boundary.sql:323-331`

**현재 동작**

- API는 임의 `content`를 받는다.
- `messageId`는 선택적 UUID일 뿐 canonical source를 반드시 조회하지 않는다.
- source visibility/audience 상속과 declassification 승인이 없다.
- 현재 couple 공유 note로 본문을 그대로 INSERT한다.
- RLS는 커플 전체가 읽게 한다.
- `messageId=null`이면 private purge의 source-linked 정리에서도 빠질 수 있다.

**영향**

- private 상담을 복사해 provenance 없는 shared 파생물로 영구 보존할 수 있다.
- 사용자가 private 원문을 삭제해도 공유 note가 남을 수 있다.
- 누가 어떤 source에서 어떤 승인으로 공개했는지 설명할 수 없다.

**즉시 containment**

- private 또는 source 불명 본문으로 note 생성하는 route를 server-off한다.
- source가 없는 arbitrary content note를 새로 만들지 않는다.
- 기존 2행은 삭제하지 말고 owner/audience/provenance를 비노출 방식으로 조사한다.

**영구 수정**

- note는 canonical artifact ID만 source로 받는다.
- 중앙 artifact registry와 normalized audience row에서 source public rights와 read rights를
  분리 검증한다.
- private→shared는 exact preview, recipient, independent approval이 있는 declassification
  grant를 요구한다.
- note와 provenance edge, audience snapshot, command receipt를 같은 transaction에 만든다.

**필수 RED 테스트**

- private message ID로 shared note 직접 생성 거부
- `messageId=null` arbitrary content 거부
- 다른 user/couple source 거부
- source 삭제·동의 철회 뒤 note visibility/retention 정책 적용
- shared joint source는 필요한 모든 독립 승인 전 publish 0

### P0-4. A의 기억 응답이 계정 전환 뒤 B 화면에 표시될 수 있음

**현재 코드 근거**

- `apps/mobile/app/settings/amora-memory.tsx:77-102`
- `apps/mobile/src/lib/api.ts:122-152`
- `apps/mobile/src/lib/api.ts:196-209`

**현재 동작**

- memory 화면의 `load`는 요청 시작 identity를 캡처하지 않는다.
- auth subscription, AbortController, session generation 검사가 없다.
- 응답이 오면 무조건 `setData`, `setActiveVisibility`, `setLoading`을 호출한다.
- 공용 API에 expected-user helper가 이미 있지만 이 화면은 사용하지 않는다.

**영향**

- A 요청이 느린 동안 B로 전환하면 A memory가 B 화면 state에 들어간다.
- 화면, accessibility tree, screenshot snapshot에 민감 내용이 잠깐이라도 남을 수 있다.

**즉시·영구 수정**

- screen scope에 expected user/account/couple/privacy epoch/generation을 캡처한다.
- account transition 전에 state를 동기식으로 sealed/empty로 바꾼다.
- request를 abort하고 응답 시 scope를 다시 확인한다.
- `apiFetchForExpectedUser` 또는 더 강한 공통 owner-bound API를 사용한다.
- old response는 DOM/state/cache 어디에도 적용하지 않는다.

**필수 RED 테스트**

- A memory load pending→B login→A response 완료 시 B state/DOM에 A marker 0
- A→guest, A→다른 couple도 동일
- app background/resume와 offline retry 포함
- screen reader tree와 app-switch snapshot에도 A marker 0

### P0-5. OpenAI token count가 최종 개인정보 gate보다 먼저 원문을 전송함

**현재 코드 근거**

- `apps/web/src/lib/ai/auditedOpenAI.ts:216-243`
- `apps/web/src/lib/ai/auditedOpenAI.ts:284-299`
- `apps/web/src/lib/ai/openai.ts:560-573`
- `apps/web/src/lib/ai/openai.ts:632-646`

**현재 순서**

```text
full instructions/input/tools -> provider inputTokens.count()
                              -> beforeGeneration()
                              -> provider responses.create()
```

초기 환경 flag 검사가 있어도 token count와 최종 membership/capability/audit claim 사이에
unlink, delete, privacy epoch 증가, provider kill-switch 경합이 생길 수 있다. token count도
원문을 외부 provider에 보내는 content-bearing egress다.

**영향**

- 생성 call이 차단돼도 prompt 원문은 이미 provider에 도달할 수 있다.
- `provider call 0`·삭제·unlink·kill-switch 보장이 사실과 달라진다.

**즉시 containment**

- 실제 민감 prompt에 대한 provider 기능을 server-off한다.
- local deterministic token estimator를 쓰거나, provider count가 꼭 필요하면 generation과
  동일한 audited egress grant 뒤에만 수행한다.

**영구 수정**

- 모든 provider SDK 호출을 하나의 audited egress gateway로 모은다.
- token count, moderation, generation, file, tool, search를 gate 대상에 포함한다.
- DB에서 current principal, scope, privacy epoch, retention/provider policy, audit reservation,
  kill-switch를 claim한다.
- claim에는 short TTL과 exact content binding을 넣고 provider 호출 직전에 다시 검증한다.
- 응답 commit 때도 scope/epoch를 재검증한다.

**필수 RED 테스트**

- `beforeGeneration`/audit reservation 실패 시 provider method 호출 수 0
- count와 create 사이 unlink/delete/kill 시 create 0, stale receipt commit 0
- count 자체도 gate 전 호출 0
- stream/non-stream, tool/file/search 모든 path 동일
- provider mock이 원문 marker를 받지 않았음을 assertion

### 8.6 P0 종료 원칙

UI effect, 사후 응답 비교, 클라이언트 flag만으로 P0-1/P0-2를 닫지 않는다. 서버 command와
DB transaction, active RLS, old-client 차단, hosted A/B 공격시험이 함께 통과해야 `closed`다.

---

## 9. 출시 차단 P1과 구조적 잔여 위험

아래 항목은 목표 아키텍처 `§2.3`의 현재 P1이다. 해당 표면이 release scope에 닿으면
기능을 끄거나 P1을 닫아야 한다.

| ID | 현재 위험 | 필요한 방향 |
|---|---|---|
| P1-01 | 웹 계정·커플·파트너 전환 정리가 렌더 뒤 `useEffect`에 의존 | privacy composite key로 synchronous remount·state seal |
| P1-02 | URL/session raw prefill이 대상 확인 없이 `shared_ai` composer로 유입 | neutral handoff + exact destination preview |
| P1-03 | private 상담→community 변환이 정규식과 preview에 의존 | semantic safety review, source rights, explicit declassification |
| P1-04 | 연결 전 shared 기록이 미래 partner에게 current membership으로 보일 수 있음 | pre-link audience snapshot 봉인, opt-in import |
| P1-05 | authenticated direct `chat_messages` INSERT policy가 active 경로에 남음 | Wave B hosted apply + fleet cutover + direct path 0 증명 |
| P1-06 | attachment와 message가 원자 결합되지 않아 orphan 가능 | Wave C saga runtime, sweeper, receipt |
| P1-07 | 발급된 signed URL은 권한 변화와 동시에 자동 취소되지 않음 | 짧은 TTL·auth streaming proxy·revocation strategy |
| P1-08 | web Sentry에 mobile과 같은 중앙 원문 scrubber가 없음 | allowlist-only scrubber와 canary |
| P1-09 | 함께 대화 `새로 시작`은 원문 삭제가 아니라 cursor 이동 | UI 카피 정정, 삭제와 숨김 분리 |
| P1-10 | current-membership fence의 hosted 적용·동일성이 미증명 | exact remote ledger와 두 계정 RLS receipt |
| P1-11 | private AI 사용량이 couple quota/remaining 변화로 추론될 수 있음 | private metadata와 shared quota 분리 |
| P1-12 | invite code가 평문·비만료·재사용 가능 구조 | 128-bit+ HMAC-only, one-time, expiry, recipient binding |
| P1-13 | 모바일이 base `chat_messages`를 직접 read/Realtime | BFF/decrypt gateway, ID-only Realtime, old binary read 차단 |
| P1-14 | OTA가 앱스토어 심사와 별개의 민감 code plane | signed update, pinned channel/runtime, key custody |
| P1-15 | production OTA/EAS MFA·권한·wrong-key 시험 증거 없음 | 실제 계정·실기기 release receipt |
| P1-16 | 공개 demo에서 private draft가 shared composer에 남는 회귀가 재현됨 | exact deployment SHA에서 routing 회귀 0 |
| P1-17 | OpenAI 운영 org/project의 ZDR/MAM·region·DPA·삭제 계약 미증명 | 공식 계약·설정 evidence 또는 provider feature off |
| P1-18 | web SHA, mobile build, DB, Storage, provider가 하나의 receipt에 안 묶임 | 통합 immutable release receipt |

### 9.1 current-membership fence의 긴급 확인 필요

`docs/operations/CURRENT_COUPLE_MEMBERSHIP_PRIVACY_FENCE_2026-07-17.md`의 마지막 확인 상태는
production 미적용이다. 당시 읽기 전용 감사 기록에는 다음 위험 표식이 있었다.

- stale groom slot 34개
- 여러 couple을 참조한 user 3명
- 한 user의 최대 29 couple 참조
- 재사용 가능한 invite code가 있을 수 있는 ownerless shell 예상 33개

이 수치를 현재 production 사실로 재사용하면 안 된다. 이후 상태가 바뀌었을 수 있으며 이번
감사에서 같은 쿼리를 재실행하지 않았다. 그러나 최신 hosted apply receipt도 없고 current
manifest의 운영 증거 5종이 모두 missing이므로, **현재 적용 상태는 UNVERIFIED이고 마지막
기록은 위험**하다.

실제 production이 private/shared 데이터를 받고 있다면 다음을 일반 배포보다 먼저 한다.

1. 관련 shared/private read·write·Realtime 기능을 read-only 또는 disabled로 유지한다.
2. 원문을 출력하지 않는 읽기 전용 remote ledger와 membership anomaly 감사를 승인된
   운영 절차로 실행한다.
3. 노출 가능 범위가 확인되면 incident 절차와 개인정보 담당자 판단을 시작한다.
4. backup, 다른 hosted project restore, exact migration apply, A/B RLS 공격시험 뒤에만 연다.

### 9.2 추가 구조 감사에서 닫아야 할 항목

목표 문서 구현 전 다음 모순도 반드시 설계·migration에 반영한다.

- reserve와 commit을 별도 transaction으로 만들지 않는다. commit에서 actor, membership,
  epoch, payload binding을 다시 잠그거나 단일 원자 RPC로 합친다.
- `contentBindingHmac`는 client가 만들지 않고 server가 canonical bytes와 purpose/tenant/scope
  분리 key로 계산한다.
- broad `service_role` direct write를 허용한 채 `receiptless direct INSERT 0`이라고 주장하지
  않는다. app writer 전용 role/RPC와 권한 회수가 필요하다.
- private principal을 mutable couple member에만 묶지 않는다. stable user principal과
  `user_privacy_epoch`를 membership/security epoch와 분리한다.
- user, system worker, operator를 같은 actor처럼 처리하지 않는다. `principal_type`과
  capability/outbox claim을 정의한다.
- field encryption을 도입하기 전 mobile direct read/Realtime을 BFF 또는 ID-only event로
  전환한다.
- PostgreSQL과 Storage를 하나의 ACID transaction이라고 표현하지 않는다. quarantine 기반
  saga와 보상 작업을 사용한다.
- 계정 삭제 때 A의 private data와 B에게도 권리가 있는 shared data의 disposition을 분리한다.
- idempotency receipt tombstone을 offline retry 기간보다 오래 보존한다.
- restore 범위 밖의 append-only/WORM deletion journal을 둔다.
- retention class, expiry, legal hold, policy version을 schema에 둔다.
- additive schema→dual write→backfill→shadow read→old-client 차단→권한 회수 순으로 전환한다.

### 9.3 P1 코드 근거 지도

다음은 후속 구현자가 다시 찾지 않도록 현재 HEAD의 정확한 시작점을 고정한 것이다.

1. **웹 identity reset과 prefill**
   - `apps/web/src/components/app/chat/ChatContent.tsx:607-644` — 렌더 뒤 effect에서
     draft/attachment/tab/target 정리
   - `apps/web/src/app/(app)/chat/page.tsx:6` — privacy scope key remount 없음
   - `apps/web/src/components/app/chat/ChatContent.tsx:736-801` — handoff 수신
   - `apps/web/src/components/app/chat/ChatContent.tsx:776-791` — 대상 확인 없이
     `shared_ai` draft로 배치
2. **pre-link shared history**
   - `supabase/migrations/20260801090000_amora_chat_delivery_safety.sql:162-173`
   - `supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql:321-351`
   - `apps/mobile/app/(tabs)/chat.tsx:2056-2057`
   - `apps/mobile/app/(tabs)/chat.tsx:2120-2125`
   - 현재 couple과 shared 여부를 보지만 message 생성 시 audience snapshot/roster epoch가 없다.
3. **authenticated direct INSERT**
   - `supabase/migrations/20260801090000_amora_chat_delivery_safety.sql:216-246` —
     `FOR INSERT TO authenticated`
   - `supabase/release-candidates/`의 Wave B 폐쇄안은 active migration이 아니다.
4. **attachment orphan**
   - `apps/web/src/stores/chatStore.ts:2097-2173` — Storage를 먼저 업로드
   - `apps/web/src/stores/chatStore.ts:2181-2202` — 이후 message ingest
   - `apps/web/src/stores/chatStore.ts:2083-2095` — best-effort client cleanup
   - `apps/web/src/stores/chatStore.ts:2211-2219` — 응답 불명에서 cleanup하지 않는 경로
5. **signed URL**
   - `apps/web/src/app/api/chat/image-urls/route.ts:164-180` — 발급 때만 RLS 확인
   - `apps/web/src/app/api/chat/image-urls/route.ts:185-200` — service role로 3,600초 URL 발급
6. **web Sentry/logger**
   - `apps/web/sentry.server.config.ts:5-10`
   - `apps/web/sentry.edge.config.ts:5-10`
   - `apps/web/src/instrumentation-client.ts:13-21`
   - `apps/web/src/instrumentation-client.ts:32-47`
   - `apps/web/src/utils/log.ts:16-25` — 임의 payload를 `extra.payload`로 전달 가능
7. **couple quota side-channel**
   - `apps/web/src/app/api/chat/route.ts:699-726` — private/shared 모두 couple 기준
   - `apps/web/src/app/api/chat/route.ts:2945-2974`
   - `apps/web/src/app/api/chat/route.ts:3440-3466`
   - `apps/web/src/lib/ai/costGuard.ts:188-218`
   - `supabase/migrations/20260716097000_amora_atomic_cost_budget.sql:633-715`
8. **invite secret**
   - `supabase/migrations/20260714160000_harden_amora_privacy_boundaries.sql:201-227` —
     12 hex raw invite 생성·저장
   - 같은 migration `:489-500` — raw equality lookup
   - `apps/web/src/app/api/couple/code/route.ts:83-87`
   - `apps/web/src/app/api/couple/code/route.ts:130-175`
   - `apps/web/src/app/api/couple/link/route.ts:11-31` — process-local rate limit
9. **mobile plaintext/Realtime**
   - `apps/mobile/app/(tabs)/chat.tsx:2056-2138` — content/metadata direct SELECT
   - `apps/mobile/app/(tabs)/chat.tsx:2246-2316` — Realtime row를 직접 state에 반영
10. **함께 대화 화면 정리**
    - `apps/web/src/app/api/chat/messages/route.ts:1046-1053` — cursor update
    - 같은 route `:1065-1073` — hard delete는 410
    - `apps/web/src/components/app/chat/ChatContent.tsx:2350-2429` — 현재 UI는 원문과 AI
      문맥이 유지된다고 정직하게 안내
11. **private→community bridge**
    - `apps/web/src/components/app/chat/ChatContent.tsx:224-230`, `:331-355` — 제한된 client redact
    - `apps/web/src/app/api/community/posts/route.ts:720-742` — server PII detector
    - `apps/web/src/lib/community/publicPersonalInfo.ts:209-214` — detector 한계 명시
12. **OTA plane**
    - `apps/mobile/app.json:96-101` — runtimeVersion과 update URL
    - `apps/mobile/eas.json:36-47` — production channel

private→community CTA에는 별도 기능 결함도 있다. server는 UUID `idempotency-key` header를
필수로 요구하지만 `ChatContent.tsx`의 해당 fetch는 header를 보내지 않아 현재 요청은
400으로 실패한다. 이 상태는 우연히 publish를 막지만 안전 구현이 아니다. CTA를 고칠 때
idempotency header만 추가해 원문 전송을 다시 열지 말고 canonical source, provenance,
declassification receipt와 exact public preview를 함께 구현한다.

---

## 10. 표면별 현재 배포 판정

| 표면 | 현재 판정 | 근거 | 다음 승인 조건 |
|---|---|---|---|
| GitHub source | 기존 HEAD 게시됨 / 새 privacy 문서 미게시 | local=upstream=`a4f3626e`, working tree dirty | 문서 review·commit·push와 remote SHA 대조 |
| PR #79 | **NO-GO** | Draft, review 없음, 최종 release-policy gate 실패 | Ready 전환, review, release-policy checklist 전체 green |
| Vercel Preview | **UNVERIFIED ACCESS BOUNDARY — NOT AUTHORIZED** | artifact check는 성공했지만 현재 access protection·destination·feature flag 미확인 | 보호·non-prod destination·server/DB-off receipt |
| Production Web 전체 | **NO-GO** | current SHA production receipt·smoke 없음 | source binding, env pin, hosted DB, full gate |
| 공개 Landing만 | NOT AUTHORIZED YET | 과거 local/browser PASS는 있음 | 별도 clean scope, account routes server-off, 새 receipt |
| Amora private/shared/direct | **NO-GO** | P0 1~5, P1 read/write 경계 | P0/P1 closure와 A/B 공격시험 |
| AI provider | **UNVERIFIED — MUST BE OFF** | token-count 선행 egress, 운영 flag·계약 미증명 | 실제 OFF 확인, audited all-egress gate와 provider evidence |
| Memory | **UNVERIFIED — MUST BE OFF** | Wave A staged/default-off 계약은 있으나 hosted 값 미확인, P0-4 | 실제 OFF 확인, 독립 hosted receipt·opt-in·A/B/device test |
| Attachment | **UNVERIFIED — MUST BE OFF 또는 text-only** | Wave C runtime 미구현, hosted 값 미확인, orphan/signed URL | 실제 봉인 확인, lifecycle saga·sweeper·Storage receipt |
| Database migration | **BLOCKED** | manifest `deployment_blocked`, evidence 5종 missing | controller 순서와 hosted receipts 전부 |
| Storage | **BLOCKED** | candidate/runbook만 있고 hosted apply 없음 | inventory, backup, apply, verify, CDN drain |
| Community | **PRODUCTION NO-GO** | local candidate, 운영 공급/hosted evidence 없음 | 기존 community release gate 전체 |
| Push | **UNVERIFIED — MUST BE OFF** | default-off 계약은 있으나 hosted 값 미확인, provider/실기기 evidence 없음 | 실제 OFF 확인, consent·ticket/receipt/tap/logout canary |
| Mobile production | **BLOCKED** | release check가 production EAS를 provider 전에 차단 | 구현된 authorization gate, signed build, device QA |
| OTA | **BLOCKED** | signing/channel/runtime/EAS 권한 증거 없음 | pinned signature, wrong-key/channel test |
| Vendor/public pricing | 현재 운영 데이터 read-only 일부 PASS, 새 승격은 NO-GO | audit 22/24, branch 전체 gate fail | 실패 2건 판정과 독립 release scope |
| WeddingCode | 이번 감사에서 current production 재승인 안 함 | 개인정보 범위와 별도 | 해당 current gate와 exact SHA 검증 |

### 기능 ON의 공통 규칙

어떤 기능도 자기 migration/test만 통과했다고 켜지 않는다.

```text
FEATURE_ON = COMMON_PRIVACY_BASELINE
             AND feature_specific_receipt
             AND exact_release_binding
             AND no_open_P0_or_P1_in_scope
```

하나라도 false/unknown이면 server와 DB에서 OFF다. public env hint나 UI 숨김만으로 차단을
대체하지 않는다.

---

## 11. Supabase·운영 읽기 전용 확인

### 11.1 정적 release fence

2026-08-04 이번 세션에서 실행:

```powershell
corepack pnpm supabase:release:fence
```

결과:

- predecessor static manifest: PASS
- successor static manifest: PASS
- successor migration 수: 80
- 상태: `deployment_blocked`

`supabase/release-manifests/vendor-disclosure-v2-20260718.json:333-338`:

| 운영 증거 | 상태 |
|---|---|
| hosted staging | missing |
| backup | missing |
| hosted restore | missing |
| Storage | missing |
| finalizer | missing |

정적 PASS는 파일 순서와 hash contract가 맞는다는 뜻이다. DB에 적용됐다는 뜻이 아니다.

### 11.2 production readiness 읽기 전용 감사

이번 세션에서 저장소의 읽기 전용 감사 스크립트를 실행했다.

```powershell
corepack pnpm audit:production
```

결과: **22/24 통과, 2개 FAIL**

이 결과는 이번 terminal session에서 직접 확인한 `E`지만 별도 content-free receipt 파일을
생성하지 않은 **session-only evidence**다. 다른 컴퓨터나 release 승인에서 그대로 재사용하지
말고 승인된 read-only 절차로 다시 실행한다.

| receipt field | 값 |
|---|---|
| source SHA | `a4f3626e5f98772b340b358b00a562b4692254fd` |
| script | `scripts/audit/production-readiness-audit.mjs` |
| script SHA-256 | `D9FE4F7E6C7FE09A9F27F4DC71AC2BC0C88FE7702DD67E68CE232DF0E3309B80` |
| destination ref SHA-256 | `B390C1F8F7B7079E5DE180133E8FEBC577A6AD2F05D2513F7D930140F563A53E` |
| exact execution timestamp | UNPINNED — terminal output에 저장되지 않음 |
| semantic result | 22 PASS / 2 FAIL |
| process exit code | 0 — semantic FAIL과 다름 |
| durable external receipt | NOT CREATED |

통과한 주요 항목:

- 공개 가격·위약금 aggregate 정합
- 테스트 계정 잔여 0
- 공개 view와 비공개 table의 anon 경계
- 공개 view 내부 field 최소화
- couple 판정 RPC의 auth/anon 권한 경계
- saved note RLS 활성과 정책 수
- backup 존재와 최근 backup 시간 기준

실패한 항목:

1. `저장본 오염 없음` — `amora_saved_notes`가 0이어야 한다는 audit 기대와 달리 aggregate
   count가 2였다.
2. `PITR` — 비활성이다.

주의:

- 2행의 원문은 읽지 않았다.
- 실제 사용자 정당 데이터인지 과거 테스트/오염인지 이번 감사만으로 판단할 수 없다.
- 근거 없이 삭제하지 않는다. owner, source, audience, creation path, retention/provenance를
  비노출 운영 절차로 판정한다.
- audit script는 FAIL을 출력해도 현재 process exit code 0으로 끝난다. 따라서 이 명령의
  exit code만 보고 release gate PASS로 처리하면 안 된다.
- 스크립트 주석은 PITR 비활성을 `출시 차단 아님`으로 표현하지만, 사용자가 요구한 높은
  안정성 기준에서는 RPO·복구 책임의 명시적 위험 수용이나 동등한 복구 증거 없이
  production GO로 바꾸지 않는다.
- 최근 backup이 있다는 사실은 다른 hosted project restore 성공을 증명하지 않는다.

### 11.3 금지 작업

- `supabase db push`
- `--include-all`
- migration history repair 추측
- manifest 밖 SQL 수동 적용
- production service role을 이용한 임의 정리
- 2개 note를 조사 없이 삭제
- weak RLS로 rollback

모든 hosted 변경은 승인된 `supabase:release:apply` controller와 exact evidence bundle만 사용한다.

---

## 12. Mobile release 상태

이번 세션에서 실행:

```powershell
corepack pnpm mobile:release-check
```

결과: **104 passed, 0 warnings, 0 failures**

이 PASS가 확인한 중요한 사실 중 하나는 production EAS 명령이 현재 provider 실행 전에
fail-closed한다는 것이다.

- production EAS authorization은 구현 완료가 아니다.
- local Expo export는 signed EAS build가 아니다.
- iOS/Android store submit 영수증이 없다.
- 실제 두 사용자·두 기기 account switch/offline/Realtime/push 시험이 없다.
- OTA signing key, channel, runtime, EAS 권한/MFA evidence가 없다.

따라서 `104/104 PASS`를 모바일 출시 가능으로 번역하면 반대 의미가 된다. 현재 gate가
production build를 안전하게 막고 있음을 확인한 결과다.

---

## 13. 기존 로컬 검증 ledger의 올바른 해석

`docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`에는 같은 날 기존
source candidate에서 실행한 다음 이력이 있다.

| 과거 같은 날 검증 | 기록된 결과 | 현재 해석 |
|---|---|---|
| frozen install | PASS | dependency lock 재현성 이력 |
| dependency audit | 알려진 취약점 0 | dependency CVE 신호일 뿐 privacy 승인 아님 |
| monorepo typecheck/lint | PASS | 정적 품질 이력 |
| web Vitest | 588 files / 5,816 tests PASS | 기존 회귀 이력 |
| mobile tests | 425/425 PASS | 기존 회귀 이력 |
| repository/release tests | 273/273 PASS | 정적 controller contract 이력 |
| transferred draft regression | 2 files / 28 tests PASS | 104자 초안 가독성; routing 안전 시험 아님 |
| web production build | PASS | local build 가능 이력 |
| Expo export/release check | PASS | local bundle/export 이력 |
| static release fence | PASS / deployment_blocked | 운영 적용 차단을 확인 |
| browser QA | LIMITED PASS | synthetic preview-stub shell만 확인 |

> 기존 test suite의 성공은 이번에 발견한 P0 공격 시나리오가 테스트되거나 닫혔다는
> 의미가 아니다.

특히 다음 표현은 제한해서 읽는다.

- `웹·모바일이 server ingest를 사용한다`는 사실은 request가 작성자 A에 결박됐다는 증거가
  아니다.
- `late response를 폐기한다`는 일부 chat generation 방어이며 memory 화면과 DB 저장 전
  bearer race를 닫지 않는다.
- transferred draft PASS는 textarea 높이·가독성 시험이며 private/shared destination 시험이
  아니다.
- Wave A/B와 attachment Wave C 문서는 staged candidate다.
- neutral couple member 문서는 PLAN이며 미구현이다.
- 이전 OpenAI 계획의 cache 관련 주장은 current code의 explicit cache option과 실제 provider
  계약을 다시 대조해야 한다.

### 13.1 이번 문서 작업에서 새로 확인한 명령

| 명령·확인 | 결과 |
|---|---|
| `git fetch --prune origin` | PASS |
| local/upstream/remote SHA 비교 | exact 일치 `a4f3626e...` |
| `gh pr view 79` | OPEN / DRAFT / review 없음 |
| `gh pr checks 79` | 일반 품질 PASS, production/overall FAIL |
| `corepack pnpm supabase:release:fence` | static PASS / `deployment_blocked` |
| `corepack pnpm mobile:release-check` | 104/104 PASS / production EAS blocked |
| `corepack pnpm audit:production` | 22/24, 두 FAIL; 명령 exit는 0 |
| `corepack pnpm test:repo` | root exit 0; ingest step 성공, repository Node suite 273/273 PASS |
| 목표 문서 hash/줄/fence 검사 | 2,083 lines, 40 fences, hash 고정 |
| P0-1~P0-5 code recheck | 5건 모두 OPEN |

새 문서 편집 뒤에는 §21의 문서·Git 검증을 다시 실행한다.

---

## 14. 아직 없는 외부 증거

다음은 local test로 대체할 수 없다.

### 14.1 Git·review·배포

- clean commit의 exact SHA
- PR privacy/security reviewer 승인
- release-policy check 전체 green. hosted evidence를 검증하도록 production workflow/controller를
  갱신하고 exact receipt로 재실행
- production deployment ID와 source SHA binding
- production URL HTTP·CSP·auth·privacy smoke
- rollback 대상 artifact와 rehearsal

### 14.2 Database·RLS

- 실제 linked remote migration ledger와 exact pending set
- production schema와 local manifest 동일성
- clean commit 기준 logical backup
- 다른 hosted project restore 성공
- migration dry-run, 예상 row/grant/policy diff
- controller apply·postcondition·canary·finalizer receipt
- 실계정 A/B/다른 couple/탈퇴 user RLS 공격시험
- current-membership anomaly 재감사
- old-client direct read/write 차단

### 14.3 Storage·암호화

- bucket/policy digest
- object inventory와 원본 backup
- quarantine/scan/attach/publish saga 실제 실행
- orphan sweeper와 retry receipt
- signed URL 만료·권한 철회·CDN drain
- DB field ciphertext coverage 100%
- live plaintext 잔존 0 scanner
- KMS key 분리·rotation·restore
- backup plaintext 격리·만료·restore-before-open

### 14.4 Web·mobile·Realtime

- 실제 두 계정·두 기기 A↔B 전환
- private/shared/direct lane 전수
- offline→retry→response loss
- Realtime late event와 active socket revoke
- browser bfcache·SSR hydration·검색·최근 목록 격리
- iOS/Android signed production build
- VoiceOver/TalkBack/Dynamic Type/키보드 접근성
- app-switch snapshot/recent screen 민감 원문 0
- 구형 binary 업데이트·차단 UX
- OTA signed manifest, wrong-key/wrong-channel 시험

### 14.5 AI·관측·운영

- OpenAI org/project DPA, region, ZDR/MAM, abuse retention, deletion 계약
- 모든 SDK endpoint가 audited egress gateway를 통과한다는 증명
- Sentry/PostHog/log/push의 content-free production canary
- 운영자 MFA·최소권한·break-glass
- read/write/provider/decrypt/Realtime kill-switch 5초 전파 drill
- incident tabletop과 on-call owner/SLA
- 독립 전문 보안 감사·침투 테스트 P0/P1 closure
- 개인정보 영향평가, 국외 이전, 보유·삭제, 법적 보존 검토

### 14.6 제품 품질·성능·유통

- exact release의 핵심 기능 E2E와 실패 복구 E2E
- 실제 브라우저·실기기 UX와 접근성
- 예상 동시 사용자·메시지·Realtime·worker의 성능/부하 시험
- latency, error rate, queue depth, provider failure의 SLO와 alert
- controlled beta 지원 capacity와 escalation
- iOS App Store·Google Play 심사, 개인정보 label과 store listing 일치
- release별 observability dashboard와 rollback 판단 기준

---

## 15. 구현 순서 — 일정이 아니라 dependency 기준

모든 단계는 RED 테스트→최소 구현→표적 GREEN→회귀→hosted/device evidence 순으로 닫는다.
앞 단계가 실패하면 다음 기능을 켜지 않는다.

아래 Phase 0을 포함한 항목은 **TARGET CONTROL PLAN**이다. 현재 hosted flag, DB control key,
read/decrypt/Realtime kill switch의 실행 가능성과 실제 값은 미검증이다. 각 기능을 끄라는
문장을 이미 꺼져 있다는 사실로 해석하지 않는다. 현시점에 검증된 containment는 새
production 승격을 하지 않는 것이다. 운영이 이미 열려 있다면 담당자, exact control,
현재 값, negative probe와 receipt를 먼저 확인하고, OFF가 아니면 incident 절차로 봉인한다.

### Phase 0. 즉시 봉인

- private→public/community 자동 변환 server-off
- pre-link shared import off
- private-source shared note 생성 off
- attachment publish off 또는 text-only
- auxiliary memory off
- external push delivery off
- provider content egress off
- new invite 발급 off
- 위험 mutation/read의 `normal/read_only/disabled` control plane 확인
- production source/schema/storage drift read-only inventory

완료 조건:

- UI flag가 아니라 server/DB negative test에서 실제로 거부
- old client와 direct API도 우회 불가
- 어떤 기능이 왜 off인지 소비자 복구 카피 존재

### Phase 1. P0 RED 테스트와 identity containment

- P0-1 A draft→B bearer
- P0-2 A approval→B actor
- P0-3 private/arbitrary note→shared
- P0-4 memory late A→B UI
- P0-5 provider count-before-gate
- web composer synchronous remount
- neutral handoff prefill
- common expected user/generation/abort API

완료 조건:

- 테스트가 현재 코드에서 정확히 RED
- 최소 containment 뒤 GREEN
- containment가 permanent DB proof가 아님을 test 이름·문서에 유지

### Phase 2. Command v2와 DB 원자화

- stable user principal과 stable `couple_members`
- membership security epoch와 user privacy epoch 분리
- server-minted composer/action lease
- canonical content binding HMAC
- idempotency receipt와 terminal tombstone
- message/shared action/decision mutation의 단일 transaction
- system/operator principal과 capability/outbox claim
- old-client minimum version gate

완료 조건:

- actor/couple/member/epoch/lane/recipient/payload mismatch row 0
- exact replay만 동일 receipt
- response loss에도 duplicate side effect 0

### Phase 3. Provenance와 declassification

- 중앙 artifact registry
- normalized audience rows
- source public rights/read rights 분리
- immutable scope-aware provenance edge
- exact-preview declassification grant
- joint source의 필요한 모든 독립 승인
- notes canonical source화
- private→community bridge 안전화
- pre-link history 봉인

완료 조건:

- source 없는 shared/public 파생물 0
- audience가 source 허용 범위를 넓힐 때 grant 없으면 거부
- consent withdrawal 뒤 downstream visibility 반영

### Phase 3A. Memory Wave A 독립 승격

- default OFF를 server/worker/DB에서 강제
- source와 reply가 같은 허용 lane인지 검증
- A/B 전환·철회·삭제·unlink 공격시험
- memory content encryption과 retention
- hosted clone·backup/restore·apply receipt
- hosted staging/synthetic의 작은 opt-in canary

완료 조건:

- memory P0/P1 0
- private/shared memory 오노출 0
- auxiliary memory를 켜지 않아도 기본 제품이 정상
- Phase 4와 Phase 6 및 `COMMON_PRIVACY_BASELINE` 전에는 production canary를 하지 않음.
  production canary는 Phase 7의 전체 gate 뒤에만 수행

### Phase 4. Direct write/read 폐쇄

- v2 traffic/adoption telemetry는 content-free로 수집
- 구형 앱 mutation/read/subscription 차단
- Wave B 별도 immutable release
- app writer 전용 role/RPC
- authenticated/service receiptless direct INSERT 0
- broad service/admin general-user read 0
- user/list/search/Realtime owner-explicit read

완료 조건:

- hosted A/B/anon/service role matrix
- raw table read/write와 Realtime 원문 우회 0

### Phase 5. Attachment Wave C

- init session ledger
- quarantine object
- MIME/size/hash/virus validation
- DB attach transaction
- consumer-visible publish
- failure compensation·orphan sweeper
- short-lived URL 또는 auth streaming proxy
- account delete/retention/CDN drain

완료 조건:

- crash/race matrix 전수
- orphan·잘못된 audience object 0
- retry가 duplicate object/message를 만들지 않음

### Phase 6. 암호화·운영 권리·초대·OTA

- private/shared field encryption과 object envelope encryption
- BFF/decrypt gateway와 ID-only Realtime
- KMS 분리·rotation·restore
- HMAC-only 128-bit+ invite, one-time expiry, token-only pending
- 양쪽 independent recent re-auth handshake
- account deletion disposition matrix와 WORM journal
- export/privacy center/retention/legal hold
- OTA signing key custody, channel/runtime pin, EAS MFA

완료 조건:

- live plaintext 0, ciphertext coverage 100%
- restore 뒤 tombstone 재적용
- wrong invite/recipient/key/channel이 모두 fail-closed

### Phase 7. Hosted·device 공격시험과 제한 rollout

- clean immutable release receipt
- hosted staging apply와 rollback rehearsal
- 실계정 2개·실기기 2대·web 동시 matrix
- provider/log/push canary
- incident kill-switch drill
- independent pentest/privacy legal closure
- synthetic→내부 사용자→1%→5%→25%→50%→100%

각 production 단계는 최소 24시간 유지하고 대표 사용량이 부족하면 더 길게 본다. 잘못된
actor/scope/recipient, content telemetry, evidence drift가 1건이면 즉시 중단한다. 100% 뒤
최소 72시간 강화 모니터링한다.

---

## 16. 첫 구현 묶음의 정확한 작업 카드

### 카드 A — P0 test harness

산출물:

- mobile auth race fixture
- two-user same-couple fixture
- server provider spy
- DB row absence assertion
- DOM/state marker absence assertion

Definition of Done:

- P0 5개가 현재 코드에서 모두 RED
- 실패 이유가 timeout/flaky가 아니라 exact invariant mismatch
- 사용자 원문 대신 synthetic marker 사용

### 카드 B — expected principal 공통 계약

산출물:

- `ExpectedPrincipal`/`PrivacyScopeKey`
- expected user, account, couple, lane, epoch, generation
- abort와 stale response discard
- chat, shared action, memory 적용

주의:

- client expected principal은 containment다.
- client 값을 서버 권한 근거로 신뢰하지 않는다.

### 카드 C — command lease/RPC

산출물:

- server-minted lease schema
- canonical payload bytes와 HMAC binding
- single transaction reserve/validate/commit
- exact idempotency receipt
- message와 shared action의 공통 protocol

주의:

- reserve와 commit이 별도 transaction이면 commit 시 전 조건을 다시 lock/검증한다.
- `service_role` broad direct INSERT를 유지한 채 완료로 표시하지 않는다.

### 카드 D — notes 봉인과 provenance

산출물:

- arbitrary content route off
- canonical source required
- source/audience validation
- private→shared grant
- existing 2-row provenance investigation procedure

주의:

- 기존 행을 자동 삭제하지 않는다.
- 원문을 log·issue·문서에 복사하지 않는다.

### 카드 E — provider all-egress gateway

산출물:

- token count/moderation/generation/tool/file/search 공통 wrapper
- pre-egress DB claim
- content binding·TTL·kill switch
- response commit revalidation
- provider method call-count negative tests

### 카드 F — hosted truth inventory

산출물:

- exact remote ledger
- current membership anomaly count
- active policies/grants/functions digest
- old client access matrix
- content-free evidence bundle

주의:

- 먼저 read-only다.
- 이상 발견 시 migration apply보다 incident containment가 우선이다.

---

## 17. 출시 절대 게이트

목표 아키텍처 `§25`의 모든 체크리스트가 정본이다. 문장, 일정, 회의 승인으로 면제하지
않는다. 최소 핵심은 다음과 같다.

### 17.1 코드·명령

- [ ] P0-1~P0-5 수정·공격 테스트 통과
- [ ] 모든 mutation의 actor/couple/member/epoch/lane/recipient 서버 검증
- [ ] receipt 없는 direct INSERT 0
- [ ] exact replay 외 idempotency 충돌 fail-closed
- [ ] old-client mutation/read/Realtime 폐쇄

### 17.2 데이터·파생물

- [ ] private 파생물 audience 상속
- [ ] source public rights와 read rights 분리
- [ ] joint source 필요한 모든 독립 승인
- [ ] 연결 전 기록 자동 공개 0
- [ ] private activity metadata 추론 0
- [ ] live plaintext 0, ciphertext coverage 100%

### 17.3 AI·관측

- [ ] 모든 content-bearing provider egress가 최종 gate 뒤
- [ ] provider 운영 계약 evidence
- [ ] log·Sentry·analytics·push 원문 0
- [ ] provider/worker race와 kill-switch 시험

### 17.4 DB·Storage·복구

- [ ] current membership fence hosted 적용
- [ ] RLS·service/admin IDOR matrix
- [ ] attachment saga와 orphan/signed URL evidence
- [ ] DB·Storage backup과 다른 hosted project restore
- [ ] deletion tombstone/WORM journal restore
- [ ] retention/legal hold overdue·ownerless 0

### 17.5 기기·운영

- [ ] iOS/Android/web 두 계정·두 기기 matrix
- [ ] stale push tap·app snapshot·bfcache·SSR hydration 격리
- [ ] signed production OTA와 EAS 권한 evidence
- [ ] read/write/provider/decrypt/Realtime kill-switch drill
- [ ] exact release receipt
- [ ] 독립 감사 P0/P1 closure
- [ ] 개인정보 법률 검토

### 17.6 0이어야 하는 지표

- 잘못된 actor/scope/recipient 저장: 0
- private/shared/다른 커플 오노출: 0
- partner direct의 AI context 포함: 0
- stale epoch 성공: 0
- log·analytics·error·push 원문: 0
- privacy canary contamination: 0
- encryption cutover 뒤 live plaintext: 0
- release scope의 미해결 security P0/P1: 0
- owner/근거 없는 purge·legal hold: 0
- deployment evidence drift: 0

---

## 18. GO 판정의 Definition of Done

production GO는 다음 모두를 만족할 때만 가능하다.

1. 사용자는 하나의 편안한 진입점에서 두 공간을 이해하고 실제 audience를 항상 확인한다.
2. 세 lane의 draft, message, attachment, memory, context, search, notification이 자동 이동하지
   않는다.
3. 모든 mutation이 identity-bound command와 DB receipt를 사용한다.
4. 모든 artifact가 audience와 provenance를 가진다.
5. private/shared 범위를 넓히는 유일한 경로가 exact-preview declassification이다.
6. 연결·해제·계정 전환·offline·구형 앱·동시성에서 stale read/write가 0이다.
7. AI, attachment, push, logs, operator, backup도 동일 privacy lifecycle에 들어간다.
8. live plaintext가 0이고 backup 예외가 격리·만료·restore-before-open으로 증명된다.
9. exact code SHA, mobile build, OTA manifest, DB, Storage, provider가 하나의 receipt로 묶인다.
10. independent security/privacy review의 release-scope P0/P1이 0이다.
11. incident 때 write/provider뿐 아니라 read/decrypt/Realtime을 즉시 끌 수 있다.
12. 사용자가 삭제 의미, 회수 한계, 처리자와 보유 범위를 실제 행동 전에 이해한다.

이 privacy/security Definition of Done은 전체 제품 GO의 필요조건이지 충분조건이 아니다.
같은 exact release에서 기능 E2E, 실브라우저·실기기 UX, 접근성, 성능·부하, observability/SLO,
운영 지원 capacity, 앱스토어와 법률 gate도 모두 통과해야 한다.

모든 조건을 만족해도 `절대 유출 불가능`을 광고하지 않는다. 검증한 범위, 남은 한계와
사고 대응을 정확히 설명한다.

---

## 19. Rollback·사고 대응

이 절도 **TARGET RUNBOOK**이다. read/decrypt/Realtime kill switch, lease revoke, provenance graph,
통합 deletion journal이 현재 production에서 실행 가능하다는 증거는 없다. 따라서 실제 사고에
문서의 명령 이름을 추측 적용하지 않는다. 현재 검증된 안전 조치는 새 production을 열지
않는 것이며, 이미 열린 환경에서는 승인된 운영자가 실제 존재하는 control과 값을 확인하고
가장 강한 가용 차단을 적용한 뒤 receipt를 남긴다. 미구현 control은 incident backlog가
아니라 release blocker다.

### 19.1 privacy migration 실패

- 약한 과거 RLS나 direct client write를 복구 경로로 다시 열지 않는다.
- 해당 기능을 `read_only` 또는 `disabled`로 만든다.
- forward-only fix를 준비한다.
- release lock, backup, receipt, deletion journal을 보존한다.
- 데이터 손상 여부를 원문 노출 없이 판정한다.

### 19.2 오노출·잘못된 귀속 의심

1. incident ID와 책임자를 만든다.
2. 범위를 모르면 chat mutation/provider egress와 private/shared/direct read·decrypt·Realtime을
   모두 disabled한다.
3. session, lease, push token, signed URL issuance, privacy epoch를 폐기한다.
4. 원문을 incident log에 복사하지 않는다.
5. provenance graph로 message, reply, summary, memory, note, decision, attachment, notification,
   community 파생물을 추적한다.
6. 미발송 outbox 취소와 가능한 tombstone/purge를 수행한다.
7. 개인정보·법률 담당자가 통지 의무와 범위를 판단한다.
8. 사용자에게 범위, 이미 보였을 가능성, 조치와 남은 한계를 정확히 알린다.
9. synthetic canary와 공격 regression을 통과한 forward fix만 다시 연다.
10. 재활성화는 Privacy Owner와 Release Owner 2인 승인으로 한다.

### 19.3 즉시 중단 조건

- wrong actor/scope/recipient 1건
- private marker가 shared/public/provider/log/push에서 1건 발견
- migration/schema/storage digest drift
- delete/retention owner 없음
- kill-switch 전파 실패
- release receipt의 SHA/build/schema 불일치
- 예상하지 못한 direct table read/write

---

## 20. 다른 컴퓨터에서 이어가기

### 20.1 가장 먼저 알아야 할 점

2026-08-04 23:00 KST audit baseline에서 개인정보 문서는 로컬 미커밋 상태였다. 따라서 그
시점의 clone에는 이 문서가 내려오지 않는다. 나중에 이 문서를 Git에서 읽고 있다면 현재
remote branch가 이 파일을 포함하는지 실제 commit/PR receipt와 다음 명령으로 다시 확인한다.

```powershell
git log -- docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
```

`a4f3626e...`는 작성 전 원격 기준점이지 문서 publication commit이 아니다.

### 20.2 Windows PowerShell

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
git branch -vv
```

branch가 이미 있으면:

```powershell
git switch agent/release-handoff-20260731
git fetch --prune origin
git status --short --branch
git pull --ff-only
git rev-parse HEAD
git rev-parse '@{u}'
```

`git pull --ff-only`는 working tree가 clean이고 local branch가 upstream에 단순히 뒤처진 경우에만
실행한다. dirty 또는 diverged이면 pull/reset/rebase하지 말고 변경 소유자와 branch 상태를
확인한다.

### 20.3 먼저 읽을 순서

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `docs/README.md`
4. 이 문서
5. `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md`
6. `docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`
7. `docs/operations/AMORA_SAFETY_RELEASE_HANDOFF_2026-08-04.md`
8. `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
9. `docs/MOBILE_SETUP.md`
10. 변경할 영역의 release gate와 실제 코드·테스트

### 20.4 환경변수와 비밀

- Git에는 `apps/web/.env.example`과 `apps/mobile/.env.example`만 복사 기준으로 사용한다.
- 실제 secret은 승인된 secret manager에서 가져온다.
- service role, OpenAI key, Sentry token, EAS credential을 문서·issue·log에 넣지 않는다.
- `NEXT_PUBLIC_*`에 server secret을 넣지 않는다.
- 사용자 대화·note·backup payload를 테스트 fixture로 복사하지 않는다.
- production destination pin을 로컬 개발 편의를 위해 맞추지 않는다.
- 이 컴퓨터의 기존 `apps/web/.env.local`은 production audit destination과 일치했다. 그대로
  `dev:web`, integration mutation, seed, cleanup에 사용하지 않는다. 새 컴퓨터에도 복사하지
  않는다.

### 20.5 안전한 첫 검증

일반 repository 명령의 정본은 Node `>=22.13.0`, pnpm `11.7.0`이다. Expo local dev server는
별도 wrapper와 `docs/MOBILE_SETUP.md`가 지정한 Node `20.19.x` 경계를 따른다. terminal을
섞지 않는다.

```powershell
node --version
corepack pnpm --version
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm mobile:release-check
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
node --test scripts/tests/repository-handoff-docs.test.mjs
git diff --check
```

긴 전체 검증 전 P0 RED test를 작은 파일로 먼저 만든다. 실제 사용자/production data 대신
synthetic A/B marker를 사용한다.

새 구현은 1,135-file integration branch에 바로 섞지 않는다. 현재 audit baseline에서 작은
P0 test-only branch/PR을 만들고 RED 증거를 고정한 뒤, 기능별 최소 변경과 독립 review로
진행한다.

### 20.6 하지 말아야 할 것

- `git reset --hard`, 무단 `checkout --`, `git clean`
- `git add -A`로 범위 숨기기
- `supabase db push`
- migration history repair
- production alias 승격
- EAS production gate 우회
- memory/push/media/provider flag를 먼저 켜기
- 2개 saved note를 provenance 확인 없이 삭제
- `Production Readiness` 실패를 무시하고 merge
- 목표 아키텍처를 구현 완료로 표시

### 20.7 새 LLM에 그대로 전달할 첫 메시지

아래 블록을 새 LLM의 첫 요청으로 전달한다. 저장소 파일과 GitHub 상태를 직접 확인하기
전에는 문서의 숫자나 완료 판정을 현재 사실로 재사용하지 않게 한다.

```text
이 저장소의 현재 작업을 이어서 진행해 주세요.

1. 먼저 git status --short --branch, git fetch --prune origin,
   git rev-parse HEAD, git rev-parse '@{u}'를 실행해 로컬·원격 상태를 확인하세요.
2. PRINCIPLES.md, AGENTS.md, docs/README.md를 읽은 다음
   docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md와
   docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md를 처음부터 끝까지 읽으세요.
3. 현재 판정은 production NO-GO입니다. Supabase production write, migration apply,
   Vercel production 승격, EAS production build/submit, provider·memory·push·media flag 활성화를
   하지 마세요.
4. 다음 구현은 새 기능이 아니라 handoff §8의 P0-1~P0-5를 synthetic A/B marker로 재현하는
   작은 RED 테스트 묶음부터 시작하세요. 기존 사용자 변경을 지우거나 git reset/clean 하지
   마세요.
5. 코드를 수정하기 전에 현재 HEAD, dirty 파일, 확인한 P0 근거, 변경할 파일, 표적 테스트와
   중단 조건을 짧게 보고하세요.
6. 각 P0는 client UI 방어만으로 닫지 말고 server command, DB transaction/RLS, old-client
   차단, hosted A/B 증거가 모두 있어야 closed로 판정하세요.
7. 완료 보고에는 확인한 사실, 코드 기반 추론, 아직 없는 외부 증거를 분리하고 실제 성공한
   테스트·빌드·배포만 완료로 적으세요.
```

---

## 21. 문서 최종 검증 절차

이 문서를 수정한 작업자는 다음을 실행한다.

```powershell
git status --short --branch
git diff --check
node --test scripts/tests/repository-handoff-docs.test.mjs
corepack pnpm supabase:release:fence
corepack pnpm mobile:release-check
```

추가 문서 무결성 확인:

```powershell
$path = 'docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md'
(Get-Content -Encoding utf8 $path).Count
(Select-String -Path $path -Pattern '^```').Count
(Get-FileHash -Algorithm SHA256 $path).Hash
```

예상 값:

- 2,083 lines
- 40 fence markers
- `0DCF185AAD80D570B86196E3A312FCFC840DC039A33B76ABD1DAD323A554261C`

파일 경로 링크 검사는 문서 안의 backtick path를 실제 저장소와 대조한다. 비밀 pattern과
Unicode replacement character, trailing whitespace도 확인한다.

### commit/push 전 체크

- [ ] diff가 문서 범위만 포함한다.
- [ ] P0/P1이 완료로 잘못 바뀌지 않았다.
- [ ] production NO-GO가 상단과 표면별 표에서 일치한다.
- [ ] 최신 PR checks를 다시 조회했다.
- [ ] 문서 hash를 다시 계산했다.
- [ ] 실제 commit SHA를 후속 영수증에 기록했다.
- [ ] commit/push 권한을 명시적으로 확인했다.

---

## 22. 다음 작업자·소유자 체크리스트

작성 당시 운영 소유자는 문서에 배정되지 않았다.

| 역할 | 현재 상태 |
|---|---|
| Engineering Owner | UNASSIGNED |
| Database/Security Owner | UNASSIGNED |
| Mobile Owner | UNASSIGNED |
| Privacy/Legal Owner | UNASSIGNED |
| Incident Commander | UNASSIGNED |
| Release Owner | UNASSIGNED |

필수 owner가 `UNASSIGNED`인 동안 production 승인을 진행하지 않는다.

### Engineering

- [ ] P0 5개 RED test
- [ ] expected principal containment
- [ ] command lease/RPC
- [ ] notes provenance
- [ ] provider all-egress gateway
- [ ] direct read/write inventory

### Database/Security

- [ ] remote ledger read-only audit
- [ ] current membership anomaly 재확인
- [ ] staging clone·backup·restore
- [ ] RLS A/B/anon/service matrix
- [ ] encryption/KMS plan
- [ ] deletion/retention journal

### Mobile

- [ ] memory/account switch isolation
- [ ] composer/action actor binding
- [ ] old-client read/subscription cutoff
- [ ] signed EAS build
- [ ] OTA signature/channel/runtime
- [ ] two-device offline/push E2E

### Privacy/Legal

- [ ] 개인정보 처리 항목과 목적
- [ ] 국내외 처리자·국외 이전
- [ ] 보유·삭제·backup 예외
- [ ] 커플 shared data의 각 당사자 권리
- [ ] incident 통지 판단 체계
- [ ] 소비자 카피와 동의 UX

### Operations/Support

- [ ] Incident Commander, Privacy Owner, Release Owner
- [ ] on-call과 SLA
- [ ] break-glass/MFA
- [ ] kill-switch drill
- [ ] customer recovery scripts
- [ ] staged rollout 관찰과 stop criteria

---

## 23. 확정 사실·추론·미확인

### 이번 세션에서 확정한 사실

- 원격 branch HEAD는 `a4f3626e...`다.
- PR #79는 OPEN/DRAFT다.
- 일반 품질 check는 성공하고 production/overall gate는 실패했다.
- manifest는 `deployment_blocked`이고 운영 증거 5종이 missing이다.
- mobile release check는 104/104이며 production EAS를 차단한다.
- production read-only audit은 22/24이고 note count와 PITR가 실패했다.
- P0 5건의 실패 가능 정적 코드 경로가 현재 HEAD에 OPEN이다. 자동 RED·실운영 재현은 아직
  없다.
- 목표 아키텍처는 2,083줄이며 product code 구현이 아니다.

### 코드 기반 추론

- A draft/approval이 account switch 경합에서 B actor로 저장될 수 있다.
- provenance 없는 note가 private purge와 shared audience 경계를 우회할 수 있다.
- memory late response가 B 화면에 A data를 적용할 수 있다.
- generation을 막아도 token count에서 prompt가 먼저 provider에 나갈 수 있다.

### 아직 미확인

- 위 경합이 실제 production에서 발생했는지
- 2개 saved note가 정당한 사용자 데이터인지 오염인지
- current-membership fence가 현재 production에 어떤 형태로 적용됐는지
- 운영 데이터의 실제 노출 범위
- provider·Storage·OTA·signed build의 현재 외부 설정

미확인 사항을 사고 없음이나 안전 완료로 번역하지 않는다. 반대로 근거 없이 실제 유출이
발생했다고 단정하지도 않는다. 먼저 기능을 안전하게 제한하고 승인된 읽기 전용 증거를
수집한다.

---

## 24. 최종 판정

설계 문서 작성, 기존 대규모 회귀 테스트, 일반 CI 품질 check, 정적 manifest 검증은
완료됐다. 그러나 다음이 남아 있다.

- 현재 코드의 P0 5개 실패 가능 경로와 미작성 RED 테스트
- release scope에 닿는 master P1 18건과 §9.2의 추가 구조 항목
- current membership 운영 상태 미검증
- hosted staging/backup/restore/Storage/finalizer 증거 5종 부재
- production audit 두 실패와 exit-code gate 한계
- 실제 두 계정·두 기기·구형 앱·provider 공격시험 부재
- signed mobile/OTA와 production deployment receipt 부재
- 독립 보안·개인정보 법률 closure 부재

따라서 판정은 다음과 같다.

> **현재 아모라·DB·모바일·커뮤니티 통합 후보는 production에 배포할 수 없다.**
>
> **unit·PGlite 또는 격리된 non-production synthetic QA만 계속한다. 현재 production-bound
> local env로 앱·mutation을 실행하지 않는다. hosted Preview는 보호·destination·feature-off를
> 먼저 증명한 뒤에만 사용하고, 운영 위험 기능이 실제 OFF인지 확인해 아니면 즉시 봉인한다.**
>
> **다음 개발은 새 기능이 아니라 P0 RED 테스트와 identity-bound command부터 시작한다.**

이 판단은 제품을 멈추기 위한 것이 아니다. 예비 신부·신랑이 편하고 행복하게 준비하려면
실수 한 번이 다른 사람의 사적인 고민이나 동의로 바뀌지 않아야 한다. 지금의 가장 빠른
출시 경로는 위험을 문구로 덮는 것이 아니라, 작은 안전 범위를 정확히 닫고 증거와 함께
단계적으로 여는 것이다.

---

이 문서는 코드·GitHub·읽기 전용 운영 상태를 기반으로 한 AI 보조 감사와 인수인계다.
전문 보안 감사, 침투 테스트, 개인정보 영향평가 또는 법률 자문을 대체하지 않는다.
