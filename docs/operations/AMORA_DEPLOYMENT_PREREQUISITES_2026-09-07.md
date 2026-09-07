# 아모라 배포 사전 절차 실측 — 2026-09-07

현재 상태: **운영 배포 미완료.** 사용자는 배포와 사전 절차 전체를 승인했다. 이 기록은 그 승인에 따른 실행·점검 결과이며, 추가 배포 허가를 요청하는 문서가 아니다. 코드의 로컬 검사와 실제 운영 데이터 복구·배포 증거를 구분한다.

작업은 `codex/amora-audit-fixes-20260906` / `wedding-amora-audit-fixes`에서 진행했다. 출발 커밋은 `6d8eee80617bc292070c1e697220b7598e2c7203`. `git fetch --prune origin` 후 확인한 운영 main은 `37c7448343f51db276840a45d8c515982bcdf720`이다. 원래 작업트리와 보관한 사용자 변경은 건드리지 않았다.

## 실제 확인한 것

| 항목 | 이번 실행에서 확인한 범위 |
|---|---|
| DB 연결 | 기존 공식 CLI 자격증명으로 300초 임시 읽기 역할을 발급하고, 공식 CA의 `verify-full` 검증을 거쳐 session pooler에 접속했다. 운영 비밀번호는 회전하지 않았다. |
| 읽기 전용 실행 | native 연결에서 `BEGIN READ ONLY; SET LOCAL ROLE supabase_read_only_user`가 필요함을 실측했다. `PGOPTIONS`만 주어서는 pooler에서 읽기 전용 설정이 전달되지 않았다. |
| CLI 실행 정체성 | 고정한 CLI 2.106.0의 `db query --linked`를 읽기 전용 SQL로 실행해 `current_user=postgres`, `session_user=postgres`, `transaction_read_only=on`을 확인했다. 원격 쓰기 SQL 성공 증거는 아니다. |
| 백업 범위·크기 | 카탈로그 relation 272개 중 원본 보존 대상 252개(실제 테이블 245개와 시퀀스 7개)의 행 수·JSON 크기 집계에 성공했다. 원본 행은 수집하지 않았다. 집계는 일관된 백업 snapshot이 아니다. |
| Storage 크기 | metadata 기준 객체 662개, 합계 104,928,672 bytes, 최대 객체 4,682,942 bytes였다. 현재 암호화 envelope의 개별 크기 한도를 넘는 항목은 없었다. 실제 원본 다운로드·해시·복구는 아직 하지 않았다. |
| 제공사 백업 | `2026-09-06T20:15:11.964Z` 기록의 physical backup이 `COMPLETED`임을 API에서 확인했다. 자체 복구 시험 완료를 뜻하지 않는다. |
| Vercel 설정 | 현재 프로젝트의 Production branch는 main이다. 기존 Preview에는 Supabase/OpenAI 값이 배정되지 않아 실제 DB·모델 통합 시험에 사용할 수 없다. Secret의 외부 export 제한을 운영 키 부재로 해석하지 않았다. |
| 현재 서비스 | `2026-09-07T00:14:31Z`의 공개 GET에서 랜딩과 `/api/health` 모두 200, DB `up`, 배포 커밋 `37c7448343f5`를 확인했다. 신규 candidate 배포 검증이 아니다. |

공식 임시 역할은 만료되어도 역할 행과 멤버십이 남는다. 이번 접속 시험에서 `cli_login_supabase_read_only_user`가 만들어졌고, 정상 CLI 초기화는 기존 `cli_login_postgres`의 만료 시각도 갱신했다. 이 관리 메타데이터 변화와 제품 테이블·마이그레이션 변경을 혼동하지 않는다. 역할 DROP, 기존 암호 회전, 제품 DDL/DML, Storage 원본 변경은 수행하지 않았다.

## 실행 준비 중 발견한 결함

