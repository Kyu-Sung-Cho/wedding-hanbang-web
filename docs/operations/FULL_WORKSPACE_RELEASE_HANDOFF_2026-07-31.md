# 전체 작업 트리·릴리스 인계 — 2026-07-31

> [!IMPORTANT]
> **상태: REMOTE RELEASE CANDIDATE / PROTECTED PREVIEW / PRODUCTION DB NO-GO**
>
> 이 문서는 2026-07-31 협업으로 모인 현재 로컬 작업 트리와 각 릴리스 표면을 구분해
> 넘기는 source/release 상태 정본이다. 제품 방향 정본은 계속
> `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`다.
>
> GitHub Draft PR과 보호형 Vercel Preview는 완료했다. DB migration 적용, production
> 웹 배포, 커뮤니티 공개, 모바일 출시는 이 문서 작성만으로 승인되지 않는다.
> 명령·원격 commit·deployment receipt·운영 사후조건이 없는 항목은 완료가 아니다.

> [!TIP]
> **2026-08-02 다른 컴퓨터 개발 인계:** 최신 clone·환경·웹/모바일 연결·검증·남은
> 게이트는 `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`에서
> 시작한다. 이 문서의 2026-07-31 snapshot과 함께 읽되, 날짜가 더 최신인 검증 ledger를
> 우선한다.

> [!NOTE]
> **2026-08-02 DB 계약 동기화:** 로컬 successor manifest는 66개 migration,
> 마지막 `20260802240000_amora_memory_job_recovery.sql`까지 확장됐다.
> 아래의 “18개 migration”과 48개 digest 기록은 2026-07-31 snapshot 설명이다. 후속 migration은
> hosted 적용·backup·restore·canary 증거가 없고 DB 상태는 계속 **BLOCKED**다.

> [!NOTE]
> **2026-08-02 커뮤니티·후속 구현 보충 인계:** 검색 우선 커뮤니티 홈, 글 상세의
> 진행 상태·작성 출처·광고 표시, 사람 답변 뒤 아모라 연결, 그리고 함께 쌓인 아모라·
> 모바일·공유 계약·18개 후속 migration의 상세 범위는
> `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`에 기록한다.
> 이 보충 문서도 배포나 DB 적용 승인이 아니다.

> [!WARNING]
> **2026-08-03 현재 source 경계:** 통합 구현 anchor는
> `a617d268cdadd9d7a348222942b0f0e1851467de`이며 `764fb213` 대비 478 files,
> +79,766 / -5,293이다. 이 문서를 포함한 실제 재개 기준은
> `origin/agent/release-handoff-20260731` 최신 HEAD다. 아래 2026-07-31 inventory는 당시
> dirty worktree의 역사 기록이며 현재 478-file 구현 목록이 아니다.
>
> 기존 Preview receipt `dpl_CByALSMu1zcnLPudFDmnCSM9egMC`는 code SHA
> `41686ad60721092b6f1fd7088cb674ed5e7b43eb`에만 묶인다. 따라서 현재 통합 구현의
> Preview·로그인·브라우저 QA 증거로 상속하지 않는다. 최신 source binding은 PR #79에서
> 다시 확인하며, 일치하지 않으면 **UNVERIFIED**로 유지한다.

## 1. 30초 요약

현재 제품 정의는 다음 한 문장이다.

**웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는
서비스입니다.**

이번 협업의 중심은 “기능이 많은 웨딩 사이트”가 아니라, 첫 방문자가 결혼의 감정과
아모라의 실제 역할을 3초 안에 이해하고 두 사람이 함께 준비하고 싶어지는 제품으로
정리하는 것이었다. 그 과정에서 랜딩만 고친 것이 아니라 아모라 승인 경계, 커플 공동
변경, 비공개 상담, 커뮤니티 신뢰, WeddingCode, 견적·공시, 모바일, DB migration,
QA·릴리스 컨트롤러까지 큰 mixed worktree가 만들어졌다.

이 후보 전체가 아직 하나의 production release는 아니다. 현재 운영 웹은 아래 base
commit의 READY 배포이고, 새 작업 트리는 GitHub Draft PR과 Vercel 보호형 Preview까지
배포됐다. DB·Community·Mobile production gate는 계속 닫혀 있다.

## 2. 표면별 현재 상태

| 표면 | 현재 판정 | 직접 확인된 경계 |
|---|---|---|
| GitHub | **PUSHED / DRAFT PR** | `agent/release-handoff-20260731`을 origin에 push했고 Draft PR [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79)를 열었다. |
| Production Web | **READY — base SHA `0f84665e9b8828f30e5a83ca5854ef618c3f4518`** | rollback 기준은 deployment `dpl_FHbiEU4qAVqPFTV6TzwmvmEFQvLL`, immutable URL `https://wedding-hanbang-o9fn2bc2c-hanbang.vercel.app`이다. live `https://hanbang.ai/landing?preview=final`은 HTTP 200이다. |
| New worktree | **PREVIEW READY / PRODUCTION BLOCKED** | Vercel branch alias `https://wedding-hanbang-web-git-agent-release-handoff-20260731-hanbang.vercel.app`이 Ready다. 최초 확인 receipt는 deployment `dpl_CByALSMu1zcnLPudFDmnCSM9egMC`와 code SHA `41686ad60721092b6f1fd7088cb674ed5e7b43eb`를 가리킨다. Preview는 Vercel Deployment Protection 뒤에 있고 production 승인이 아니다. |
| Database | **BLOCKED** | manifest는 `deployment_blocked`, 필수 운영 증거 5종은 `missing`이다. 2026-08-02 로컬 manifest는 66개로 확장됐지만 후속 migration의 hosted 적용 증거가 없고, 현재 hosted pending set은 이번 sync에서 다시 조회하지 않았다. |
| Community | **NO-GO** | 로컬 후보와 운영 공개는 별개다. 운영 DB·사람 답변 공급·신고 훈련·법률 검토가 없다. 쓰기를 열지 않는다. |
| Mobile | **NOT RELEASED** | 이 컴퓨터의 global EAS CLI 18.7은 로그인되지 않았고, 저장소의 production gate는 의도적으로 미구현 상태다. 서명 빌드·실기기 증거가 없다. |

한 표면의 성공을 다른 표면으로 전이하지 않는다. 예를 들어 GitHub push는 배포가 아니고,
로컬 build는 운영 DB 적용이나 Vercel production READY를 증명하지 않는다.

## 3. 권한과 증거 규칙

문서 충돌 시 다음 순서를 따른다.

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
4. 이 문서 — 현재 source/release 상태
5. 영역별 현재 게이트
   - `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`
   - `docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`
   - `docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md`
   - `docs/wedding-code/README.md`
6. 실제 코드·테스트·최신 migration
7. 2026-07-30 이전 감사·인계·계획 문서

이 문서는 영역별 안전 게이트를 덮어쓰지 않는다. 특히 DB와 커뮤니티의 `BLOCKED`·
`NO-GO`는 실제 receipt 없이 문구로 해제할 수 없다.

증거 상태는 다음처럼 읽는다.

- `EVIDENCED`: 같은 source state의 명령 결과, 원격 receipt 또는 실제 화면으로 확인
- `PARTIAL`: 일부 계약만 확인했고 전체 흐름은 확인하지 않음
- `UNVERIFIED`: 확인하지 않았거나 현재 source가 확인 뒤 바뀜
- `BLOCKED`: 명시적 게이트가 실행을 금지
- `NOT RELEASED`: 대상 release 자체를 수행하지 않음

## 4. source snapshot과 기계 판독 인벤토리

