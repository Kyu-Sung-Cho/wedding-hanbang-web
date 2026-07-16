# 아모라 Engine V2 안전성 점검 인계서

기준 브랜치: `feat/amora-engine-v2-20260716`

검증된 기능·안전성 커밋: `c10b3afd313aec2f02708a8ed23b3f5561c4a1ea`

다른 컴퓨터 작업에서 가져온 커밋: `2b628748e510a280da6737a04d7eafd60db537ac` (PR #62)

이 문서는 PR #61에 PR #62의 안전성 수정과 후속 독립 감사를 통합한 상태를 기록한다. 위 기능 커밋은 로컬 전체 검증을 통과했지만, 아직 `main` 병합·프로덕션 DB migration·프로덕션 배포를 승인하거나 완료한 상태가 아니다. 이 인계서만 갱신하는 후속 커밋이 브랜치 HEAD에 추가될 수 있으므로, 기능 기준은 위 커밋으로 고정한다.

## 통합 상태

- `origin/audit/pr61-safety-fixes-20260716`의 PR #62 커밋을 현재 브랜치에 fast-forward로 통합했다.
- 2026-07-16 원격 PR과 브랜치를 다시 조회했으며, PR #62 외에 이 브랜치가 놓친 당일 후속 작업은 확인되지 않았다.
- 원격 `feat/amora-engine-v2-20260716`은 통합 전 `ddf64f03`에 있었고, 최종 push로 이 인계서와 검증 후보까지 한 번에 전진시킨다.
- 실제 API key, Supabase service key, 개인 인증정보는 커밋하지 않았다.

## 이번 체크포인트에서 닫은 문제

### 기억 동의·정확성·민감정보

- 공유 기억은 파트너가 연결된 2인 커플에서 두 사람 모두 동의한 경우에만 활성화한다.
- 커플 구성 변경 시 이전 공유 기억, 역할이 바뀐 private 기억, consent, profile, summary, queue를 원자적으로 무효화한다.
- enqueue, claim, upsert, atomic commit 단계마다 현재 구성원과 실제 동의를 다시 확인한다.
- 기억 묶음, summary, queue 완료를 하나의 DB transaction으로 commit한다.
- 현재 커플 구성원이 같은 visibility에서 보낸 user message만 기억 source로 허용한다.
- 주민·외국인등록번호, 전화번호, 계좌·카드, 이메일, 비밀번호, 도로명·지번 주소, 건강·임신 정보와 Unicode/NFKC 우회를 key/category/title/value/reasoning 전체에서 차단한다.
- 의미상 민감한 기억 후보가 제거되면 문맥이 사라진 summary도 fail-closed하며, 후보 없이 summary에만 남은 `현재 12주차` 같은 표현도 서버에서 제거한다.
- 수동 기억 수정 API에도 같은 canonicalization, key/category 허용 규칙과 DLP 경계를 적용한다.
- 공유 기억을 한 사람이 고쳐도 공동 확정이나 신뢰도 1.0으로 표시하지 않고 `considering` 상태를 유지한다.

### 중재 선택안

- DB trigger가 AI 중재안 전체 내용과 생성 당시 커플 구성에 `proposalVersion`과 `rosterFingerprint`를 발급한다.
- 사용자가 실제로 본 정확한 version과 roster를 웹·모바일·API·RPC 전체에서 전달하고, 둘 중 하나라도 없거나 바뀌면 확인을 거부한다.
- 저장된 제안 카드 내용이 바뀌면 완료 전 acceptance를 같은 transaction에서 무효화하고, 완료된 공동 결정의 제안은 변경하지 못한다.
- 현재 연결된 두 사람이 각각 확인한 경우에만 하나의 공동 decision node를 idempotent하게 만든다.
- 잠금 순서를 `message row → message advisory → OLD/NEW couple rows(UUID 순서) → decision/acceptance`로 통일해 경합 경로를 고정했다.
- 웹·모바일 카드는 revision별로 다시 마운트되며, 모바일 Realtime INSERT/UPDATE가 서버에서 stamp된 durable message로 교체한다. 권한을 잃거나 잘못된 UPDATE는 화면에서 제거한다.
- 운영 hosted integration script도 폐기된 5-argument RPC가 아닌 정확한 7-argument 계약을 검증한다.

### 백업·복구·릴리스 보호

- 백업 inventory가 필수 Amora 함수와 roster/mediation trigger를 명시적으로 확인한다.
- 7-argument mediation RPC를 요구하고 폐기된 5-argument RPC가 남아 있으면 백업 검증을 실패시킨다.
- 암호화 artifact, 외부 receipt anchor, schema drift, relation OID 교체, capture lock과 임시 평문 누출을 합성 E2E에서 검사한다.
- release fence가 현재 manifest뿐 아니라 바로 전 manifest의 hash-pinned migration도 다시 검증한다. 이전 migration과 이전 manifest를 함께 변조해도 현재 release pin이 차단한다.

## 최종 로컬 검증

- Web 전체: 102 files / 696 tests 통과
- Mobile 전체: 29 tests 통과
- 대화 평가 계약: 9 tests 통과
- DB PGlite migration/경합 회귀: 24 tests 통과
- 백업·복구 합성 E2E: 33/33 통과, 프로덕션 DB 조회 없음
- release predecessor tamper: 2/2 통과, static release manifest 통과
- Web·Mobile typecheck와 lint 통과
- Next.js production build 통과, 101개 route 생성
- Expo web/iOS/Android export 통과
- Mobile release readiness: 70/70 통과
- hosted integration script `node --check` 통과
- 변경 파일 34개 secret pattern scan 통과
- `git diff --check` 통과(CRLF 변환 안내만 존재)
- 별도 최종 diff 감사: 추가 ship blocker 없음

## 아직 남은 운영 게이트

다음 항목은 이 브랜치를 다른 컴퓨터에서 이어 개발하는 데는 방해되지 않지만, 완료 전에는 PR #61을 production-ready 또는 운영 배포 완료로 표시하면 안 된다.

1. 변경된 최신 migration과 hosted integration을 비운영 Supabase clone에 다시 적용해 roster 변경, 삭제 scrub, atomic commit, mediation 확인·취소까지 실제 PostgreSQL에서 재검증한다.
2. HBAM2 논리 backup을 실제 isolated destination에 복구하고 application post-condition까지 확인하는 rehearsal을 완료한다.
3. 실제 iOS/Android 기기에서 중재 카드, 긴 한국어 문장, 320px 폭, screen reader/VoiceOver/TalkBack을 시각·접근성 검증한다.
4. 프로덕션 migration은 승인된 Supabase CLI/controller로만 manifest 순서대로 적용하고, 별도 백업·rollback receipt와 post-condition을 확보한다.
5. PR #61 병합, 운영 배포, 배포 후 canary는 위 운영 게이트와 GitHub CI가 모두 통과한 뒤 별도 실행한다.
6. 카드별 중재 상태 GET의 N+1 요청은 기능 blocker는 아니지만 후속 성능 개선 항목으로 남는다.
7. `/about`, `/landing`과 최상위 제품 문서의 견적 적정성 판단·업체 추천/예약·계약 안전성 표현은 실제 제공 범위를 넘지 않는지 출시 전 다시 대조한다.

SAI는 별도 프로젝트이므로 이 체크포인트의 범위가 아니며 수정하지 않았다.

## 다른 컴퓨터에서 이어서 시작

```powershell
git fetch origin --prune
git switch feat/amora-engine-v2-20260716
git pull --ff-only origin feat/amora-engine-v2-20260716
git status --short --branch
git log -3 --oneline
```

새 작업은 clean worktree를 확인한 뒤 이 브랜치에서 계속한다. 운영 DB와 배포 작업은 위 운영 게이트 문서와 `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`를 함께 확인하기 전에는 실행하지 않는다.
