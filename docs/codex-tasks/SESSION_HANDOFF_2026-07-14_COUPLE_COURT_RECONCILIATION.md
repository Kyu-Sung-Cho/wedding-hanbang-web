# Couple Court WIP reconciliation handoff — 2026-07-14

## 결론

다른 컴퓨터에서 만든 Amora·Couple Court 작업은 유실 없이 Git에 보존했고, 현재 운영 기준
`origin/main`과 충돌을 해결한 별도 통합 브랜치로 만들었다. 이 브랜치는 코드 회수와 후속 분할 작업의
기준이지, 하나의 큰 PR로 병합하거나 운영에 배포할 후보가 아니다.

- 원격 WIP Draft PR #38 HEAD:
  `08f1309764762feda1828adfc9ecbbb85a25c26a`
- 로컬 전체 WIP 보존 브랜치:
  `backup/couple-court-wip-20260714`
- WIP 보존 commit:
  `e7c3106382fc5b537fa5f90db5ca30b0a0c04022`
- reconciliation 기준 `origin/main`:
  `d2eab99304c0d79fbbe6f20354074b229c9035cf`
- 안전한 통합 브랜치:
  `integration/couple-court-reconciled-20260714`
- merge checkpoint:
  `4a39a85ce16cab1570afcb56bb7611005a174a37`

PR #38과 `feature/couple-court`를 force-push로 덮어쓰지 않는다. PR #38은 139 commits·711 files 규모의
충돌하는 역사 보존 Draft이고, `feature/couple-court`의 `c46f4f7a75b133766f0213e2faf7b1282949d2bb`는
현재 통합 체크포인트보다 오래됐다.

## 이번 reconciliation에서 해결한 것

- WeddingCode PR #39/#40의 retired 웹·API·DB 계약을 우선해 수집 경계를 다시 열지 않았다.
- `/wedding-code` notice, result/legacy token redirect, 세 API `410` + `no-store`를 유지했다.
- 운영에 적용한 standalone targeted fence와 저장소 migration을 문서에서 분리했다.
- PostgreSQL 17 `MAINTAIN`을 포함해 runtime-role 권한 0을 검증하는 계약을 유지했다.
- community의 브라우저 Supabase client를 lazy wrapper 경계로 통일하고 설정 실패 UI를 보존했다.
- admin seed route는 gate 통과 뒤에만 service client를 생성한다.
- Windows CRLF checkout에서 migration contract가 흔들리지 않도록 현재 실패 테스트의 reader를 정규화했다.
- 현재 Production은 PR #40 merge `d2eab993...`, deployment
  `97F6fJLkAULPSpv9CVNGbbecvTpk`임을 운영 source of truth에 반영했다.

## 검증 영수증

merge checkpoint를 포함한 동일 clean Windows worktree에서 다음을 통과했다.

- frozen lockfile install
- 웹: 211 files, 1,641 tests
- 모바일 소비자 계약: 22 tests
- monorepo typecheck: 4/4 packages
- monorepo lint: 2/2 packages
- Next.js production build: 107 static pages
- mobile release readiness: 77 pass, 1 warning, 0 failure
- `corepack pnpm qa:local`: 전체 집계 gate pass, 433.6초
- full-history secret scan: 1,217 tracked/untracked files, 1,154 commits, 0 findings
- staged diff check, 충돌 마커, unmerged path: pass / 0 / 0

모바일 경고는 소셜 로그인이 hard-disabled라 store release를 인증하지 못한다는 뜻이다. 일반
`mobile:release-check`와 달리 store gate는 아직 실패하므로 앱스토어 제출은 NO-GO다.

## 병합·배포 차단 목록

아래 항목은 통합 브랜치를 큰 PR로 병합하지 않는 근거이자, 후속 작은 PR에서 닫아야 할 확인된 문제다.

### P1

1. 운영의 WeddingCode `CHECK (false) NOT VALID` fence 뒤에 전체 pending chain의 101100/101200 데이터
   rewrite를 실행하면 기존 token 행에서 실패할 수 있다. hard-stop을 유지하고, 운영과 같은 13행·token
   4개·retired constraint를 넣은 실제 PostgreSQL replay 시험과 digest 불변 계약 전에는 full chain,
   raw `db push`, ledger repair/mark를 실행하지 않는다.