- 로컬 branch: `agent/release-handoff-20260731`
- origin: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git`
- base `HEAD`: `0f84665e9b8828f30e5a83ca5854ef618c3f4518`
- `origin/main`: `0f84665e9b8828f30e5a83ca5854ef618c3f4518`
- 최초 통합 snapshot commit:
  `04f0ea1603c4ebbe5e9018f17ada5e239ac508c7`
- 마지막 검증 code/config commit:
  `a66da0d8857e75eb404a7b9a34ff1069b6be889e`
- remote branch:
  `origin/agent/release-handoff-20260731`
- Draft PR:
  `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79`
- inventory 기준 명령: `git status --porcelain=v1 -uall`
- exact inventory:
  `docs/operations/evidence/full-workspace-release-inventory-2026-07-31.json`

일반 `git status`는 untracked directory를 한 줄로 접을 수 있어 항목 수가 달라진다.
따라서 이 문서의 “전체 파일”은 위 JSON의 `basis.entryCount`와 `entries`를 뜻한다.
JSON에는 경로와 상태 분류만 있으며 비밀값, 사용자 원문, 파일 본문, backup payload,
receipt 원문을 넣지 않았다.

각 inventory entry는 다음 필드만 가진다.

- `status`: Git porcelain 상태
- `path`: 저장소 상대 경로
- `area`: 기능 영역
- `releaseFacet`: web, database, community, mobile, release, documentation 등
- `intentStatus`: `confirmed` 또는 `review_required`
- `verificationStatus`: 현재 파일 단위 검증 상태

`confirmed`는 “운영 배포 승인”이 아니다. 이번 협업의 의도에 포함됐음만 뜻한다.
목적이 서로 다른 변경이 섞인 worktree이므로, 명시적으로 확인한 랜딩·문서 범위 외에는
보수적으로 `review_required`로 둔다. tracked 삭제 46개는 전부 `review_required`다.

## 5. 사용자와 확정한 제품·디자인 결정

### 첫 3초

- 첫 화면은 기능 목록보다 “우리, 정말 결혼하는구나”라는 감정을 먼저 만든다.
- 동시에 아모라가 무엇인지 숨기지 않는다:
  **둘이 함께 쓰는 결혼 준비 AI**다.
- 감정 문장 바로 아래에서 실제 결과를 설명한다. 두 사람이 말하면 아모라가
  예산·할 일·일정으로 정리하고, 확인한 변경만 반영한다.

### 아모라와 커플 준비

- 핵심 loop는 `둘이 말해요 → 아모라가 정리해요 → 확인 후 함께 반영해요`다.
- 모델 답변과 저장 성공을 같은 것으로 취급하지 않는다.
- 공동 계획 변경은 적용 전에 무엇이 바뀌는지 보여준다.
- 한쪽만 관리하는 도구가 아니라 파트너가 같은 준비 상태를 함께 확인하는 경험을
  전면에 둔다.
- “웨딩 준비방”처럼 실제 domain에 고정되지 않은 이름은 핵심 기능명으로 약속하지 않는다.

### 비공개와 신뢰

- `나만 상담`의 내용은 파트너에게 보이지 않는다는 경계를 화면에서 직접 알린다.
- 랜딩의 동작 예시는 로그인·저장 없이 작동하며 실제 저장이 아님을 표시한다.
- 가격·업체 영역은 공개된 출처·기준 시점·한계·수정 문의를 함께 보여준다.
- 유료 순위나 협찬이 사실 순위를 바꾸는 것처럼 보이게 하지 않는다.
- 가짜 후기, 근거 없는 이용자 수, 과장된 “최고·보장·완벽”을 쓰지 않는다.

### 시각 방향

- Paperlogy, Eucalyptus Ink, Dusty Mauve, Pearl Ivory, Sage 체계를 유지한다.
- 웨딩 사진은 장식 배경이 아니라 두 사람이 결혼을 체감하게 하는 첫 증거로 쓴다.
- 에디토리얼한 여백과 젊은 밀도를 사용하되, 작은 글자와 겹침으로 정보를 숨기지 않는다.
- 320/375/390px 모바일에서도 대화, D-day, 보조 CTA의 핵심 의미가 사라지지 않아야 한다.

## 6. 전체 변경 영역

정확한 파일 전수 목록은 inventory JSON이 담당하고, 아래 표는 사람이 이어받기 위한
영역 지도다.

| 영역 | 대표 경로 | 이 후보가 다루는 내용 | 현재 검증·릴리스 판정 |
|---|---|---|---|
| 랜딩·브랜드 | `apps/web/src/app/landing`, `apps/web/src/components/landing`, `apps/web/public/images` | 감정+기능 히어로, 무저장 상호작용 예시, 협업 loop, 근거 중심 신뢰 섹션, 반응형 에셋 | 랜딩 범위는 협업 의도 `confirmed`; 전체 candidate 배포는 안 됨 |
| 아모라 AI | `apps/web/src/lib/ai`, `apps/web/src/app/api/chat`, chat components | 승인 정책, atomic tool 경계, 기억·privacy context, feedback, 말투, 중재, 위기 안전 | 많은 표적 테스트가 존재하지만 현 source 전체 재검증 필요 |
| 커플 실행 도구 | dashboard, budget, schedule, onboarding, notifications | 둘이 보는 계획, 예산·일정·할 일 변경, 가입·초대 후 handoff | 운영 DB end-to-end `UNVERIFIED` |
| 견적·가격·업체 | quote check, price, vendor libs/pages | 비저장 견적 확인, 공개 가격 출처, 업체 identity·public field 경계 | DB migration·hosted data `BLOCKED` |
| 커뮤니티 | community UI/API/lib/admin | 사람 출처, 신고·moderation, reply notification, 운영 health, Wedding Court | 운영 공개 `NO-GO` |
| WeddingCode | constants, v0.6/v0.7/v0.8, scene/profile routes | 응답 요약 코드, 실제 선택 인용, fragment 공유, 다음 대화 | utility는 `UNVALIDATED`; 심리검사·궁합 주장 금지 |
| 모바일 | `apps/mobile` | 대시보드 경험, quote-check handoff, auth storage, 공통 준비 흐름 | `NOT RELEASED` |
| DB·RLS | `supabase/migrations`, manifest | 승인 ledger, privacy/delete, community trust, payment 기록 등 | manifest/controller `BLOCKED` |
| QA·운영 | `scripts`, package scripts, release controller | merged QA, dependency audit, community readiness, fail-closed release fence | 로컬 계약과 운영 receipt를 분리 |
| 문서·원칙 | root 기준서, `docs` | MVP 권한, 신뢰 경계, area gate, 이번 인계 | 이 문서 작업의 표적 검증만 별도 ledger에 기록 |

## 7. 랜딩 변경

### 히어로

- eyebrow는 아모라를 “둘이 함께 쓰는 결혼 준비 AI”로 설명한다.
- 큰 문장은 결혼의 감정과 기능 설명을 이어서 제시한다.
- CTA는 아모라 상담 진입을 가리키고, 비로그인 준비 순서 보기도 모바일에서 숨기지 않는다.
- 사진 위 정보 panel은 웨딩 사진과 두 사람을 과도하게 가리지 않아야 한다.
- 대화 sheet는 아모라가 제안한 일정 한 건을 사용자가 `이대로 적용`하는 흐름을 보여준다.
- 적용 후 상태와 다시 보기 동작을 제공하되, 실제 저장되지 않는 기능 예시임을 명시한다.

### 두 번째 이후 섹션

- 히어로와 같은 추상 문장을 반복하지 않고
  `이야기 → 변경 내용 확인 → 확인한 것만 남김`의 작동 원리를 설명한다.
- 공개 가격·조건은 별도 제품처럼 튀어나오지 않고 아모라가 선택을 도울 근거로 연결한다.
- 커플에게는 비교 근거, 업체에게는 조건·출처·수정 문의의 공정한 맥락을 제공한다.

### 아직 필요한 사람 검증

- 첫 방문자 5~8명에게 3초만 보여주고 무엇을 하는 서비스인지 그대로 말하게 한다.
- 실제 예비부부에게 결혼 감정, 기능 이해, 신뢰, CTA 의향을 따로 묻는다.
- “예쁘다” 평가만으로 핵심 loop 이해를 대체하지 않는다.

## 8. 아모라·커플 핵심 loop

현재 목표 흐름은 아래 다섯 단계다.

```text
사용자가 결혼 준비 상황을 말함
→ 아모라가 바뀔 예산·할 일·일정을 제안
→ 사용자가 변경 전후를 확인
→ 필요한 당사자가 승인
→ DB 결과를 확인한 뒤 실제 화면에 반영
```

실패하면 성공 문구를 보여주지 않고 재시도·수정·취소가 가능해야 한다. 공동 계획과
개인 상담은 별도 visibility와 소유권 경계를 사용한다.

이번 worktree에는 다음 계열의 구현과 회귀 테스트가 섞여 있다.

- 공유 action 승인·application claim·journey mutation receipt·상대 알림
- 수동 커플 plan change request/acceptance와 high-impact 양쪽 승인
- 아모라 도움 방식·말투 personalization
- private chat hard delete 뒤 derived memory 재생성 차단
- provider 호출 한 번에 사용할 privacy context snapshot
- chat feedback와 계정 삭제 경계
- conflict safety와 중재 동의

이는 파일 존재에 대한 설명이지 운영 반영 완료 주장이 아니다. 실제 계정 두 개와 운영과
같은 DB에서 승인·거부·동시 수정·실패 복구를 끝까지 확인해야 한다.

## 9. 예산·할 일·일정·대시보드

- canonical checklist와 준비 category를 웹·모바일 공유 상수로 정리하는 변경이 있다.
- 예식일, 장소, 예산이 비어 있을 때 임의 기본값을 사실처럼 만들지 않는 회귀가 있다.
- 파트너가 초대로 합류한 뒤 기존 계획을 읽기 전용 handoff로 먼저 보여주는 흐름이 있다.
- 일정 event는 날짜뿐 아니라 실행 책임·상태·source와 함께 다루는 변경이 있다.
- 예산과 payment ledger는 계획·지급 기록이지 결제·예약·전자계약·환불 판정이 아니다.

필수 hosted E2E:

1. 새 개인 계정 준비 시작
2. 파트너 초대와 합류
3. 같은 계획의 revision 확인
4. low/high-impact 변경 승인
5. 예산·일정·할 일 동시 수정 충돌
6. 알림 한 번만 생성
7. 실패 후 중복 반영 없이 재시도
8. 계정 탈퇴·커플 탈퇴·private delete 사후조건

## 10. 커뮤니티

커뮤니티는 아모라가 직접 겪을 수 없는 실제 경험의 빈칸을 채우는 보조 축이다. 초기
소비자 loop는 질문, 출처가 보이는 사람 답변, 재방문 알림, 해결 표시, 신고·통지·
이의제기다.

2026-08-02 후보에서는 검색과 사람의 해결 기록을 아모라 소개보다 먼저 두고, 글 상세에
질문의 진행 상태·작성 출처·광고 공개를 표시하며, 사람의 답변을 읽은 뒤에만 글 맥락을
아모라의 일정·예산·할 일로 잇도록 구성했다. 구현과 아직 남은 결정 네트워크·행복 층의
구분은 `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`를 따른다.

현재 후보에는 다음 계열이 있다.

- 미공개 AI persona activity retirement와 재발행 DB 차단
- 게시글·댓글 `content_origin`
- append-only moderation event와 사용자 notice
- API-only write boundary
- 댓글 idempotency와 reply notification
- cohort moderation 감사
- 운영 health aggregate RPC
- 정지 사용자 write 차단
- 검수된 합성 사건만 사용하는 Wedding Court

운영 공개 판정은 계속 `NO-GO`다. 상세 기준은
`docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`와
`docs/operations/COMMUNITY_LAUNCH_PLAYBOOK_2026-07-30.md`를 따른다. hosted E2E,
기존 콘텐츠 출처 전수 분류, 신고·복원 훈련, 개인정보·명예훼손·광고 검토, 사람 답변
공급 없이 쓰기를 열지 않는다.

## 11. WeddingCode

현재 공개 도구와 Candidate 연구를 섞지 않는다.

- 공개 도구는 사용자가 고른 답을 셈·인용하고 다음 대화를 돕는 utility다.
- 네 글자는 축별 응답의 요약이지 성격 유형이 아니다.
- 글자마다 응답 비율을 보여주고, 아슬한 글자는 다시 답하면 바뀔 수 있음을 알린다.
- 두 사람 코드를 궁합 점수로 합치지 않는다.
- 응답은 DB나 browser storage에 저장하지 않고 공유 답은 URL fragment에 둔다.
- 심리검사, 과학적 유형, 관계·결혼 성공 예측을 주장하지 않는다.

문항 이해도와 대화 유용성은 `UNVALIDATED`다. 인지면접, 실제 커플 사용성, 연구·
개인정보 검토가 필요하다. 현재 권한은 `docs/wedding-code/README.md`를 따른다.

## 12. 견적 체크·공개 가격·업체

- 견적 체크는 기본 비저장 분석이다.
- `포함`, `이용 안 함`, `확인 필요`를 구분한다.
- 가격이 싸다·비싸다, 업체가 좋다·나쁘다를 근거 없이 판정하지 않는다.
- 공개 가격은 원출처, 기준 시점, 제외 조건, 지역·상품 한계와 수정 문의를 함께 둔다.
- 업체명 정규화·병합은 사람 판정 근거 없이 자동 확정하지 않는다.
- 유료 노출·협찬이 있으면 사실·순위와 분리한다.

현재 production build fence는
`docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md`에 따라 `NO-GO`다.
로컬 synthetic catalog로 렌더된 화면은 운영 Supabase 데이터와 RLS를 증명하지 않는다.

## 13. 모바일

모바일 변경은 웹 MVP의 전면 release와 분리한다. 현재 worktree에는 dashboard 경험,
quote-check 연결, auth storage, wedding settings, 공통 계획·일정 흐름의 변경이 있다.

아직 없는 증거:

- EAS signed build ID
- iOS·Android 실기기 설치
- OAuth deep link와 웹 로그인 handoff
- offline/retry
- 작은 화면 safe area
- store privacy disclosure와 제출 receipt

따라서 모바일 상태는 `NOT RELEASED`다.

같은 감사에서 발견한 인증 차단 결함은 현재 로컬 후보에서 다음처럼 수정했다.

- 브라우저 저장소 write 실패 뒤 이전 session token이 부활하지 않게 했다.
- React Native Web 로그아웃을 무동작 `Alert.alert` callback에서 분리하고 sign-out
  실패를 사용자에게 남긴다.
- Expo Web social OAuth는 완료 가능한 callback 계약이 생길 때까지 안전하게 비활성
  안내하고, 설치형 native PKCE 경로는 유지했다.
- Kakao 버튼은 명시적 `EXPO_PUBLIC_KAKAO_OAUTH_ENABLED=true`일 때만 노출한다.
- Apple 깨진 glyph를 vector icon으로 바꿨다.
- session/profile/RLS 오류를 onboarding 미완료와 분리해 재시도 상태를 제공한다.
- 공개 community를 제외한 보호 tab에 공통 auth/onboarding gate를 적용했다.
- 앞뒤 공백이 있는 정상 email의 검증·trim을 일치시켰다.

수정 뒤 로컬 검증:

- 모바일 테스트 161/161
- mobile release readiness 104/104
- TypeScript·ESLint 통과
- Web/iOS/Android Expo export 통과

이 결과는 실제 유효 계정, signed iPhone/Android, Apple login, Kakao provider와 deep
link를 증명하지 않는다. 운영 Supabase에서 Kakao provider를 활성화한 뒤에만 해당
환경에서 `EXPO_PUBLIC_KAKAO_OAUTH_ENABLED=true`를 설정한다. 플랫폼별 실제 인증은
계속 `UNVERIFIED`다.

## 14. migration 전수

아래 16개 migration은 최초 통합 snapshot 직전에는 untracked source였고, 현재 후보
branch에는 `04f0ea16` snapshot commit으로 추적되어 있다. 운영 DB에는 적용되지 않았다.
manifest/controller의 정확한 순서·hash 검증과 hosted evidence 없이 직접 실행하지 않는다.

| 순서 | migration | 목적 | 적용·rollback 경계 |
|---:|---|---|---|
| 1 | `20260730100000_retire_undisclosed_community_agents.sql` | 미공개 AI persona activity 격리와 재활동 trigger 차단 | 운영 데이터 분류가 필요하며 과거 활동을 사람으로 복원하지 않는다. |
| 2 | `20260730101000_quote_check_explicit_consent.sql` | 견적 분석의 저장·vendor signal 동의와 기존 row 통계 격리 | 기존 자동 lead 병합은 read-only 감사 뒤 사람 판정이 필요하다. |
| 3 | `20260730102000_amora_shared_action_approval_and_notifications.sql` | journey revision, 공유 action 승인·claim·receipt·상대 알림 | DB write boundary이며 앱만 먼저 배포하면 안 된다. |
| 4 | `20260731123000_couple_plan_change_write_boundary.sql` | 수동 공동 계획 request/acceptance와 high-impact 양쪽 승인 | direct authenticated write를 닫고 service path를 사용한다. |
| 5 | `20260731170000_amora_personalization_preferences.sql` | 본인 전용 아모라 도움 방식 설정 | WeddingCode 원응답·성격·궁합을 저장하지 않는다. |
| 6 | `20260731173000_private_chat_hard_delete_boundary.sql` | private chat와 자동 파생 기억 hard delete, 이후 재생성 차단 | 삭제 사후조건과 동시 write를 hosted DB에서 검증한다. |
| 7 | `20260731174000_amora_privacy_context_snapshot.sql` | provider 호출용 request-scoped privacy snapshot | auth.uid와 현재 bilateral roster가 권한 정본이다. |
| 8 | `20260731180000_community_release_trust_boundary.sql` | content origin, moderation event·notice·appeal 신뢰 경계 | forward-only; provenance를 drop하는 rollback 금지. |
| 9 | `20260731181000_community_reply_notifications.sql` | comment idempotency와 답변 재방문 알림 | exact-once comment/count/notification E2E 필요. |
| 10 | `20260731182000_cohort_moderation_audit_boundary.sql` | cohort report review와 append-only audit | 사용자 notice·appeal 완결을 별도로 검증한다. |
| 11 | `20260731183000_community_operational_health.sql` | service-role 전용 aggregate 운영 health RPC | admin gate 뒤에서만 사용하며 member analytics가 아니다. |
| 12 | `20260731184000_amora_tone_style.sql` | personalization의 말투 설정과 v2 RPC | 기존 RPC 호환·기본 adaptive·current value 보존 확인 필요. |
| 13 | `20260731185000_community_api_only_write_boundary.sql` | PostgREST 직접 게시 우회 차단 | 모든 정상 쓰기가 server validation 경로를 통과해야 한다. |
| 14 | `20260731190000_wedding_court_safe_mvp.sql` | 검수 합성 사건과 안전한 투표 ledger | 실제 사연·자유 댓글·성별 팀·자동 계획 반영 없음. |
| 15 | `20260731191000_wedding_payment_ledger.sql` | 계약 금액·지급 진행의 커플 공동 기록 | 결제·예약·전자계약·환불 판정 기능이 아니다. |
| 16 | `20260731192000_chat_feedback_account_delete_cascade.sql` | feedback의 Auth 삭제 cascade와 legacy 원문 비식별화 | 삭제 전후 row·FK·보관 정책 사후검증 필요. |

2026-08-01~02 후속 로컬 계약에는 아래 18개가 추가됐다. 모두 hosted 미적용이며 별도
backup·restore·postcheck·rollback evidence 없이는 실행하지 않는다.

| 순서 | migration | 목적 | 적용·rollback 경계 |
|---:|---|---|---|
| 17 | `20260801090000_amora_chat_delivery_safety.sql` | 파트너 수신자 UUID 고정, 동시 roster 변경 잠금, SELECT/INSERT RLS 강화 | 기능 롤백과 무관하게 trigger·RLS 전달 경계를 유지한다. |
| 18 | `20260801100000_amora_conversation_segments.sql` | shared/private 원문 문맥 segment와 nullable message/summary FK 기반 | provider read flag는 false; 이미 기록된 segment 감사 연결은 down migration으로 제거하지 않는다. |
| 19 | `20260802090000_amora_moment_care_source_revision.sql` | 케어 순간의 근거 revision 고정 | 오래된 근거로 알림·행동을 확정하지 않는다. |
| 20 | `20260802100000_amora_shared_schedule_decision_receipts.sql` | 공동 일정 결정 영수증 | 취소·복원·승인 결과를 append-only 근거로 남긴다. |
| 21 | `20260802110000_amora_shared_schedule_approval_policy.sql` | 일정 영향도별 승인 정책 | 확정 사실 추가 외의 공유 변경은 커플 승인을 기본값으로 둔다. |
| 22 | `20260802120000_amora_conversation_segment_dual_write.sql` | 비활성 segment 이중 기록 기반 | read flag는 계속 false이고 사용자 채팅 분리는 아직 활성화하지 않는다. |
| 23 | `20260802130000_amora_in_app_today_one.sql` | 하루 한 가지 인앱 케어와 수신 설정 | opt-in 전에는 생성·발송하지 않고 outbound는 별도 gate로 둔다. |
| 24 | `20260802140000_amora_manual_schedule_fairness.sql` | 수동 일정 공동승인·취소·복원 원자성 | roster와 expected revision이 다르면 쓰지 않는다. |
| 25 | `20260802150000_amora_today_one_budget_guardrails.sql` | 예산 초과 신호의 보수적 케어 경계 | 불확실한 금액은 경고 확정 대신 검토 상태로 둔다. |
| 26 | `20260802160000_booking_quote_spend_soft_cancel.sql` | 견적 snapshot·지출 진실성·soft cancel | 2인 커플 실행기가 준비되기 전 공동 예약 변경은 fail-closed다. |
| 27 | `20260802170000_amora_shared_action_roster_binding.sql` | 공동 행동의 제안 당시 roster 고정 | 계정·커플 구성 변경 뒤 오래된 승인을 적용하지 않는다. |
| 28 | `20260802180000_community_cohort_assignment_atomic.sql` | 동기방 이동·정원·인원수의 단일 트랜잭션 | 중간 실패와 동시 30명 초과를 롤백·직렬화로 막는다. |
| 29 | `20260802190000_community_idempotent_writes.sql` | 명시적 북마크 상태와 동기방 메시지 request UUID | 응답 유실 재시도가 북마크를 반대로 뒤집거나 메시지를 중복 생성하지 않는다. |
| 30 | `20260802200000_journey_budget_progress_integrity.sql` | 예산 진행 record 무결성, 공동 지출 승인과 정확한 변경 요약 | service-only RPC에서 신규 쓰기를 검증하며 기존 저장 데이터는 그대로 둔다. 2인 커플의 지출 변경은 양측 승인 전 적용하지 않는다. |
| 31 | `20260802210000_amora_conversation_segment_roster_repair.sql` | 허용된 로스터 복구 시 비공개 segment 소유권 회전과 이전 구간 연결 | 영구 roster epoch/privacy fence는 유지한다. 과거 메시지·요약 링크를 옮기지 않고 stale active 구간만 닫는다. |
| 32 | `20260802220000_amora_memory_enqueue_repair.sql` | 저장 완료 뒤 enqueue 응답 유실로 누락된 exact W0/W1 메모리 job의 bounded 복구 | claim 완료와 같은 트랜잭션에서 content 없는 ID-only outbox를 남기고 service-role cron이 `FOR UPDATE SKIP LOCKED` oldest-first hard limit으로 기존 enqueue RPC를 재사용한다. terminal 결과만 배출하고 오류는 backoff 보존하며, W2~W5·legacy·malformed metadata는 캡처하지 않는다. 신규 outbox 테이블은 post-expand backup·restore 계약에 반드시 포함된다. |
| 33 | `20260802230000_amora_atomic_privacy_epoch.sql` | 로스터·기억 동의·reset·개인화 변경과 AI 답변 commit 사이의 TOCTOU 차단 | 커플별 privacy epoch를 변경 트랜잭션에서 증가시키고 terminal finalizer가 같은 epoch row를 잠근 뒤 expected epoch가 일치할 때만 답변을 저장한다. 불일치한 유료 생성은 content 없이 ledger만 정산하고 fail-closed하며, epoch 테이블은 post-expand backup·restore 계약에 반드시 포함된다. |
| 34 | `20260802240000_amora_memory_job_recovery.sql` | 메모리 enqueue 중복 증명·실패 job 재큐잉·영구 오류 격리 | `duplicate`를 성공으로 추정하지 않고 현재 로스터·visibility·동의·reset·source 및 구조적으로 유효한 job을 service-only RPC로 다시 증명한다. exact 실패 job만 worker 상태를 원자적으로 초기화해 재큐잉하고, scope·source·contract 영구 오류는 content 없는 ID-only dead-letter로 이동하며 transient SQLSTATE만 bounded backoff로 재시도한다. 런타임과 동의가 실제로 enqueue를 요청한 exact boolean metadata가 있는 W0/W1 turn만 outbox에 남겨 플래그 OFF backlog와 OFF→ON 과거 turn backfill을 막는다. 신규 dead-letter 테이블은 post-expand backup·restore 계약에 반드시 포함된다. |

현재 DB 정본은
`docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`다.
release manifest가 `deployment_blocked`인 동안 controller, remote fence, finalizer는
Git·Supabase·backup verifier를 호출하기 전에 멈춰야 한다.

현재 로컬 manifest 정적 사실:

- ordered migration 수: 66
- 마지막 version: `20260802240000`
- canonical manifest SHA-256:
  `7019565f14ab03b60a033ddb5dd56a9c7cd3b4a810aa2fdb9aa9448431fb8cad`
- versions digest:
  `96bc9d77687b502482f3bc361a5bce8c01f450d6ffd1f77488094221fee78360`
- 2026-08-02 현재 successor 정적 release-controller·인계 문서 관련 90개 테스트가 통과했다.

이것은 local static contract 증거다. 운영 DB의 pending migration, hosted
staging/restore, backup/storage/finalizer evidence를 대체하지 않는다.

## 15. 최초 snapshot의 tracked 삭제 46개

최초 snapshot 직전 `git status --porcelain=v1 -uall`에서 tracked 삭제였던 경로는 다음
다섯 묶음이다. 현재 후보 branch에는 삭제 상태가 commit되어 있어 clean clone의
`git status`에는 나타나지 않는다. inventory는 삭제 의도 검토를 위한 snapshot ledger다.

| 묶음 | 수 | 해석 |
|---|---:|---|
| `apps/web/src/app/customersurvey/*` | 19 | 기존 다중 파일 survey UI를 다른 표면으로 정리하려는 것으로 보이나 최종 대체 경로 확인 필요 |
| `apps/web/src/components/customer-landing/*` | 10 | 과거 customer landing component 제거 후보 |
| `apps/web/src/components/landing/*` | 10 | 새 랜딩에서 사용하지 않는 legacy section 제거 후보 |
| market-price legacy component/provider | 6 | 현재 price 표면과 중복되는 과거 구현 제거 후보 |
| `apps/web/src/lib/quoteCheck/publicResult.ts` | 1 | 공개 결과 종료와 관련된 중복 구현 제거 후보 |

46개 전부 inventory에서 `review_required`다. 삭제가 의도됐다는 이유만으로 대체 route,
import, sitemap, metadata, deep link, 404·410 계약이 안전하다고 가정하지 않는다.
commit 전에 각 경로의 참조 검색과 nearest test를 확인해야 한다.

## 16. 검증 ledger

2026-08-02 후속 dirty source의 검증 결과는
`docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`의 ledger에 따로
기록한다. 아래 2026-07-31 PASS를 후속 변경의 완료 증거로 재사용하지 않는다.

### 이번 문서 작업에서 같은 source snapshot에 실행

| 명령 | 상태 | 의미 |
|---|---|---|
| `node --test scripts/tests/repository-handoff-docs.test.mjs` | **5/5 통과** | 문서 권한·상태·inventory schema |
| inventory JSON parse/schema와 current NUL status 대조 | **626 entries, `M 359 / D 46 / ?? 221`, 경로·status 1:1 일치** | JSON 문법·필드 최소화·삭제 fail-closed |
| 문서 backtick path 존재 확인 | **124개 확인, 누락 0** | 의도된 tracked 삭제 참조 1개는 inventory와 대조 |
| `git diff --check origin/main...candidate` | **6개 기존 payload 표면 확인** | Markdown hard-break 공백 4개와 pnpm dependency patch payload 공백 2개다. 새 후속 commit의 staged diff는 각각 통과했다. |
| `corepack pnpm supabase:release:fence` | **통과** | 48개 migration의 local static manifest 계약만 검증 |
| 모바일 인증 수정 검증 | **161/161 test, release 104/104, typecheck·lint·Web/iOS/Android export 통과** | local candidate 증거; 실계정·signed device·provider 설정은 별도 |
| production audit | **중단** | 로컬 `SUPABASE_ACCESS_TOKEN` 부재; 값을 문서·Git에 넣어 우회하지 않음 |
| community local release contract | **READY** | local contract만 의미하며 production은 계속 `NO-GO` |
| EAS account | **NOT LOGGED IN** | cloud build·submit을 실행하지 않음 |

### 과거 evidence — 현재 candidate 전체의 완료 증거로 재사용 금지

- `docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md`의 전체 테스트·lint·typecheck·
  브라우저 smoke는 당시 worktree의 historical evidence다.
- `docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`의 로컬 결과는
  커뮤니티 후보 계약 evidence이지 hosted·production evidence가 아니다.
- 랜딩의 표적 테스트와 local build 결과가 있더라도 이후 다른 영역 source가 섞였으므로
  현재 전체 worktree의 release 승인을 뜻하지 않는다.

### 현재 candidate에서 실행한 검증

- `corepack pnpm qa:local`: PASS
  - web 461 files / 3,948 tests, typecheck, lint, 141-page production build
  - mobile release readiness 104/104, tests 161/161, typecheck, lint,
    Android/iOS/Web Expo export
  - shared와 design-tokens typecheck
- `corepack pnpm test:repo`: 260/260 PASS
- `corepack pnpm supabase:release:test`: 189/189 PASS
- `corepack pnpm supabase:release:fence`: 48개 successor migration 정적 검증 PASS,
  상태는 의도대로 `deployment_blocked`
- `node scripts/audit/community-release-readiness.mjs`: local contract는 READY,
  production은 hosted evidence 부재로 NO-GO
- pre-push Turbo gate: 8/8 tasks PASS
- 추가된 diff line의 비밀정보 후보: 0
- 첫 merged gate는 DB-heavy shared-action case가 기본 15초를 넘어 18초에 실패했다.
  production SQL 결함이 아니라 테스트 시간 예산 문제로 재현·분리했고, 두 무거운
  case에만 30초 예산을 준 commit
  `62f2035c3a1d7eaa668472a46be496432138ad64`를 추가했다.
- 수정 뒤 해당 파일 43/43, 가장 무거운 PGlite 4파일 128/128, 전체 web suite를
  4 workers와 2 workers에서 각각 461 files / 3,948 tests PASS로 재검증했다.
  그러나 cache-cleared merged release gate에서는 4 workers가 두 번 불안정했고 두
  번째에는 결과를 남기기 전에 web test process가 종료됐다. 따라서 실행시간보다
  릴리스 재현성을 우선해 final code/config
  `a66da0d8857e75eb404a7b9a34ff1069b6be889e`에서 workers를 2로 고정했다.

production build는 synthetic/local 환경 성공과 실제 production fence를 구분한다.
manifest가 blocked인 상태를 우회해 build·deploy하지 않는다.

## 17. GitHub 인계

- repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- local branch: `agent/release-handoff-20260731`
- base/origin: `0f84665e9b8828f30e5a83ca5854ef618c3f4518`
- 최초 통합 snapshot: `04f0ea1603c4ebbe5e9018f17ada5e239ac508c7`
- 마지막 code/config 검증 commit: `a66da0d8857e75eb404a7b9a34ff1069b6be889e`
- push: 완료
- PR: Draft [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79)
- GitHub checks:
  - Vercel deployment와 Preview Comments는 PASS
  - GitHub Actions jobs는 step 0개 상태에서 account payment/spending-limit
    annotation으로 실패했다. 코드가 runner에서 실행된 실패가 아니다.

GitHub Actions는 현재 두 종류의 빨간불을 구분해야 한다.

- account billing/spending-limit 문제로 runner가 시작되기 전에 실패하는 외부 차단
- hosted evidence가 없을 때 `production_readiness`가 의도적으로 실패하는 release 차단

둘 다 코드 품질 성공 증거가 아니다. runner가 실제 시작한 개별 quality job과 로컬
gate를 확인하고, billing 차단을 테스트 실패처럼 고치거나 의도적 fail-closed job을
우회하지 않는다.

안전한 공유 순서:

1. inventory의 `review_required`를 영역 owner가 확인한다.
2. 46개 삭제와 16개 migration을 별도 diff로 검토한다.
3. 같은 source state에서 전체 로컬 gate를 실행한다.
4. 의도한 파일만 stage한다. `git add -A`로 범위를 숨기지 않는다.
5. commit SHA를 PR 본문과 외부 release receipt에 고정한다. 자기 자신을 포함하는
   문서 commit SHA는 remote branch/PR HEAD로 확인한다.
6. push 후 PR diff·checks를 확인한다.
7. merge 전에 production build fence와 DB release gate를 다시 확인한다.

## 18. 배포 순서와 receipt

### Web

새 worktree는 보호형 Vercel Preview까지만 배포했다. branch alias는
`https://wedding-hanbang-web-git-agent-release-handoff-20260731-hanbang.vercel.app`이고
최초 확인 deployment는 `dpl_CByALSMu1zcnLPudFDmnCSM9egMC`다. Vercel CLI의 보호
bypass를 사용한 read-only 확인에서 `/wedding`, `/login`, `/price`가 응답했다.
일반 headless browser smoke는 앱 route가 아니라 Vercel SSO login으로 redirect돼
중단됐다. Deployment Protection을 해제하지 않았으며, 이 결과를 앱 실패 또는
production smoke 성공으로 기록하지 않는다.

위 최초 receipt는 code SHA `41686ad60721092b6f1fd7088cb674ed5e7b43eb`에 묶인다.
후속 변경은 테스트 시간 예산, 인계 receipt, 검증 설정 원복뿐이며 final branch/PR
HEAD가 새 Preview를 다시 만든다. 최종 deployment ID와 source binding은 PR의 외부
receipt를 정본으로 삼는다. 어떤 Preview receipt도 production 승인으로 승격하지 않는다.

production 배포에는 exact clean commit, build 결과, deployment ID, commit binding,
운영 URL smoke를 같은 외부 receipt에 남겨야 한다. 운영 DB가 필요한 route를 web만
먼저 노출하지 않는다.

Vercel project 정본은 저장소 root의 `.vercel`이 연결하는 `wedding-hanbang-web`이다.
`apps/web/.vercel`은 잘못된 별도 project 연결이므로 production 배포 근거로 쓰거나
그 상태에서 CLI deploy하지 않는다. production branch는 `main`이다. 현재 Preview
환경은 stub mode만 확인돼 read-only UI preview 후보일 뿐 production 인가가 아니다.

### Database와 Storage

1. exact clean commit과 origin
2. manifest/controller static fence
3. DB·Storage 전역 write fence
4. 암호화 DB backup과 별도 Storage 원본 backup
5. 다른 Supabase project에서 restore rehearsal
6. hosted staging exact migration 적용
7. read-only pre/postcondition과 rollback rehearsal
8. production one-time controller apply
9. clean ledger와 postcheck (`wedding_court_auth_delete_fk_count=1`,
   `chat_feedback_auth_delete_fk_count=1`, `payment_ledger_fk_contract_count=3`
   포함)
10. post-expand backup·restore
11. canary와 exact-owner finalizer

일반 `supabase db push`, `--include-all`, 임의 SQL write를 실행하지 않는다.

### Community

DB와 같은 commit의 API/UI를 사용하고 Gate 0을 통과하기 전 쓰기를 열지 않는다.
초기 공개는 20명 이하 통제 beta이며 사람 답변 공급과 신고 운영 owner가 있어야 한다.

### Mobile

웹 release와 별도로 EAS signed build, 실기기, OAuth/deep link, privacy disclosure,
store receipt를 남긴다.

전역 EAS CLI 18.7은 현재 로그인되지 않았고 저장소 정본 EAS CLI는
`eas-cli@21.0.2`다. 전역 CLI로 우회하지 않는다. `apps/mobile/eas.json`과
`scripts/mobile-eas-release-gate.mjs`가 허용하는 development/preview build만 사용하며,
production build·submit은 `MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED`로
provider 실행 전에 실패하는 것이 정상이다.

Expo Web 정적 export를 올리는 공식 외부 preview 경로는 아직 없다. 모바일용 Vercel
project·SPA rewrite·preview 전용 API/Supabase 환경이 없고, 별도 origin에서 운영
`https://hanbang.ai/api/*`를 호출하면 브라우저 CORS 경계에 막힌다. root Vercel project나
잘못 연결된 `apps/web/.vercel`에 모바일 산출물을 배포하지 않는다. 지금 허용되는 확인
경로는 로컬 Metro web, tunnel/emulator, 또는 승인된 EAS internal preview build뿐이다.

## 19. rollback과 복구

### Web rollback

- 현재 확인된 rollback 기준:
  - Vercel deployment: `dpl_FHbiEU4qAVqPFTV6TzwmvmEFQvLL`
  - immutable URL: `https://wedding-hanbang-o9fn2bc2c-hanbang.vercel.app`
  - commit: `0f84665e9b8828f30e5a83ca5854ef618c3f4518`
  - live smoke: `https://hanbang.ai/landing?preview=final` — HTTP 200
- 새 deployment 장애 시 이전 확인된 deployment로 platform rollback하고 운영 URL을
  다시 smoke한다.
- Git 기록은 destructive reset이 아니라 revert 또는 새 수정 commit으로 보존한다.

### DB rollback

- apply 전 실패: write fence와 release lock을 유지하고 원인을 고친다.
- ambiguous 또는 completed push 뒤: 자동 재실행과 down migration을 금지한다.
- 기본 전략은 `forward-fix-feature-off`다.
- 최소 feature-off 경계:
  - `AMORA_AUXILIARY_MEMORY_ENABLED=false`
  - `AMORA_CARE_OUTBOUND_ENABLED=false`
  - `AMORA_COMMUNITY_AI_COMMENT_ENABLED=false`
  - `AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false`
  - `AMORA_OPENAI_ENABLED=false`
  - `AMORA_PROACTIVE_CHAT_ENABLED=false`
  - `AMORA_COST_GUARD_ENABLED=true`
  - `WEDDING_COURT_ENABLED=false`
  - `WEDDING_PAYMENT_LEDGER_ENABLED=false`
  - DB·Storage write fence 유지
  - Auth signup 비활성
  - web write fence 유지
  - partner-recipient와 conversation-segment DB 보안 경계 유지
- provenance·moderation·동의 ledger를 약한 과거 schema로 자동 복원하지 않는다.

### Storage와 개인정보

- DB backup은 Storage original bytes를 포함하지 않는다.
- signed URL 만료와 object inventory 안정성을 확인한다.
- 삭제·신고·moderation evidence를 보존해야 할 때 보관 기간과 권한을 법률·개인정보
  owner가 결정한다. 문서가 임의 기간을 만들지 않는다.

### Community 비상 모드

미표시 AI·협찬, 개인정보 사고, 신고 SLA 초과, 답변 공급 붕괴가 생기면 신규 유입과
쓰기를 끄고 read-only로 전환한다. migration은 자동으로 되돌리지 않는다.

## 20. 남은 출시 게이트

### source와 Git

- inventory `review_required` 전건 owner 확인
- tracked 삭제 46개 대체 경로·참조·SEO 검사
- 현재 66개 manifest 순서·normalized SHA와 후속 migration 18개 재검증
- current candidate 전체 typecheck·lint·test·build
- clean release commit, push, PR, checks

### 아모라·커플

- 실제 계정 두 개로 제안→확인→승인→반영→실패 복구
- private/shared visibility와 삭제 사후조건
- 동시 수정, revision conflict, idempotent retry
- 알림 중복·유실

### DB·운영

- controller-ready contract
- 필수 private evidence 5종
- hosted staging·hosted restore
- DB·Storage backup과 복구 검증
- production apply receipt와 read-only postcheck
- exact-owner finalizer

### 소비자·법률

- 개인정보처리방침·소비자보호·광고·업체 분쟁 문구 검토
- 고객지원 이메일 실제 접수·응답
- 커뮤니티 신고·복원·이의제기 훈련
- 랜딩 3초 이해 테스트
- WeddingCode 인지면접과 실제 커플 대화 관찰

### 화면과 기기

- 320/375/390px 모바일과 1280/1440px 데스크톱
- 키보드·focus·reduced motion·색 대비
- production URL console/network/error state
- iOS·Android signed build 실기기

## 21. 다음 작업자가 지켜야 할 순서

1. `docs/README.md`와 이 문서를 읽는다.
2. inventory JSON에서 자기 영역과 `review_required`를 찾는다.
3. `git status --porcelain=v1 -uall`이 inventory와 달라졌으면 새 snapshot을 만든다.
4. 바뀐 영역의 실제 code·test·migration을 읽는다.
5. 표적 테스트 뒤 전체 gate로 확장한다.
6. 운영 write 전에 영역별 NO-GO 문서를 다시 읽는다.
7. 실제 receipt가 생길 때만 이 문서의 facet 상태를 갱신한다.

## 22. 즉시 중단 조건

- base/origin 또는 inventory가 검토 중 바뀜
- 삭제 46개 중 owner가 설명하지 못하는 경로가 있음
- migration hash·순서가 manifest와 다름
- production build fence를 우회해야만 배포 가능
- backup·restore·write fence receipt가 없음
- hosted postcondition이 하나라도 실패
- 운영 URL이 다른 commit을 서비스함
- 개인정보·비밀·사용자 원문이 Git이나 receipt에 포함됨

이 중 하나라도 발생하면 “일단 전부 배포”하지 않는다. 확인된 web-only 변경과 DB·
community·mobile release를 분리하고, 막힌 표면은 `BLOCKED` 또는 `NOT RELEASED`로
유지한다.

## 23. 다른 컴퓨터 fresh clone

### 런타임 정본

| 용도 | 버전 |
|---|---|
| 저장소 설치·테스트·웹·CI | Node `22.13.0` 권장, root engine 최소 `>=22.13.0` |
| package manager | pnpm `11.7.0` |
| Expo 로컬 dev server | Node `20.19.x`, 현재 wrapper 기준 `20.19.6` |
| EAS cloud profile | Node `22.13.0`, pnpm `11.7.0` |
| 저장소 EAS CLI | `eas-cli@21.0.2` |
| Supabase CLI | root devDependency `2.106.0` |

일반 개발 터미널은 Node 22.13.0, Expo 전용 터미널은 Node 20.19.6으로 분리한다.
engine 또는 Expo wrapper의 버전 검사를 삭제해 한 버전으로 억지 통일하지 않는다.

### Windows PowerShell

이 저장소는 private이다. 먼저 `gh auth status`가 성공하거나 동등한 Git credential/SSH
권한이 있어야 한다. Node 22.13.0을 활성화한 새 PowerShell에서:

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
Set-Location wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/mobile/.env.example apps/mobile/.env.local
git status --short --branch
```

### macOS

GitHub 인증을 먼저 확인한 뒤 Node 22.13.0을 활성화한 Terminal에서:

```bash
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
git status --short --branch
```

iOS Simulator가 필요할 때만 Xcode와 command-line tools를 별도로 준비한다.

### Linux

GitHub 인증을 먼저 확인한 뒤 Node 22.13.0을 활성화한 shell에서:

```bash
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
git status --short --branch
```

Linux에서는 iOS Simulator를 실행할 수 없다. Android emulator·실제 Android 기기,
Expo tunnel 또는 Metro web을 사용한다.

설치 직후 기대값:

```bash
node --version
corepack pnpm --version
git config --get core.hooksPath
git status --short --branch
```

- 일반 Node: `v22.13.0` 또는 별도로 검증한 호환 Node 22
- pnpm: `11.7.0`
- hooks path: `.githooks`
- fresh clone worktree: clean

### 정확한 branch 이어받기

통합 branch가 아직 `main`에 merge되지 않았다면:

```bash
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
```

merge됐다면 remote 기본 branch를 동적으로 찾아 fast-forward만 허용한다.

PowerShell:

```powershell
git remote set-head origin --auto
$defaultBranch = (git symbolic-ref --short refs/remotes/origin/HEAD).Replace("origin/", "")
git switch $defaultBranch
git pull --ff-only origin $defaultBranch
```

macOS/Linux:

```bash
git remote set-head origin --auto
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##')"
git switch "$default_branch"
git pull --ff-only origin "$default_branch"
```

최종 commit SHA는 자기 자신을 포함하는 문서 안에 고정할 수 없다. GitHub의 final
branch/PR/commit이 불변 인계 위치다. 작업 종료와 새 컴퓨터에서 아래처럼 local/remote
동일성을 검증한다.

PowerShell:

```powershell
$branch = git branch --show-current
$localHead = git rev-parse HEAD
$remoteLine = git ls-remote --heads origin "refs/heads/$branch"
if ([string]::IsNullOrWhiteSpace($remoteLine)) {
  throw "현재 브랜치가 origin에 없습니다."
}
$remoteHead = ($remoteLine -split "\s+")[0]
[pscustomobject]@{
  Branch = $branch
  LocalHead = $localHead
  RemoteHead = $remoteHead
  Clean = -not [bool](git status --porcelain)
}
if ($localHead -ne $remoteHead) {
  throw "로컬 HEAD와 origin branch HEAD가 다릅니다."
}
```

macOS/Linux:

```bash
branch="$(git branch --show-current)"
local_head="$(git rev-parse HEAD)"
remote_head="$(git ls-remote --heads origin "refs/heads/$branch" | awk '{print $1}')"
test -n "$remote_head"
printf 'branch=%s\nlocal=%s\nremote=%s\n' "$branch" "$local_head" "$remote_head"
test "$local_head" = "$remote_head"
test -z "$(git status --porcelain)"
```

## 24. 환경변수·계정·비밀 이전

환경변수 이름과 설명의 정본:

- 웹: `apps/web/.env.example` → `apps/web/.env.local`
- 모바일: `apps/mobile/.env.example` → `apps/mobile/.env.local`

새 컴퓨터에 필요한 외부 권한:

- GitHub repository와 PR
- Vercel team의 root project `wedding-hanbang-web`
- Supabase Dashboard와 private release evidence 보관소
- Expo/EAS owner `hanbang`
- Apple Developer·App Store Connect와 Google Play Console
- 팀 비밀 저장소

권한이 없으면 해당 단계는 `UNVERIFIED`다. 다음을 지킨다.

1. `.env.local`, `.vercel`, `.expo`, signing 파일, backup과 raw receipt는 Git에 넣지 않는다.
2. `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`는 browser/app bundle에 공개된다.
3. OpenAI key, Supabase service-role/access token, Vercel/EAS token, Sentry auth token,
   cron/HMAC 비밀은 공개 접두사를 붙이지 않는다.
4. 운영 값을 로컬 파일·채팅·문서·PR·화면 캡처로 전달하지 않는다.
5. 각 플랫폼의 environment secret store 또는 팀 비밀 저장소에서 담당자가 직접 주입한다.
6. production 값을 preview/local에 복사하지 않는다.
7. 사용자 원문, 이메일, 전화번호, token, backup payload를 로그에 남기지 않는다.

값을 출력하지 않고 변수 이름만 확인한다.

PowerShell:

```powershell
Get-Content apps/web/.env.local |
  Where-Object { $_ -match '^[A-Z0-9_]+=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
Get-Content apps/mobile/.env.local |
  Where-Object { $_ -match '^[A-Z0-9_]+=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
```

macOS/Linux:

```bash
sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' apps/web/.env.local
sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' apps/mobile/.env.local
```

Vercel의 root `.vercel`과 `apps/web/.vercel`을 다른 컴퓨터로 복사하지 않는다. 권한 있는
계정으로 root project를 다시 link하고 project 이름·team·production branch를 확인한다.

```bash
vercel link --project wedding-hanbang-web --scope hanbang --yes
vercel project inspect wedding-hanbang-web --scope hanbang
```

두 명령은 repository root에서만 실행한다. `apps/web` 안에서 별도 `hanbang/web`
project에 link하거나 production deploy를 실행하지 않는다.

## 25. 웹·모바일 로컬 실행

### 웹

Node 22.13.0 터미널, repository root에서:

```bash
corepack pnpm dev:web
```

기본 주소는 `http://localhost:3000`이다. 다른 dev/build 작업이 safety lock을 소유하면
그 프로세스가 끝날 때까지 기다리거나 owner에게 확인한다. lock을 임의 삭제해 병렬
production build를 강제하지 않는다.

### Expo: 같은 Wi-Fi QR

Node 20.19.6을 활성화한 별도 터미널에서:

```bash
corepack pnpm --dir apps/mobile dev
```

iPhone은 기본 카메라, Android는 Expo Go의 scanner를 사용한다. 같은 Wi-Fi에서도 guest
network·AP isolation·VPN·방화벽 때문에 timeout이 날 수 있다.

### QR timeout 대안

1. Metro web으로 즉시 확인

   ```bash
   corepack pnpm --dir apps/mobile dev -- --web
   ```

   기본 주소는 `http://localhost:8081`이다. 화면·폼·라우팅에는 유용하지만 SecureStore,
   native Apple sign-in, push, deep link와 실기기 safe-area 증거는 아니다.
   `expo export --platform web` 산출물은 현재 QA artifact일 뿐 공식 외부 preview가
   아니다. 별도 모바일 web project·SPA fallback·preview API/CORS 경계를 승인하기 전
   root `wedding-hanbang-web` project에 배포하지 않는다.

2. Expo tunnel

   ```bash
   corepack pnpm --dir apps/mobile dev:tunnel
   ```

3. Android emulator 또는 iOS Simulator

   ```bash
   corepack pnpm --dir apps/mobile dev:android
   corepack pnpm --dir apps/mobile dev:ios
   ```

   iOS는 macOS+Xcode, Android는 Android SDK와 실행 중 emulator 또는 연결 기기가
   필요하다.

4. 설치형 internal preview build

   EAS 계정과 preview environment를 확인한 뒤 저장소 wrapper만 사용한다.

   ```bash
   node scripts/mobile-eas-release-gate.mjs build --platform android --profile preview --non-interactive --freeze-credentials
   node scripts/mobile-eas-release-gate.mjs build --platform ios --profile preview --non-interactive --freeze-credentials
   ```

   preview build도 cloud write·비용이 생기는 외부 작업이다. branch, clean commit,
   EAS account/environment를 먼저 확인한다. 현재 컴퓨터는 EAS에 로그인돼 있지 않다.

macOS/Linux에서 Node 22 terminal이 Expo wrapper를 호출해야 하는 특별한 경우에는
`HANBANG_MOBILE_NODE`를 Node 20.19.x executable로 지정한다. 가장 단순한 방법은 Expo
전용 terminal 자체를 Node 20.19.6으로 전환하는 것이다.

## 26. 새 컴퓨터 검증과 안전 배포

### 변경 중 빠른 검사

```bash
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile lint
corepack pnpm --filter @hanbang/mobile test
corepack pnpm mobile:release-check
```

### PR 전 전체 검사

```bash
corepack pnpm qa:local
corepack pnpm test
git diff --check
```

`qa:local`은 웹 typecheck·lint·test·production build, 모바일 release check·test·
typecheck·lint·bundle export, shared/design-token typecheck를 실행한다. 끝까지 성공하지
않으면 “통과”로 기록하지 않는다.

Supabase 또는 migration 변경:

```bash
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
```

업체 공시 ingest 변경:

```bash
corepack pnpm ingest:typecheck
corepack pnpm test:ingest
```

커뮤니티 release 변경:

```bash
node scripts/audit/community-release-readiness.mjs
node --test scripts/tests/community-release-readiness.test.mjs
```

### GitHub

- `git add -A` 대신 목적별 파일만 stage한다.
- force push를 금지한다.
- pre-push hook을 기본으로 유지한다.
- billing/spending-limit runner 차단, 실제 code job 실패, 의도적
  `production_readiness` 실패를 각각 구분한다.
- push·PR·code checks가 있어도 production 인가는 아니다.

### Vercel

- 정본은 root project `wedding-hanbang-web`, production branch `main`이다.
- `apps/web/.vercel`의 잘못된 별도 project에서 deploy하지 않는다.
- Preview stub은 운영 secret·write 없이 UI를 확인하는 용도다.
- production은 clean exact commit, 전체 gate, 필요한 DB 선적용, deployment ID,
  source binding, 운영 URL smoke와 직전 rollback deployment를 확보한 뒤에만 진행한다.

### EAS

- global EAS 18.7을 사용하지 않고 저장소가 pin한 `eas-cli@21.0.2` wrapper를 사용한다.
- 현재는 development/preview build만 허용한다.
- production build·submit이
  `MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED`로 실패하는 것이 정상이다.
- authorization 코드를 삭제하거나 direct EAS CLI로 우회하지 않는다.
- 향후 release에는 같은 source SHA의 build ID, profile/channel/runtime, signing 변화,
  TestFlight/Play internal 설치와 실제 OAuth/deep-link 증거가 필요하다.

### Supabase

현재 허용되는 것은 local static verification뿐이다.

```bash
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
```

`controller_ready`와 private evidence 5종이 별도 승인된 뒤에만 remote fence와 controller를
검토한다.

```bash
corepack pnpm supabase:release:fence:remote
corepack pnpm supabase:release:apply
```

위 두 명령은 현재 실행 지시가 아니다. 일반 `supabase db push`, `--include-all`,
Dashboard 임의 SQL, synthetic success receipt로 우회하지 않는다. write 뒤 결과가
모호하면 자동 재실행하지 않고 lease·fence·raw evidence를 보존한다.

## 27. 새 컴퓨터 체크리스트

첫 시작:

- [ ] 이 문서와 3절의 권한 문서를 읽었다.
- [ ] GitHub branch/PR/source commit과 local/remote HEAD 동일성을 확인했다.
- [ ] fresh clone worktree가 clean이다.
- [ ] Node 22.13.0, pnpm 11.7.0, Expo용 Node 20.19.6을 준비했다.
- [ ] frozen install과 `.githooks` 설치를 완료했다.
- [ ] `.env.example`만 복사하고 권한 있는 secret store에서 개발값을 주입했다.
- [ ] 비밀·사용자 데이터를 화면·로그·Git에 출력하지 않았다.
- [ ] 웹 `localhost:3000`을 열었다.
- [ ] 모바일은 QR·web·tunnel·emulator 중 가능한 경로로 열었다.
- [ ] Database `BLOCKED`, Community `NO-GO`, Mobile `NOT RELEASED`를 확인했다.

작업 종료:

- [ ] inventory와 현재 `git status --porcelain=v1 -uall`의 차이를 검토했다.
- [ ] 다른 작업자의 파일을 되돌리지 않았다.
- [ ] 의도한 파일만 stage했다.
- [ ] nearest test, `qa:local`, 필요한 release contract를 실행했다.
- [ ] 미실행·실패·외부 차단을 `UNVERIFIED` 또는 `BLOCKED`로 남겼다.
- [ ] local HEAD와 origin branch HEAD가 같다.
- [ ] PR에 테스트, 배포 표면, known issue와 rollback을 기록했다.
- [ ] `.env*`, signing 파일, 사용자 데이터, backup/raw receipt가 commit에 없다.
- [ ] 외부 배포를 했다면 exact source SHA와 platform receipt를 남겼다.
