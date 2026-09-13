# W04 자동 피드백 저장 계약 보완

2026-09-13. 부모 커밋 `b0054e38c9a69a83d8e1fa910842629c57f9bb2c`.
기존 `ed8c7484`와 Git tree가 같음을 확인하고 내용 변경 없이 fast-forward했다.
상태: 코드·합성 DB 검증·정식 successor와 전용 production adapter 구현 완료.
**운영 DDL·푸시·배포 미실행**.

## 확인한 결함과 범위

- 현재 `saveAutomaticDissatisfaction`는 공유 상담에서만 분류된 신호를 저장하고,
  `message_id`, `correction`, `message_content`를 모두 `null`로 둔다. 고객 대화 원문이나
  가짜 메시지 ID를 추가하지 않는다. 개인 상담 두 범위는 저장 전에 제외한다.
- 운영 `pg_catalog`만 읽은 결과 `public.chat_feedback.message_id`는 `text NOT NULL`이다.
  현재 함수의 실제 payload를 동등한 합성 스키마에 넣으면 6종 모두 `23502`로 실패한다.
  `message_id`에는 FK·unique·별도 check가 없다. 사용자 FK의 Auth 삭제 연쇄,
  rating check, 기존 인덱스, service-role-only 정책은 별개이며 그대로 보존한다.
- Sentry `HANBANG-WEB-T` / event `305271911cd4490c9e93a53d6e73c7a8`는
  2026-09-12T05:30:28.112Z의 한 건이다. 원인이 스크러빙되어 이 과거 이벤트를 이
  결함 때문이라고 단정하지 않는다. 현재 코드와 운영 스키마의 불일치는 별도로 재현했다.
- 자동 저장이 성공하기 시작하면 기존 수동 시간당 20회 집계에 자동 행도 포함되므로,
  `/api/chat/feedback`의 집계에 `message_id IS NOT NULL` 조건을 추가한다. 인증 사용자,
  최근 1시간 조건과 수동 메시지 UUID·공유 범위 검증은 유지한다.
- 직접 소비자는 자동 insert, 수동 count/insert뿐이다. 피드백 GET과 장기 교훈 조회는
  비활성 동작을 유지한다. `message_id`를 고객 응답에서 무조건 문자열로 쓰는 새 경로는 없다.

## SQL과 실패 복구

파일: `supabase/migrations/20260913043211_chat_feedback_automatic_signal_nullable.sql`.
CLI `2.106.0`의 `supabase migration new`로 생성했다.
LF 원문 SHA-256: `084e2b1477517e9608833a4eb3a62a39c550a20a2f7e42a294b0728df26dae8e`.

실제 변경은 `ALTER TABLE public.chat_feedback ALTER COLUMN message_id DROP NOT NULL` 한 건이다.
트랜잭션 안에서 5초 lock timeout, 30초 statement timeout과 ACCESS EXCLUSIVE 잠금을 잡는다.
대상 text 컬럼을 확인하고, 전후 다른 컬럼·제약·인덱스·RLS·정책·권한·트리거가 달라지면
예외로 롤백한다. PostgreSQL 18의 이 컬럼에 해당하는 NOT NULL catalog 표현만 같은 변경으로
취급하고, 다른 NOT NULL 제약은 비교에서 제외하지 않는다.

- 잠금 실패 또는 SQL 오류: 트랜잭션 전체 롤백. 고객 행을 수정하거나 삭제하지 않는다.
- 이미 nullable인 상태: 반복 적용해도 다른 상태를 변경하지 않는다.
- COMMIT 결과가 불명확한 통신 실패: 자동 반복 적용하지 않고 현재 컬럼과 ledger를 읽어 판정한다.
- 적용 후 앱 롤백: nullable을 유지해도 구판 저장 코드는 호환된다. 수동 한도는 수정판 유지가 바람직하다.
- SQL 역변경: 유효한 NULL 자동 행이 생긴 뒤 `SET NOT NULL`은 실패한다. 이를 성공시키려고
  정상 행을 지우거나 메시지 ID를 만들어 넣지 않는다. 트랜잭션 내 ROLLBACK rehearsal과
  적용 후 앱 롤백은 별개의 경계다.

## 정식 로컬 계약과 운영 경계

`supabase/release-contracts/chat-feedback-nullability-v1.json`과
`scripts/lib/chat-feedback-nullability-release-contract.mjs`가 기존 explicit-budget 전신의
228개 SQL 원문, 전신 구현·관측·proof 해시를 보존하고 위 SQL 한 건을 더해 정확히 229개만 검증한다.
전신 운영 loader나 과거 핀·기본 fence는 수정하지 않는다. 과거 성공 테스트는
`d805f45b59a33d665a965274774d6a02244d948b`의 고정 Git blob fixture에서 실행하며,
현 체크아웃을 전신에 넘기면 계속 `NEW_MIGRATION_NOT_REVIEWED`로 거절하는 검사도 유지한다.

CI 및 공통 로컬 QA 명령은 `corepack pnpm supabase:release:fence --chat-feedback-nullability`다.
`--remote`, `--apply`, 중복·혼합 인자는 모두 거절한다. 이 성공은 **로컬 원문 검증**이며,
`productionApplyImplemented=true`는 전용 adapter 구현 여부이며,
`runtimeEvidenceVerified=false`, `releaseAuthorized=false`를 그대로 유지한다.

`supabase:release:apply --chat-feedback-nullability`는 이 변경 전용 `--inspect`, `--rehearse`,
`--apply` 중 하나와 아래 값을 모두 요구한다. 기존 광범위 release 게이트는 변경하지 않았다.

