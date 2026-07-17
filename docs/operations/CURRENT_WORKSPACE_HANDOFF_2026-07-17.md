# 현재 작업 인수인계 — 2026-07-17 KST

> **CURRENT CHECKPOINT, NOT A PRODUCTION COMPLETION RECEIPT.** 이 문서는 다른
> 컴퓨터에서 현재 개발을 이어가기 위한 진입점이다. 정확한 후보는 이 문서를 포함해
> push된 `feat/amora-engine-v2-20260716`의 원격 HEAD와 PR #61로 확인한다. 운영 DB,
> 운영 배포, signed 모바일 빌드, 카나리는 아래에 명시된 대로 아직 완료되지 않았다.

## 이어서 시작하는 위치

- repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- branch: `feat/amora-engine-v2-20260716`
- pull request: `#61`
- 이번 checkpoint 직전 로컬·원격 HEAD: `122f3a75becd6eadf31162d68b8f97de6befce76`
- 운영 Supabase project: `slrtobkksjmxgzatjyqb`
- 운영 Vercel project: `wedding-hanbang-web`, production alias `hanbang.ai`
- 현재 릴리스 절차:
  `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`
- 운영 write fence:
  `docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md`

다른 컴퓨터에서는 비밀값이나 로컬 백업을 복사하지 말고 다음 순서로 시작한다.

```powershell
git fetch --prune origin
git switch feat/amora-engine-v2-20260716
git pull --ff-only origin feat/amora-engine-v2-20260716
corepack pnpm install --frozen-lockfile
```

원격 HEAD가 PR #61의 HEAD와 같은지 확인한다. dirty worktree가 있으면 덮어쓰거나
`reset --hard`하지 말고 먼저 별도 보존·비교한다.

## 현재 사실

### Git과 배포

- 이 checkpoint 전 원격 branch와 로컬 HEAD는 같았고 다른 컴퓨터의 미수집 commit은
  없었다. 이 문서를 포함한 다음 push부터는 원격 branch HEAD가 새 기준이다.
- PR #61은 마지막 조회 시 open, mergeable, clean이었다. 기존 GitHub/Vercel check는
  이전 HEAD의 결과이므로 새 push 뒤 다시 통과해야 한다.
- 현재 Engine V2 후보는 **운영에 배포되지 않았다**.
- 현재 보이는 Vercel Production deployment는 2026-07-16 02:03 KST에 만들어진 이전
  후보이다. `AMORA_OPENAI_ENABLED`와 `AMORA_COUPLE_QUOTA_ENABLED` 설정은 각각
  2026-07-17 10:57:48, 10:57:59 KST에 갱신됐지만 그 뒤 Production redeploy가 없었다.
  따라서 저장된 설정이 현재 실행 중 deployment에 반영됐다고 볼 수 없다. 이는
  사용자가 본 AI 생성 실패·베타 상담 소진 증상의 가장 유력한 운영 원인이다.
- 이전 deployment만 급히 재배포하지 않는다. 현재 후보의 DB·복구·빌드 gate를 먼저
  통과시킨 뒤 동일 commit으로 배포한다.

### 아모라

- 생성 provider는 OpenAI Responses API 한 곳이며 runtime allowlist는
  `gpt-5.6-luna`, `gpt-5.6-terra`뿐이다. Anthropic runtime·fallback은 없다.
- Luna가 기본이며 계약·고위험·반복 수정처럼 복잡도가 높은 경우에만 Terra를 쓴다.
  모든 생성 호출은 `store:false`, 제한된 출력, 감사·비용 원장과 전역 비용 guard를
  거친다.
- 커플별 베타 횟수 제한은 release contract에서 해제하는 설정이다. 전역 일일 사용량과
  USD 비용 상한은 유지한다. 이 설정도 새 Production deployment 전에는 실제 반영으로
  간주하지 않는다.
- 설계한 다섯 축은 코드와 DB 후보에 구현돼 있다.
  1. 장기 기억과 사용자 동의
  2. 근거·신뢰 구분
  3. 결정·일정·예산 실행
  4. 선제 케어·위험 대응
  5. 커플 관계·중재
- 일정·예산 변경은 모델 문장만으로 실행하지 않고 pending action을 보여준 뒤 사용자
  확인과 DB 성공 receipt가 있어야 완료된다.
- 다섯 축의 로컬 구현과 테스트는 통과했지만, 운영 DB migration·실제 provider smoke·
  fenced deployment·실기기 검증 전에는 “운영에서 완벽히 작동한다”고 말할 수 없다.

### WeddingCode

- 공개 진입은 안내 상태이며 결과 화면은 redirect되고 수집 API는 410으로 닫혀 있다.
- Candidate 5는 4축·16문항 연구 후보이고 모든 측정 타당도는 아직 M0다.
- 인지 인터뷰, 전문가 검토, 심리측정 검증 전에는 성향을 완벽히 측정하거나 과학적으로
  검증됐다고 홍보하지 않는다. 현재 후보는 production 수집 대상으로 승인되지 않았다.