1. **정상 CLI 접속이 baseline 검사를 실패시키는 문제.** 기존 전체 역할 해시에 `rolvaliduntil`이 포함되어, CLI가 만료 시각을 정상 갱신해도 `LIVE_SCHEMA_DRIFT`가 발생했다. 기존 snapshot을 보존하고 정확히 두 CLI 역할의 만료만 별도로 검증하는 보충 기준을 반영했다. 역할의 권한 속성과 전체 멤버십은 계속 비교 대상이다. 원래 기록의 만료 시각을 대입한 읽기 전용 재계산으로 기존 역할 해시도 그대로 재현했다.
2. **현재 DB 기준에 맞는 배포 후 해제 실행기 부재.** 새 실행기는 현재 적용 영수증, 소유자, 실행 단계, 백업·배포·canary 원문, 전체 카탈로그를 확인한다. 실패하거나 SQL 응답이 불명확하면 재실행을 막는 claim과 외부 쓰기 차단을 유지한다. 로컬 회귀와 실제 hosted 해제 성공은 별개다.
3. **해제 직전 만료 경계.** 물리 백업의 26시간 유효기간도 SQL 안의 종료 시각에 포함했다. 사전검사 통과 뒤 잠금을 기다리는 동안 만료되면 COMMIT 전에 전체 트랜잭션을 되돌린다. 임시 CLI 역할의 유한 만료·310초 상한도 원자 SQL 안에서 다시 확인한다.

## 운영 적용 전에 남은 실행 조건

- **원본 복구 환경 격리:** 후보 `tvyblzioajnfsbkciubk`는 Data API와 Auth provider, Realtime이 열려 있다. 설정을 바꿀 공식 경로는 조사했으나 전체 공개 접근·외부 송신 차단을 실증하지 못했다. DB network restriction은 HTTPS Auth/Storage 접근을 막는 기능이 아니다. API 키 차단만으로 공개 Storage URL까지 막았다고 판단할 수도 없다. 원본을 복사하지 않았다.
- **원본 백업·복구·hosted 회귀:** 제공사 백업 존재, 읽기 권한, 크기 집계는 확인했다. 그러나 현재 252개 대상과 Storage 원본 전량의 HBAM2 수집·복호화·격리 복구 비교, 신규 SQL 8개의 hosted 권한·동시성·rollback 검증은 완료되지 않았다. 이전의 소수 테이블/PGlite 결과로 대체하지 않는다.
- **업로드 중단·만료 검증:** 현재 코드의 signed upload 발급 경로를 확인했다. 이미 발급된 URL의 만료 대기, TUS/S3 경로 확인, 실제 원본 객체 안정성 비교는 아직 수행하지 않았다. 이를 시작하기 위해 운영 업로드를 중단하지도 않았다.
- **Auth 차단과 canary의 단계 정리:** 백업 계약은 Auth 로그인·refresh 차단을 요구하지만 기존 canary는 인증 성공을 요구한다. 전체 Auth 차단을 유지한 상태에서 해당 canary를 성공했다고 기록할 수 없다. 운영자 전용 합성 계정 시험과 공개 Auth 재개 순서가 실제로 검증되어야 한다.
- **관리자 동시 변경:** PostgreSQL의 DDL event trigger는 역할 같은 공유 객체의 변경을 포괄하지 않는다. 현재 SQL의 일반 DDL 잠금을 모든 관리 작업의 원자 차단으로 소개하지 않는다. 별도 관리 작업 중단과 hosted 동시성 검증이 남아 있다.

이 조건을 건너뛰지 않는 근거는 저장소 `AGENTS.md`의 운영 DB·Storage·배포 규칙과 `PRINCIPLES.md` P6다. 현재 릴리스 계약은 `requires-runtime-evidence` 상태를 유지한다. 실제 자료 대신 `passed: true`를 작성하거나, raw `supabase db push`, 약한 과거 정책 복원으로 통과시키지 않는다.

## 이번 변경의 최종 로컬 검사

