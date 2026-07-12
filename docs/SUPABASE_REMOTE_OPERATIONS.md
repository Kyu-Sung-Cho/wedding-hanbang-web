# Supabase 원격 운영 절차

웹·DB·모바일을 함께 배포하거나 장애 복구를 판단할 때는
[`PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](./PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md)를
같이 따른다. 이 문서는 Supabase 변경 절차를, runbook은 전체 출시 순서와
복구 의사결정 경계를 정의한다.

이 문서는 공유·운영 Supabase에 변경을 적용할 때의 유일한 표준 절차다. 운영 DB에는 Supabase CLI의 원시 `db push`, `db reset --linked`, `migration repair`, `--include-all`을 직접 실행하지 않는다. 이를 우회하던 package alias도 의도적으로 제거했다.

## 현재 출시 판정 (2026-07-12)

- OpenAI Luna·Terra 런타임과 새 migration 체인은 폐기 가능한 Supabase preview에서 검증했다.
- 폐기 가능한 preview에서 baseline부터 `20260711148000`까지 migration 107개를 빈 DB에 연속 재실행했다. DB lint, 함수 50개·cron 5개·직접 호출 차단 trigger 함수와 실제 binding 각 8개의 exact contract, lifecycle smoke와 anon 10-table probe가 모두 통과했다. 함수 source hash는 CRLF를 제거한 뒤 비교해 Windows/Linux replay 결과가 같고, rate-limit bucket은 service role도 직접 INSERT/UPDATE하지 못하며 canonical RPC만 사용한다.
- 새 `20260712100000_research_cohort_application_identity.sql`과 `20260712101000_durable_account_deletion_email_scope.sql`은 각각 연구 신청의 목적·이메일 확인 경계와 계정 삭제 재시도의 이메일 범위 증명을 추가하는 forward migration이며, 아직 폐기 가능 원격 DB에서 fresh replay·연속 upgrade를 통과하지 않았다. 따라서 위 107개 증거에 포함되지 않고 둘 다 별도 blocker다.
- 기존 Vercel 변수 inventory는 확인했지만 운영 비밀과 signed-app 항목은 미완료다. `ADMIN_PASSWORD` 회전, 별도 고엔트로피 `RESEARCH_EMAIL_VERIFICATION_SECRET`, Resend 실제 전달, signed `APPLE_TEAM_ID`, Play App Signing SHA-256을 별도로 확인해야 한다. 값은 기록하지 않는다.
- 새 코드의 `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`은 소개·사용자 연구 안내·정책·association 경로만 허용하고 로그인·앱·일반 API를 서버에서 차단한다. 실제 연구 정보 접수는 별도 서버 전용 `RESEARCH_COHORT_APPLICATIONS_ENABLED=true`가 있어야만 열리며, production/preview에서 미설정은 fail-closed다. 일반 베타 알림 신청과 연구 코호트를 같은 동의로 취급하지 않는다. 이 동작은 아직 운영 deployment에 반영되지 않았다.
- 운영 배포는 **NO-GO**다. `database-readonly-realtime-cron-v1` 도구는 연결 lock, clean HEAD/tree, 기존 pooled session 경계와 exact restore를 검사하지만 실제 disposable black-box 증거가 없어 fence는 `not_configured`다. production ship/reconcile과 operator 작성 evidence도 코드에서 추가로 hard-stop한다. 암호화 export 도구도 Phase A이며 실제 isolated restore를 실행하지 않았으므로 `backupPolicy.status=not_configured`다.
- 이전 CLI 조사 중 임시 login-role credential이 로그에 노출된 사고가 있었으므로, 기존 CLI login role과 PAT를 폐기하고 새 토큰으로 재로그인·재링크하기 전에는 원격 Supabase 명령을 실행하지 않는다.
- Git에 migration이 존재하는 것과 운영 DB에 적용된 것은 별개다. 아래 gate를 모두 통과하기 전에는 운영 DB를 변경하지 않는다.

## 필수 준비

- clean worktree의 검토 완료 commit SHA
- Supabase access token, 정확한 project ref와 DB password
- `scripts/release-targets.json`에 등록된 보호 대상과 검증된 직접 쓰기 차단 증거
- 승인된 age recipient, protected production이 아닌 restore project allowlist, 실제 DB/Storage restore drill 증거
- 원격 작업 대상은 `approvedNonProductionSupabaseProjectRefs`에 별도 승인된 폐기 가능 project ref만 허용한다. 현재 allowlist는 비어 있으므로 모든 non-production 원격 변경도 fail-closed다.
- maintenance 시작 이후 생성되고 완료된 30분 이내 물리 백업 또는 사전 승인된 동등 복구 증거
- 배포 commit과 동일한 Vercel maintenance deployment
- production preflight에서 요구하는 데이터 정리·명시적 ACK

비밀값은 현재 PowerShell 프로세스의 환경 변수로만 넣는다. `.env*`, 문서, 이슈, 채팅, Git에 기록하지 않는다.

## 원격 작업 전 credential 사고 복구 — 선행 hard gate

다음 순서를 모두 마치기 전에는 Preview를 포함해 Supabase 원격 명령을 실행하지 않는다.

1. Supabase Dashboard에서 해당 프로젝트의 기존 CLI login role을 삭제한다. Management API 기준 endpoint는 `DELETE /v1/projects/{ref}/cli/login-role`이다.
2. Supabase Account → Access Tokens에서 조사 당시 사용한 PAT를 폐기한다.
3. 로컬에서 `corepack pnpm exec supabase logout`을 실행해 캐시된 토큰을 제거한다.
4. 새 PAT로 interactive login을 다시 하고, 정확한 non-production ref에만 재링크한다. 토큰·DB password를 명령행 인수로 넣지 않는다.
5. 기존 credential이 더 이상 인증되지 않는지 값이나 오류 본문을 로그에 남기지 않는 방식으로 확인한다.

공식 기준: [Supabase Management API](https://supabase.com/docs/reference/api/getting-started), [Access Tokens](https://supabase.com/dashboard/account/tokens)

## Preview 검증

보호 대상이 아닌 폐기 가능한 preview에서만 전체 체인을 먼저 검증한다. 링크 대상과 DB URL host가 예상 preview ref와 일치하는지 확인한 다음 blank reset, DB lint, lifecycle smoke, post-deploy contract와 anonymous probe를 실행한다. preview Storage bucket 제거는 SQL이 아니라 공식 Storage API 스크립트로 수행한다.

핵심 명령 예시는 다음과 같다.

```powershell
corepack pnpm exec supabase link --project-ref <preview-project-ref> --yes
corepack pnpm supabase:lifecycle:smoke
corepack pnpm amora:openai:smoke
corepack pnpm supabase:fence -- -Action Plan -ExpectedProjectRef <preview-project-ref>
corepack pnpm supabase:recovery:test
```

blank reset처럼 파괴적인 preview 검증은 URL에 예상 preview ref가 포함되고 보호 대상 ref가 아님을 자동·수동으로 모두 확인한 경우에만 수행한다.

## 운영 baseline 조정

과거 DB에 core baseline migration 이력만 누락된 경우에도 일반 ship과 섞지 않는다. 먼저 read-only preflight가 현재 catalog가 baseline과 의미상 정확히 같음을 증명해야 한다.

```powershell
corepack pnpm supabase:baseline:core -- -ExpectedProjectRef <production-project-ref>
```

현재 production ref에서는 활성 fence lifecycle이 통합되기 전까지 이 명령도 hard-stop한다. 불일치가 있으면 자동 repair하지 않는다. 원인을 조사하고 별도의 검토된 forward migration을 만든다.

## 보호된 운영 적용

운영 적용은 아래 guarded workflow만 사용한다. 현재 launcher는 pnpm 인수 구분자 `--`를 제거해 OS별 PowerShell runtime으로 전달한다.

```powershell
corepack pnpm supabase:ship:safe -- -ExpectedProjectRef <production-project-ref>
```

현재 production에서는 이 명령이 원격 경계 전에 **반드시 중단**된다. 아래 항목은 snapshot·자동 probe producer 통합과 disposable restore drill 이후에만 활성화할 목표 계약이다.

1. worktree가 clean이고 실행 commit이 검토한 HEAD와 동일하다.
2. migration, reconcile, preflight, contract, release-target 파일의 hash가 실행 중 바뀌지 않았다.
3. 현재 link·project ref·DB host·branch topology가 예상 대상과 정확히 일치한다.
4. creator-aware production preflight가 테이블·열·타입·기본값·제약·RLS·함수 owner/ACL/search path/source·trigger·정리 대상 행을 검사한다.
5. 활성 fence snapshot, 기존 pooled session 교체, 직접 DB/Auth/Storage 쓰기 차단 자동 증거와 traffic drain이 유효하다.
6. maintenance endpoint의 deployment SHA가 검토한 HEAD 앞 12자리와 같다.
7. maintenance 시작 뒤의 최신 백업이 완료됐고 30분 이내다.
8. dry-run과 명시적 ACK가 실제 rewrite/delete inventory와 일치한다.
9. migration 후 exact post-deploy contract가 함수·ACL·trigger·RLS·retired object 부재를 검증한다.
10. fence 해제 뒤 폐기 bucket은 공식 Storage API로 제거되고, anon key probe가 민감 테이블 10개의 접근 거부를 확인한다.

어느 gate든 실패하면 작업은 실패이며, SQL Editor에서 수동으로 이어서 적용하지 않는다. 원인을 수정하고 같은 commit 기준으로 처음부터 다시 실행한다.

## 금지 사항

- 운영에서 원시 `supabase db push`, `db reset --linked`, `migration repair`, `--include-all` 실행
- 검토되지 않은 migration history 조작 또는 RPC만 수동 복사
- project ref, host, branch topology 확인 없는 DB URL 사용
- maintenance 이전 백업이나 진행 중 백업을 복구 증거로 인정
- SQL로 Storage bucket 행을 직접 삭제
- 데이터 blocker를 0으로 만들기 위해 소유권이 불명확한 사용자 데이터를 임의 삭제
- production fence를 통과시키기 위해 `not_configured` 값을 형식적으로 변경
- 오래 열린 브라우저·모바일 클라이언트의 직접 Supabase 쓰기가 남은 상태에서 권한 축소 migration 적용

## 적용 후

- 같은 commit으로 전체 테스트와 production build를 다시 실행한다.
- production URL에서 maintenance 해제, 인증, WeddingCode, 커플 재연결, Amora Luna·Terra, 권한 거부와 핵심 사용자 여정을 canary로 확인한다.
- console 오류, 5xx, latency, OpenAI 사용량·비용, account-deletion dead letter와 cron 상태를 관찰한다.
- 검증이 끝나기 전에는 성공으로 공지하거나 rollback 자산을 폐기하지 않는다.