## 2026-07-17 로컬 중간 검증

아래 결과는 누적 dirty working tree에서 영역별·전체 명령을 실행한 중간 증거다. 이
문서를 포함한 final clean commit의 GitHub checks와 clean-checkout gate를 대신하지
않으며, 새 원격 SHA에서는 해당 gate를 다시 통과해야 한다.

- Web: 186 files, 1,685 tests pass.
- Mobile: 69/69 tests pass.
- 전체 typecheck, lint: pass.
- Next.js production build: pass, 100 routes.
- Expo Web/iOS/Android export: pass. signed native build의 대체 증거는 아니다.
- WeddingCode: 79/79 targeted tests pass.
- OpenAI/model/cost/env targeted suites: pass.
- release static fence: 27 migrations, 3 platform operations, 3 rollback
  artifacts, 12 required documents verified.
- release controller/finalizer/provenance tests: 121/121 pass.
- encrypted backup synthetic E2E: 52/52 pass; fake CLI만 사용했고 운영 DB를 조회하지 않았다.
- PGlite write-fence/finalizer tests: 44/44 pass.
- SQL read-only/safety tests: 24/24 pass.
- `git diff --check`: pass.
- 변경 파일 secret scan에서 실제 OpenAI/Supabase/GitHub credential, private key, JWT,
  대용량 dump·backup·build artifact는 발견되지 않았다. 테스트의 가짜 key fixture만 있다.

로컬 테스트는 구현 증거다. hosted restore, 운영 환경, 실제 EAS와 실기기 증거를 대신하지
않는다.

## 운영에서 아직 완료되지 않은 gate

다음 항목은 모두 `NOT RUN / NOT CREATED`다.

1. 현재 후보의 final commit·manifest freeze와 새 GitHub checks.
2. SuccessHB·Sai·운영 프로젝트가 아닌 새 disposable Supabase restore project 생성과
   전체 27개 migration·upload 계약의 비운영 hosted 검증.
3. signed Android/iOS build와 실제 기기의 비운영 검증.
4. write-fenced Vercel deploy, Auth/signup·public DB·Storage global write freeze.
5. signed-upload URL의 DB-clock 130분 drain과 5분 추가 inventory 안정성.
6. 그 뒤 fresh 14-table 운영 pre-expand encrypted backup과 즉시 검증.
7. source와 target의 read-only `pg_control_system().system_identifier`가 다름을 포함한
   실제 provider physical restore·hosted schema/Auth/RLS/RPC 검증.
8. 운영 DB controller 적용과 final Storage contract.
9. fresh 27-table post-expand backup과 별도 hosted restore.
10. exact deployment의 실제 builder receipt, real-provider smoke와 5분 fenced canary.
11. exact-owner finalizer, Storage 음양성 canary, web fence exact redeploy, Auth signup
    재개.
12. fence 해제 후 최소 30분 제품·비용 관찰과 기능별 플래그의 독립 rollout.

위 항목 중 하나라도 실패하거나 증거가 없으면 PR merge, 운영 DB write, fence 해제,
Production 배포를 완료로 표시하지 않는다.

## 다음 실행 순서

1. 현재 전체 변경을 검토·stage하고 한 checkpoint commit으로 원격 branch에 push한다.
2. PR #61의 새 SHA에 대해 GitHub checks와 Vercel preview를 통과시킨다.
3. 새 disposable Supabase project에서 27 migrations와 upload contract를 먼저 검증한다.
   기존 `syhmfxauqyhgdcokrheg`는 존재하지 않으며 재사용하지 않는다. SuccessHB·Sai도
   쓰지 않는다.
4. signed Android/iOS와 실제 기기 gate까지 통과한 뒤에만 병합한다.
5. `PRODUCTION_WRITE_FENCE_2026-07-17.md`의 엄격한 순서대로 fenced deploy·Auth/DB/
   Storage freeze → 130분+5분 drain → 14-table backup/restore → migration → final
   Storage → 27-table backup/restore → fenced canary → finalizer/lift를 실행한다.
6. 모든 외부 receipt가 hash-bound로 모인 경우에만 완료로 판정한다.

## 비밀과 복구 자료

- OpenAI key, Supabase service-role/JWT, Vercel token, DB password, 사용자 원문,
  backup payload, DPAPI blob, raw private receipt를 Git·문서·로그에 넣지 않는다.
- 운영 DB password 재설정은 현재 절차에 필요하지 않다. 도구가 예상 밖으로 요구하면
  비밀번호를 바꾸지 말고 그 경로를 중단해 다시 확인한다.
- DB backup은 Storage object body를 포함하지 않는다. 두 복구 경로를 따로 검증한다.
- 실패 시 destructive down migration이나 migration repair로 맞추지 않고 write fence를
  유지한 채 forward repair 또는 공급자 restore를 선택한다.
