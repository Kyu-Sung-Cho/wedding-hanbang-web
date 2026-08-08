# 커뮤니티 프로덕션 출시 게이트

기준일: 2026-07-31  
현재 결정: **NO-GO — 로컬 출시 후보 검증 완료, 운영 반영 증거는 없음**

이 문서는 “코드가 좋아 보인다”와 “실제 소비자에게 공개해도 된다”를 분리한다.
로컬 테스트 통과, 운영 DB 적용, 사람 답변 공급은 서로 다른 게이트다.

## 출시 단위

이번 후보의 소비자 루프는 아래 하나다.

> 고민 작성 → 출처가 보이는 사람 답변 → 알림으로 재방문 → 해결 표시 → 문제가 있으면 신고 → 사유 통지·이의제기

다음이 한 번에 배포되지 않으면 커뮤니티 쓰기를 열지 않는다.

- `20260730100000_retire_undisclosed_community_agents.sql`
- `20260731180000_community_release_trust_boundary.sql`
- `20260731181000_community_reply_notifications.sql`
- `20260731182000_cohort_moderation_audit_boundary.sql`
- `20260731183000_community_operational_health.sql`
- 이 migration을 사용하는 웹 API와 UI의 정확히 같은 Git commit

## 자동 로컬 게이트

```powershell
node scripts/audit/community-release-readiness.mjs
node --test scripts/tests/community-release-readiness.test.mjs
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
corepack pnpm --filter @hanbang/web build
```

`community-release-readiness.mjs`의 기본 성공은 로컬 계약만 뜻한다.
`--production`은 외부 증거가 저장소 밖의 정식 release controller에서 검증되기 전까지
항상 실패해야 한다.

2026-07-31 로컬 증거:

- 커뮤니티 핵심 회귀: 24 files, 122 tests 통과
- 접근성 수정 후 UI 회귀: 9 files, 51 tests 통과
- 웹 전체 실행: 420 files 중 418 files, 3,615 tests 통과. 실패한 2 files의
  22 tests는 새 정지-user guard를 기존 업로드 test harness가 모의하지 않은
  회귀였고, harness 수정 후 해당 22 tests를 전부 재통과
- Supabase release controller/fence: 189 tests 및 static fence 통과
- 웹 typecheck, 전체 ESLint, `git diff --check`, production build 통과
- 브라우저 read-only preview: 게시글 우선 진입, 1,280px 가로 넘침 0,
  중복 ID 0, alt 누락 0, 보이는 상호작용 요소 44×44px 미달 0

위 결과는 hosted staging, 320px/375px 실기기 E2E, 운영 DB 적용 또는 배포
증거를 대체하지 않는다.

## 운영 반영 순서

| 순서 | 담당 | 해야 할 일 | 통과 증거 | 실패 시 |
|---:|---|---|---|---|
| 1 | 창업자+DB 담당 | 공개 유입·AI 댓글·커뮤니티 쓰기 중지 | 기능 플래그와 write fence 캡처 | 진행 중단 |
| 2 | DB 담당 | 현재 운영 DB와 Storage의 암호화 백업 | 최신 backup receipt, 원본 hash | 진행 중단 |
| 3 | DB 담당 | 다른 Supabase 프로젝트에 복원 | Auth/DB/Storage 표본과 row digest | 진행 중단 |
| 4 | 운영 담당 | 기존 글·댓글을 member/operator/ai/industry/legacy로 전수 분류 | 0개의 미분류 공개 콘텐츠 | 공개 유지 금지 |
| 5 | DB 담당 | 정확한 manifest 순서로 staging 적용 | migration ledger, SHA, postcondition | forward-fix 후 재검증 |
| 6 | QA 담당 | 질문·답변·재시도·알림·해결·신고·복원·이의제기 E2E | 계정별 화면/DB 증거 | 공개 금지 |
| 7 | 보안·법률 | 개인정보·광고·업체 분쟁·명예훼손 절차 검토 | 검토자·날짜·결론 문서 | 확대 출시 금지 |
| 8 | 운영 담당 | 1시간 개인정보/24시간 일반 신고 훈련 | 접수→조치→통지→복원 타임라인 | 공개 금지 |
| 9 | DB 담당 | production migration 1회 적용 후 read-only postcheck | clean ledger와 postcheck JSON | 자동 재실행 금지 |
| 10 | 창업자 | 20명 이하 통제 베타 시작 | 참여자 명단과 답변 슬롯 | 광고·확대 금지 |

직접 `supabase db push`를 실행하지 않는다.
`docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`의 controller와
정확한 owner lease를 사용한다.

## 필수 DB 사후조건