- `--expected-commit=<정확한 40자리 커밋>`: HEAD 일치·전체 clean 상태를 관측과 적용 직전에 확인한다.
- `--project-ref=slrtobkksjmxgzatjyqb`와
  `--confirm-production=chat-feedback-private-signal-20260913:slrtobkksjmxgzatjyqb:<모드>:<커밋>`.
- `--receipt-out=<존재하지 않는 절대 경로>`: append-only JSONL 영수증을 배타 생성하고 단계마다 fsync한다.
  인증 토큰·고객 행 없이 원문 SQL/구현/계약 해시, 관측한 catalog·ledger, 기한과 결과를 기록한다.

adapter는 고정 Supabase Management HTTPS 주소만 사용한다. 현재 DB identity, PostgreSQL 17,
대상 컬럼·현재 ledger를 읽고 서명한다. `--apply`는 과거 영수증을 신뢰하지 않고 같은 bundle을
먼저 ROLLBACK으로 실행해 다시 관측한다. 이후 2분 이내에 같은 원문과 서명이 유지된 상태에서만
COMMIT한다. DB 잠금 안에서도 기한과 catalog·ledger 불변을 확인한다. 정식 migration ledger에는
정확한 파일 버전·이름·원문 SQL 한 건만 같은 트랜잭션으로 추가한다. 적용 후에는 별도 읽기 전용
쿼리로 nullable, 관련 없는 catalog 보존, 이전 ledger 보존과 정확한 새 원문을 대조한다.
이미 같은 SQL이 등록되고 nullable이면 쓰기 없이 `already-applied-verified`로 종료한다.

HTTP 오류·중간 응답 손실·사후 불일치는 성공으로 표시하지 않으며 자동 재시도나 역변경을 하지 않는다.
영수증에 `outcome-requires-readonly-inspection`을 남긴다. 운영 순서는 수정된 수동 quota 웹 배포 후
새 영수증으로 `inspect → apply(내장 rehearsal) → 별도 inspect`다. 원격 실행은 담당자가 최종 검토한다.

사용자가 승인한 수정·검증·배포 범위에서 이번 행·Storage 무변경 nullable 확대에는 위 전용 경계를
적용하기로 root가 결정했다. 기존 광범위 릴리스의 백업·fence·복구 요구는 완화하지 않았다.
이 scoped rehearsal은 전체 DB/Auth/Storage 원본 복구를 완료했다는 증거가 아니다.

## 검증 증거

고객 행 조회, 고객 원본 복사, 운영 쓰기 없이 실행했다. 외부 원문 로그는
`C:/Users/kcho1/.codex/visualizations/launch-closeout-20260913/`에 있다.

| 검증 | 결과 / 기록 |
|---|---|
| 실제 자동 payload + native PostgreSQL 17.10 합성 스키마 | 7검사 PASS. `feedback-nullability-native-migration.tap`, `feedback-nullability-native-migration-receipt.json` |
| 실제 생성 production bundle + native PostgreSQL 17.10 | 6검사 PASS. 실제 다른 DB identity 거절, 합성 identity fixture에서 ledger 포함 롤백·catalog/기한 거절·실제 5초 lock timeout·적용/사후검사·이미 적용 상태의 무쓰기 확인. `feedback-runtime-native.tap`, `feedback-runtime-native-receipt.json` |
| 기존 NOT NULL → 같은 실제 마이그레이션 ROLLBACK → 적용·반복 적용 | PASS. 다른 catalog/기존 행 보존, 6종 저장, 개인 범위 무저장, Auth 삭제 연쇄와 권한·rating/FK 거절 유지 |
| PGlite PostgreSQL 18 합성 스키마 | `automaticFeedback.schema.test.ts` PASS. PG18 NOT NULL catalog 차이도 검증 |
| 수동 한도 RED → GREEN | 19개 수동 + 25개 자동은 허용, 20개 수동 + 25개 자동은 429. 타 사용자·1시간 밖 행 제외. `feedback-manual-rate-red.log`, `feedback-manual-rate-green.log` |
| 웹 직접 영향 검사 | 5파일 27검사 PASS. `feedback-targeted-final.log` |
| 전체 repository 검사 | `test:repo` exit 0. ingest 862개 중 858 PASS·기존 4 skip, repository 802 PASS. `feedback-repository-final.log` |
| 독립 검수와 직접 회귀 | 영수증 short-write 후 전량 기록·fsync 보완. 최종 전용 adapter/static 2파일 36검사 PASS. `feedback-runtime-reviewed-final.log`. 독립 검수에서도 부분 UTF-8 쓰기·0 진행 거절 및 원문 핀 일치를 확인했다. |
| 웹 typecheck | PASS. `feedback-typecheck-final.log` |
| 웹 production build | 합성 로컬 환경에서 실제 Turbopack compile·TypeScript·정적 생성 PASS, 연구용 경로가 운영 산출물에 없는지도 확인. `feedback-web-build-final.log` |

새 worktree의 외부 node_modules junction은 Turbopack이 거절했다. 해당 링크만 제거하고
기존 lockfile과 로컬 store의 `--offline --frozen-lockfile --ignore-scripts` 설치로 해결했다.
다운로드 0건이며 다른 worktree의 node_modules나 lockfile은 변경하지 않았다.

실제 운영 저장 성공 여부와 새 SQL 적용 영수증은 아직 없으므로 W04 운영 종결로 표시하지 않는다.
