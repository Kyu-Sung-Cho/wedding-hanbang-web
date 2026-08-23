# 문서 권한과 상태

`docs/`에는 현재 기준서와 과거 전략·감사·세션 기록이 함께 있다. 파일 날짜가 최신이거나
본문에 “완료”가 적혀 있다는 이유만으로 현재 제품·보안·배포 상태로 사용하지 않는다.

새 컴퓨터나 새 LLM은 저장소 루트의 `START_HERE.md`에서 시작한다. 이 파일은 문서 권한을
대체하지 않고, 아래 정본을 안전한 순서로 읽고 첫 P0 작업까지 진입하게 하는 색인이다.

## 현재 권한 순서

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md`
   - 현재 제품 계약 정본. 한 줄 정의·아모라 호칭·전면 범위·내부/외부 언어 경계
   - `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`를 승계했다(구 문서는 SUPERSEDED)
   - 모바일 완료 기준: `docs/MOBILE_PRODUCT_COMPLETION_STANDARD_2026-08-03.md`
4. 현재 source snapshot·릴리스 상태·다른 컴퓨터 인수인계:
   `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md`
   - 2026-08-04 현재 Git/PR/CI/DB/Mobile 증거, P0/P1, 개인정보 구현 경계,
     다른 컴퓨터 재개 순서와 **production NO-GO** 판정의 현재 factual 정본
   - Amora·커뮤니티 local release candidate의 구현·파일·기존 검증 상세:
     `docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`
   - Amora 대화 안전 두 wave와 이전 검증 스냅샷:
     `docs/operations/AMORA_SAFETY_RELEASE_HANDOFF_2026-08-04.md`
   - 아모라 개인정보 경계·소비자 안전 목표 아키텍처와 출시 절대 게이트
     (**TARGET ARCHITECTURE, 현재 P0가 남아 있어 production NO-GO**):
     `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md`
   - 2026-07-31 전체 workspace 기준선:
     `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
   - clone·환경 복원·웹/모바일 연결:
     `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
   - 커뮤니티 설계와 후속 전체 구현 상세:
     `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
   - 아모라 대화·privacy·retry·기억·위기 안전 기반:
     `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
   - 아모라 W0~W5 통합 케어 제품 계약:
     `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`
   - neutral couple member 전환 제안(**PLAN, 미구현·미배포**):
     `docs/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02.md`
   - Amora × 사람 경험 결정 네트워크 마스터 설계와 local candidate 범위
     (**승인 방향 + 로컬 구현, 운영 DB/배포 미반영**):
     `docs/COMMUNITY_AMORA_DECISION_NETWORK_MASTER_SPEC_2026-08-03.md`
   - DecisionThread P0 현재 로컬 구현 상태
     (**LOCAL RELEASE CANDIDATE, exact Git·검증 상태는 현재 handoff 참조, 운영 NO-GO**):
     `docs/operations/COMMUNITY_DECISION_THREAD_P0_RELEASE_CANDIDATE_2026-08-04.md`
5. 변경 영역의 현재 게이트
   - DB: `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`
   - 커뮤니티: `docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`
   - 공시 production build:
     `docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md`
   - WeddingCode: `docs/wedding-code/README.md`
6. 변경 영역의 실제 코드·테스트·최신 migration
7. `docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md`,
   `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md` 등
   날짜별 감사·인계 기록

현재 제품 정의는 다음과 같다.

**웨딩한방은 결혼 준비의 고민을 아모라와 처음부터 끝까지 이야기하고, 비슷한 시기에
준비하는 사람들의 기록을 함께 보며, 확인한 것만 예산·체크리스트·일정에 남기고 바뀐 내용을 서로에게 알리는 서비스입니다.**

4번 문서는 이 제품 방향을 바꾸지 않고 GitHub, Web, DB, Community, Mobile의 현재
상태를 각각 기록한다. exact 파일 목록은
`docs/operations/evidence/full-workspace-release-inventory-2026-07-31.json`에서
`git status --porcelain=v1 -uall` 기준으로 확인한다.

## 상태 해석

- `CURRENT`: 위 권한 문서가 현재 기준으로 직접 지목하고, 실제 코드와 충돌하지 않는 문서
- `PLAN`: 실행 순서나 후보안이며 완료 증거가 아닌 문서
- `HISTORICAL` 또는 `SUPERSEDED`: 당시 판단을 보존한 기록. 현재 지시로 실행하지 않는다.
- 상태 표시 없음: 기본적으로 참고 자료다. 현재 계약이나 배포 증거로 쓰기 전에 반드시
  위 권한 문서와 실제 저장소 상태를 대조한다.

## 완료 증거

문서의 체크 표시나 과거 문장만으로 다음을 완료로 판정하지 않는다.

- 테스트·빌드: 현재 HEAD와 dirty worktree에서 실행한 명령 결과
- GitHub: 원격 commit, PR, checks
- DB: 승인된 manifest, backup, apply receipt, read-only postcondition
- 배포: 저장된 production deployment receipt와 운영 URL smoke 결과
- 모바일: 서명된 빌드와 실기기 검증 결과

일반 `supabase db push`, `--include-all`, migration history 추측 보정, 임의 운영 SQL
write는 실행하지 않는다.

## 보조 개발 도구

다음 문서는 제품·릴리스 정본이 아니라 기기별 개발 도구 런북이다.

- Lazyweb MCP 디자인 조사·보안 경계·새 컴퓨터 설치:
  `docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md`
