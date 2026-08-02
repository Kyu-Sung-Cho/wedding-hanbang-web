# Claude Code 작업 기준

이 파일은 현재 작업 규칙만 담는다. 날짜가 지난 전략안·세션 기록·배포 기록은 현재
지시가 아니며, 완료 상태는 Git·테스트·릴리스 receipt로 다시 확인한다.

## 읽는 순서

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
4. `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
   - 다른 컴퓨터 재개:
     `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
   - 2026-08-02 커뮤니티·전체 구현 상세:
     `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
   - UI 디자인 조사 도구가 필요한 경우에만:
     `docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md`
5. 변경 영역의 현재 release gate
6. 변경 영역의 실제 코드·테스트·최신 migration
7. `docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md`,
   `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md` 등
   과거 snapshot

문서가 충돌하면 위 순서를 따른다. 오래된 문서에 “완료”, “배포”, “최상위 전략”이
적혀 있어도 현재 증거로 사용하지 않는다.

## 현재 제품 계약

**웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는
서비스입니다.**

- 아모라가 제품의 중심이다.
- 주 내비게이션은 `아모라 | 할 일·일정 | 예산 | 커뮤니티`다.
- 커뮤니티는 실제 경험을 찾고 질문하는 보조 축이다.
- 업체 추천·예약·축의금·모바일 출시는 현재 웹 MVP의 전면 범위가 아니다.
- 저장소에 장기 기능 코드가 남아 있다는 이유로 현재 제공 기능처럼 소개하지 않는다.
- 새 독립 제품 축을 추가하기 전에 아모라의 제안, 사용자 승인, 실제 반영, 실패 복구
  흐름을 먼저 안정화한다.

## 신뢰와 개인정보

- P6 법령·보안·운영 조건은 교환할 수 없는 출시 게이트다. 통과한 선택지끼리는
  P1 > P3 > P2 > P4 > P5 순서로 판단한다.
- AI 감사 로그에는 질문·답변·첨부·도구 입력 원문을 복제하지 않는다. 필요한
  콘텐츠 비포함 메타데이터만 기록한다.
- 커플 결정은 사용자가 확인한 변경만 저장한다. 모델이 추정한 성격·감정·숨은 이유를
  결정이나 프로필 사실로 만들지 않는다.
- 아모라는 사용자 승인 없이 예산·일정·할 일을 바꾸지 않으며, 도구 결과를 확인하기
  전에는 반영됐다고 말하지 않는다.
- 업체·가격·계약은 확인된 사용자 자료나 출처 범위만 설명한다. 품질·적정성·안전성을
  점수, 등급, “최고”, “보장”으로 판정하지 않는다.
- WeddingCode는 검증된 심리검사나 궁합 검사가 아니다.
  - **4글자 코드는 만든다**(2026-07-31 파운더 결정). 단 그 코드는 **사용자가 고른 답의
    요약**이지 성격 판정이 아니다. 글자마다 몇 대 몇으로 갈렸는지(확신도)를 함께
    보여주고, 아슬한 글자는 다음에 바뀔 수 있다고 화면에서 먼저 알린다.
  - 코드에 성격 설명("당신은 이런 사람입니다"), 동물·캐릭터, 점수, 등급을 붙이지 않는다.
    코드 옆에 오는 설명은 **본인이 고른 문장 인용**과 글자 뜻 한 줄뿐이다.
  - **궁합 점수와 관계 예측은 계속 금지다.** 두 코드는 점수로 합치지 않고, 글자가 다른
    자리와 그 자리에서 할 다음 대화만 보여준다.

## 저장소와 출처

- 저장소 루트: 이 파일이 있는 pnpm + Turborepo 모노레포
- 웹: `apps/web` (Next.js App Router)
- 모바일: `apps/mobile` (Expo/React Native)
- 공유 로직: `packages/shared`
- DB·RLS·RPC: `supabase/migrations`
- 환경변수 목록: `apps/web/.env.example`
- 디자인 기준: `DESIGN.md`, `apps/web/src/app/globals.css`,
  `@hanbang/design-tokens`

스택 버전, 라우트, 환경변수, DB 컬럼 수를 이 문서에 복제하지 않는다. 실제 파일이
정본이다.

## 작업과 검증

- dirty worktree의 다른 사람 변경을 되돌리지 않는다.
- 입력은 경계에서 검증하고 내부 오류·비밀값·개인정보를 응답이나 로그에 노출하지 않는다.
- 변경 영역의 표적 테스트와 타입 검사를 먼저 실행한다.
- 공유 전 저장소 루트에서 `corepack pnpm qa:local`을 실행한다.
- 운영 DB는 일반 `supabase db push`, `--include-all`, 임의 SQL write로 바꾸지 않는다.
  승인된 release manifest/controller 절차만 사용한다.
- 테스트·빌드·DB 적용·배포·백업·복구는 실제 명령과 receipt가 있을 때만 완료로
  기록한다.
- production 배포가 끝나지 않았으면 로컬 빌드 성공을 배포 완료로 표현하지 않는다.