`verify-change`를 출발 커밋 기준으로 실행했다. diff가 선택한 범위는 `repoScripts`이며, **저장소 검사 390개 PASS / 실패·취소·skip 0**이었다. 만료 기준 검사 42개와 신규 finalizer 검사 12개는 이 390개에 포함되므로 중복 합산하지 않는다. 새 검사의 의미 변이 증명도 정상 등록됐다.

TTL 기준 변경 5개, finalizer 변경 10개의 서로 다른 반례를 실제로 심어 모두 검출하고 원복했다. 오류 종류와 원복 해시를 확인했으며 구문·임포트 실패를 정상 검출로 세지 않았다. PGlite에서는 역할 속성·멤버십 지문, 카탈로그 변경 거절, 종료 시각 만료에 따른 트랜잭션 rollback을 실행했다. 이는 실제 Supabase 전체 복구·해제 증거가 아니다.

이번 출발점 이후 `apps/`와 `packages/`에는 변경이 없다. 웹·모바일·shared의 앞선 전체 제품 검사는 round5 보고서의 커밋·검증 범위를 따른다. 이번 390개 검사를 새 웹 전체 검사라고 표현하지 않는다. 최종 영수증과 원문 로그는 `team-round6-deployment-20260907/final-gates/`에 복사해 보존했다.

## Vercel 실행 순서의 확인 사항

실제 쓰기 차단 변수는 `PRODUCTION_WRITE_FENCE_ENABLED`다. `MAINTENANCE_MODE`만 켜는 것으로는 현재 코드를 차단할 수 없다. 환경변수 변경은 기존 deployment에 소급되지 않아 차단 설정을 포함한 배포와 실제 응답 검증이 필요하다.

공식 `deploy --prod --skip-domain`은 운영 환경으로 candidate를 만들되 도메인 연결을 옮기지 않는 경로다. DB와 필수 증거가 준비된 뒤 정확한 Git SHA를 검증하고 promote해야 한다. 이전 deployment로의 즉시 rollback은 그 배포의 환경변수로 돌아가므로, 차단이 꺼진 과거 버전으로 복귀하는 경우를 따로 다뤄야 한다.

공식 `vercel curl`은 deployment 보호를 해제하지 않고 접근하지만 최초 실행에 자동화용 bypass token을 만들 수 있다. 이번 조사에서는 도움말만 확인했다. 보호된 candidate 시험, 실모델 평가, 운영 canary를 수행했다고 표시하지 않는다.

## 증거 위치와 출처

이번 원시 조사와 안전한 metadata는 저장소 밖 `team-round6-deployment-20260907`에 보관했다. 자격증명·원본 사용자 행을 Git이나 조사 로그에 저장하지 않았다.

- `backup-capacity-readonly.json`, `inspect-backup-capacity.ps1`
- `db-transport-and-restore-isolation-review.md`, `readonly-pooler-probe.json`
- `cli-default-identity-readonly.json`, `temporary-role-baseline-diff.json`
- `vercel-release-readiness.md`, `cli-role-expiry-baseline-design.md`
- `current-production-public-readonly.json`

이전 제품 수정과 검사 범위는 `AMORA_TEAM_ROUND5_COMPLETION_REVIEW_2026-09-07.md`를 따른다. 이번에는 배포 실행 경로를 보강하며 제품 화면·아모라 동작을 새로 변경하지 않았다.

공식 자료: [Supabase 임시 CLI 역할](https://supabase.com/docs/reference/api/v1-create-login-role), [psql 연결](https://supabase.com/docs/guides/database/psql), [백업·복구](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [network restrictions 범위](https://supabase.com/docs/guides/platform/network-restrictions), [Storage 접근 모델](https://supabase.com/docs/guides/storage/buckets/fundamentals), [signed upload의 유효기간](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), [TUS의 유효기간](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [PostgreSQL event trigger의 공유 객체 예외](https://www.postgresql.org/docs/17/event-trigger-definition.html).
