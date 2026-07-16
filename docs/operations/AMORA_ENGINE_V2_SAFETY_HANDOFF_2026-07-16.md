# 아모라 Engine V2 안전성 점검 인계서

기준 브랜치: `feat/amora-engine-v2-20260716`

기준 커밋: `ddf64f035b5d6b78532e4840892c7a4e0335a939`

후속 브랜치: `audit/pr61-safety-fixes-20260716`

이 문서는 PR #61의 독립 안전성 점검 결과와 다른 컴퓨터에서 이어서 작업할 때 필요한 상태를 기록한다. 이 브랜치는 검토용 체크포인트이며, 아직 `main` 병합·프로덕션 DB migration·프로덕션 배포를 승인하지 않는다.

## 이번 체크포인트에서 닫은 문제

### 기억 동의와 커플 구성

- 공유 기억은 파트너가 연결된 2인 커플에서 두 사람 모두 동의해야만 활성화된다.
- 커플 구성 변경 시 이전 공유 기억, 바뀐 역할의 private 기억, consent, profile, summary, queue를 원자적으로 무효화한다.
- enqueue, claim, upsert, atomic commit 단계마다 현재 구성원의 실제 동의를 다시 확인한다.
- 최초 실제 활성화 전에 생성된 무동의 legacy 기억은 철회 이력과 무관하게 한 번 정리한다.

### 기억 정확성·삭제·민감정보

- 기억 묶음, summary, queue 완료를 하나의 DB transaction으로 commit한다.
- 개인 항목 삭제 시 제목·값·근거·source message·actor UUID까지 tombstone에서 제거한다.
- 주민/외국인등록번호, 변형 전화번호, 계좌성 숫자, 상세 주소, 건강정보를 key/category/title/value/reasoning 전체에서 차단한다.
- 수동 기억 수정 API에도 같은 DLP 경계를 적용한다.
- 현재 커플 구성원이 실제로 보낸 같은 visibility의 user message만 기억 source로 사용할 수 있다.
- 공유 기억을 한 사람이 고쳐도 공동 확정이나 신뢰도 1.0으로 표시하지 않는다. 자동 compiler는 그 수정 문구를 덮지 않지만, 상태는 `considering`으로 유지한다.
- AI가 공유 대화에서 추출한 항목은 자동으로 공동 결정(`decided`)이 되지 않는다.

### 중재 선택안

- 저장된 AI message의 정확한 선택안 version에 acceptance를 묶는다.
- 현재 연결된 두 사람이 각각 확인한 경우에만 공동 결정 node를 만든다.
- 파트너가 없는 한 사람의 클릭으로 공유 결정을 만들지 않는다.
- 완료 전에는 자신의 확인만 취소할 수 있고, 공동 결정 완료 후에는 취소를 거부한다.
- 커플 구성 변경 시 이전 acceptance와 chat 기반 갈등 결정은 무효화한다.
- 웹과 모바일 모두 native 확인 카드, 상태 실패 차단, 새로고침, 확인 취소 흐름을 제공한다.

### 케어 발송과 릴리스 보호

- 외부 케어 이메일은 기본 비활성 kill switch `AMORA_CARE_OUTBOUND_ENABLED=true`일 때만 실행한다.
- 발송 직전에 커플 구성원을 다시 읽어 초기 roster와 달라졌으면 이전 파트너에게 보내지 않는다.
- release fence가 바로 전 릴리스 manifest의 hash-pinned migration도 다시 검증한다.
- remote pending migration은 집합뿐 아니라 manifest 순서까지 일치해야 한다.

## 현재 검증

- 전체 test: Web 100 files/661 tests, Mobile 22 tests, 대화 평가 9 tests 통과
- Web·Mobile typecheck와 lint 통과
- Next.js production build 통과
- Expo web/iOS/Android export 통과
- Mobile release readiness 70 checks 통과
- Release fence와 predecessor 변조 테스트 통과
- 원격 `feat/amora-engine-v2-20260716`은 기준 커밋과 동일함을 fetch 후 확인
- 실제 API key나 운영 secret은 커밋하지 않음

manifest hash와 `git diff --check`는 commit 직전에 다시 확인한다.

## 아직 남은 작업

다음 항목을 닫기 전에는 PR #61을 production-ready로 표시하지 않는다.

1. 실제 `/about`, `/landing`과 최상위 `PRINCIPLES.md`, `DESIGN.md`, `WEDDINGHANBANG_SERVICE_DOC.md`에서 견적 적정성 판단, 업체 추천·예약, 계약 안전성 판단을 현재 기능처럼 약속하는 문구를 제거한다.
2. 웹·모바일 실기기에서 중재 카드, 긴 한국어 문장, screen reader/VoiceOver, 320px 폭을 시각 검증한다.
3. hosted integration script를 roster 변경, 삭제 scrub, atomic commit, mediation revoke 계약까지 확장하고 비운영 Supabase clone에서 실행한다.
4. 공급자 physical restore 외에 HBAM2 논리 backup을 실제 isolated destination에 복구하는 rehearsal을 완료한다.
5. 프로덕션 migration은 승인된 Supabase CLI/controller로만 순서대로 적용하고, release fence와 post-condition을 통과한 뒤 별도 승인한다.

SAI는 별도 프로젝트이므로 이 체크포인트의 범위가 아니며 수정하지 않았다.

## 다른 컴퓨터에서 이어서 시작

```powershell
git fetch origin
git switch --track origin/audit/pr61-safety-fixes-20260716
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/mobile typecheck
```

PR #61에 직접 이어 붙이기 전에는 이 audit 브랜치의 draft PR diff와 CI를 먼저 확인한다.
