# Supabase 원격 운영 절차

이 문서는 공유·운영 Supabase에 변경을 적용할 때의 유일한 표준 절차다. 운영 DB에는 Supabase CLI의 원시 `db push`, `db reset --linked`, `migration repair`, `--include-all`을 직접 실행하지 않는다. 이를 우회하던 package alias도 의도적으로 제거했다.

## 현재 출시 판정 (2026-07-11)

- OpenAI Luna·Terra 런타임과 새 migration 체인은 폐기 가능한 Supabase preview에서 검증했다.
- 폐기 가능한 preview에서 baseline부터 `20260711148000`까지 migration 107개를 빈 DB에 연속 재실행했다. DB lint, 함수 50개·cron 5개·직접 호출 차단 trigger 함수와 실제 binding 각 8개의 exact contract, lifecycle smoke와 anon 10-table probe가 모두 통과했다.
- 운영 배포는 **NO-GO**다. 직접 DB/Storage 쓰기 차단 증거가 `not_configured`이고, 운영 데이터 정합성 blocker와 maintenance 이후 백업 gate가 남아 있으며, Vercel 운영 환경 변수도 아직 검증하지 않았다.
- Git에 migration이 존재하는 것과 운영 DB에 적용된 것은 별개다. 아래 gate를 모두 통과하기 전에는 운영 DB를 변경하지 않는다.

## 필수 준비

- clean worktree의 검토 완료 commit SHA
- Supabase access token, 정확한 project ref와 DB password
- `scripts/release-targets.json`에 등록된 보호 대상과 검증된 직접 쓰기 차단 증거
- maintenance 시작 이후 생성되고 완료된 30분 이내 물리 백업 또는 사전 승인된 동등 복구 증거
- 배포 commit과 동일한 Vercel maintenance deployment
- production preflight에서 요구하는 데이터 정리·명시적 ACK

비밀값은 현재 PowerShell 프로세스의 환경 변수로만 넣는다. `.env*`, 문서, 이슈, 채팅, Git에 기록하지 않는다.

## Preview 검증

보호 대상이 아닌 폐기 가능한 preview에서만 전체 체인을 먼저 검증한다. 링크 대상과 DB URL host가 예상 preview ref와 일치하는지 확인한 다음 blank reset, DB lint, lifecycle smoke, post-deploy contract와 anonymous probe를 실행한다. preview Storage bucket 제거는 SQL이 아니라 공식 Storage API 스크립트로 수행한다.

핵심 명령 예시는 다음과 같다.

```powershell
corepack pnpm exec supabase link --project-ref <preview-project-ref> --yes
pnpm run supabase:lifecycle:smoke
pnpm run amora:openai:smoke
```

blank reset처럼 파괴적인 preview 검증은 URL에 예상 preview ref가 포함되고 보호 대상 ref가 아님을 자동·수동으로 모두 확인한 경우에만 수행한다.

## 운영 baseline 조정

과거 DB에 core baseline migration 이력만 누락된 경우에도 일반 ship과 섞지 않는다. 먼저 read-only preflight가 현재 catalog가 baseline과 의미상 정확히 같음을 증명해야 한다.

```powershell
pnpm run supabase:baseline:core -ExpectedProjectRef <production-project-ref>
```

불일치가 있으면 자동 repair하지 않는다. 원인을 조사하고 별도의 검토된 forward migration을 만든다.

## 보호된 운영 적용

운영 적용은 아래 guarded workflow만 사용한다. pnpm 11에서는 인수 앞에 `--`를 넣지 않는다.

```powershell
pnpm run supabase:ship:safe -ExpectedProjectRef <production-project-ref>
```

이 workflow는 최소한 다음을 모두 증명하거나 중단한다.

1. worktree가 clean이고 실행 commit이 검토한 HEAD와 동일하다.
2. migration, reconcile, preflight, contract, release-target 파일의 hash가 실행 중 바뀌지 않았다.
3. 현재 link·project ref·DB host·branch topology가 예상 대상과 정확히 일치한다.
4. creator-aware production preflight가 테이블·열·타입·기본값·제약·RLS·함수 owner/ACL/search path/source·trigger·정리 대상 행을 검사한다.
5. 직접 DB/Storage 쓰기 차단 증거와 traffic drain이 유효하다.
6. maintenance endpoint의 deployment SHA가 검토한 HEAD 앞 12자리와 같다.
7. maintenance 시작 뒤의 최신 백업이 완료됐고 30분 이내다.
8. dry-run과 명시적 ACK가 실제 rewrite/delete inventory와 일치한다.
9. migration 후 exact post-deploy contract가 함수·ACL·trigger·RLS·retired object 부재를 검증한다.
10. 폐기 bucket은 공식 Storage API로 제거되고, anon key probe가 민감 테이블 10개의 접근 거부를 확인한다.

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