2. retired WeddingCode 서버 notice는 과거 브라우저 local/session storage key를 읽지 않아, 개인정보
   페이지의 최대 30일 설명과 달리 legacy 답변·결과가 남을 수 있다. 별도 main 기반 hotfix에서 알려진
   key를 삭제하는 최소 client와 회귀 테스트를 추가해야 한다.
3. 모바일 store release는 소셜 로그인, signed association, 새 HEAD EAS build, 실기기 login/deep-link
   증거가 없어 NO-GO다.

### P2

1. 공통 JSON body limit가 `Content-Length`만 신뢰한다. 실제 stream 누적 limit와 header 생략·축소·chunked
   초과 테스트가 필요하다.
2. Amora feedback의 count와 insert가 같은 DB transaction이 아니어서 동시 요청이 20/hour 제한을 넘을
   수 있다.
3. Couple Court public comment replay RPC가 abuse limiter보다 먼저 profile row lock을 잡는다.
4. vendor favorites page는 Supabase 구성·auth 실패 시 무한 loading이 될 수 있다.
5. 채팅 저장 실패 중 새 attachment를 추가하면 복구 merge가 새 파일을 버리고 blob URL을 해제하지 않을
   수 있다.
6. DOCX의 5초 `Promise.race`는 응답만 끝내고 실제 mammoth 파싱 작업을 중단하지 않는다.
7. `images.unoptimized=true`가 UGC가 아닌 모든 Next Image까지 최적화를 끈다.
8. `.gitattributes`와 Windows CI에 SQL LF/대표 migration test 경계가 없어 CRLF 문제가 재발할 수 있다.
9. Couple Court 화면은 실제 calendar adapter가 없는데 일정 저장을 약속하는 문구가 있다.
10. 모바일 signup/recovery 웹 handoff 뒤 앱으로 안전하게 돌아오는 명시적 경로가 없다.
11. 모바일은 사용할 수 없는 OAuth 버튼과 divider를 항상 노출한다.
12. Couple Court 미래 timeline label `#88938E`의 white 배경 대비가 3.18:1로 WCAG AA 4.5:1에 못 미친다.

## 다음 컴퓨터에서 정확히 이어가기

```powershell
git fetch origin
git switch --track origin/integration/couple-court-reconciled-20260714
git status --short --branch
git merge-base --is-ancestor 4a39a85ce16cab1570afcb56bb7611005a174a37 HEAD
corepack pnpm install --frozen-lockfile
```

같은 이름의 로컬 브랜치가 이미 있으면 사용자 변경을 먼저 보존하고 `git switch` 후
`git pull --ff-only`를 사용한다. `.env.local`이나 비밀값을 다른 컴퓨터로 복사하지 않는다.

후속 구현은 `origin/main`에서 작은 독립 브랜치를 만들어 다음 순서로 분리한다.

1. WeddingCode legacy browser storage cleanup과 개인정보 문구 정합성
2. 공통 JSON stream limit·rate-limit 원자성 같은 공용 보안 경계
3. Amora OpenAI Luna/Terra 코드·비용·privacy·실패 복구
4. Couple Court UI/copy/accessibility와 feature flag off 상태
5. Couple Court migration을 disposable PostgreSQL에서 fresh/upgrade/replay 검증
6. 실제 인증 2인 E2E, signed mobile build와 실기기, staged canary

각 조각은 독립 PR·독립 rollback 단위여야 한다. 이 통합 브랜치의 전체 diff를 한 번에 `main`으로
병합하거나 Vercel/Supabase/EAS에 직접 적용하지 않는다.

## 수행하지 않은 것

- `main` merge 또는 직접 push
- 새 PR 생성 또는 PR #38 force-update
- Vercel Preview/Production 배포
- Supabase migration, ledger repair/mark, 데이터 수정·삭제
- EAS signed build 또는 store submission
- 운영 환경변수 값 조회·출력·변경

따라서 이번 완료는 “작업 유실 없이 최신 main과 합쳐 안전하게 원격 보존”까지다. 제품 출시, 운영 DB
migration, Amora 실제 OpenAI canary, Couple Court 출시, 모바일 store readiness를 완료했다는 뜻이 아니다.