- 모든 공개 글·댓글의 `content_origin`이 null이 아니다.
- `legacy_unverified` 공개 행은 0개다. 사람으로 확신할 수 없으면 공개하지 않는다.
- persona backing user의 공개 글·댓글·메시지·반응은 0개다.
- 동일 이용자의 동일 글/댓글 중복 신고는 0개다.
- `trg_report_auto_review`는 존재하지 않는다.
- moderation notice마다 append-only event가 정확히 1개 있다.
- service role 이외에 moderation event 쓰기와 report status 변경 권한이 없다.
- 댓글 재시도 key 하나당 댓글 하나만 존재한다.
- 자기 자신에게 생긴 reply notification은 0개다.
- 운영 health RPC에서 사람 답변은 `member|industry_professional`만 집계한다.

## 소비자 E2E 시나리오

1. 비로그인 상태에서 검색어를 담아 질문을 시작한다.
2. 로그인 후 제목·본문·공개범위가 보존되는지 확인한다.
3. 전화번호, 이메일, 주민등록번호, 계좌번호가 포함된 텍스트가 422로 차단되는지 확인한다.
4. 개인정보를 가린 이미지로 글을 발행한다. 사진 속 글자는 자동 마스킹되지 않는다는 경고를 다시 확인한다.
5. 다른 계정이 답변하고 같은 idempotency key로 재시도한다.
6. 댓글·카운터·알림이 각각 한 번만 생기는지 확인한다.
7. 알림을 눌러 정확한 답변 anchor로 이동한다.
8. 작성자가 해결됨으로 표시하고 다시 열 수 있는지 확인한다.
9. 제3자가 글과 댓글을 각각 신고한다. 중복·자기신고는 거절되어야 한다.
10. 운영자가 사유와 함께 숨기고 복원한다. hard delete는 없어야 한다.
11. 작성자가 운영 알림을 읽고 이의제기한다. 두 번째 제출은 409여야 한다.
12. 정지 계정은 새 글·답변·반응을 만들 수 없고, 자기 콘텐츠 삭제와 반응 철회는 가능해야 한다.

320px, 375px, 1440px에서 키보드만으로 위 흐름을 다시 수행한다.

## 공개 베타 Gate 0–3

| Gate | 기간 | 모두 만족해야 하는 기준 |
|---|---:|---|
| 0 신뢰 | 배포 전 | 미표시 AI·운영·협찬 0, 출처 분류 100%, P0 E2E 성공, 법률·복원·신고 훈련 완료 |
| 1 통제 베타 | 4주 | 24시간 사람 답변률 ≥80%, 첫 사람 답변 중앙값 ≤6시간, 해결 스레드 ≥20, 24시간 초과 신고 0 |
| 2 파트너 확대 | 추가 4주 | 24시간 사람 답변률 ≥85%, 질문자 답변 재방문 ≥50%, 주간 실제 답변자 ≥10, 비운영진 답변 ≥50% |
| 3 유료 유입 | Gate 2 유지 후 | 예상 질문 대비 답변 슬롯 ≥1.5배, 7일 질문자 재방문 ≥25%, 출처·보상 표시 100% |

AI 답변과 운영팀 답변은 사람 답변 SLA에 넣지 않는다.
분모가 0이면 100%가 아니라 `측정 불가`다.

## 즉시 중단 조건

- 미공개 AI·운영자·협찬 활동이 1건이라도 발견됨
- 개인정보 사고 또는 사진 속 식별정보 노출
- 24시간 사람 답변률이 이틀 연속 80% 미만
- 24시간 넘은 신고가 1건이라도 존재
- 미답변 질문이 5건을 초과
- 알림 중복·유실, 신고 자동숨김, moderation 감사 누락
- 운영자가 하루 2시간·주 15시간 안에 SLA를 유지하지 못함

이 경우 신규 유입과 쓰기를 끄고, 읽기 전용으로 전환한다. 이미 적용된 migration은
자동 롤백하지 않는다. 기능 플래그와 write fence를 유지한 채 감사 데이터를 보존하고
검토된 forward-fix를 배포한다.

## 창업자가 직접 해야 하는 일

- 매일 오전·저녁 미답변 질문과 신고 대기열 확인
- 실제 경험자 2명에게 질문을 직접 연결
- 답변 후 질문자에게 도움 여부와 해결 여부 확인
- 금요일마다 moderation 5건 무작위 재검토
- 매주 사람 답변률, 첫 답변 시간, 해결률, 미답변, 신고 SLA, 출처별 콘텐츠 수 공개
- 첫 4주는 광고비 0원, 질문 공급보다 답변 공급에 우선 투자

세부 모집 문구와 운영 루틴은
`docs/operations/COMMUNITY_LAUNCH_PLAYBOOK_2026-07-30.md`를 따른다.
