# 웨딩한방 공시가·업체탐색 수용 판정표

> **상태 snapshot.** 아래 시작 HEAD와 테스트 수치는 판정 당시 기록이다. 최신 구현·검증은
> Draft PR #64의 원격 branch HEAD와 2026-07-20 fixed-eight 인계 문서를 함께 확인한다.
> worktree-only 변경이나 과거 테스트 수치를 현재 push·CI·운영 승인 증거로 해석하지 않는다.

> **2026-07-20 전수 감사:** parser v3/converter v6의 현재 상태는 `253 files / 249 units`,
> `238 converted / 8 HWP manual / 3 current error / 0 stale error / 0 extracted /
> 0 validated / 0 loaded`다. 원본 253개와 current 산출물 332개의 해시·fingerprint
> 불일치는 0이다. 라온제나 drawing 1개와 케이트웨딩플랜 formula 4개를 canonical
> 산출물에서 확인했고, 오류 3개는 동일 원본 복사본 2개와 미지원 embedded EMF 1개다.
> 세부 근거는 `VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`를 따른다.

- 기준 문서: `CODEX 통합 개발 프롬프트 — 웨딩한방 공시가·업체탐색 모듈 (최종본)` §18
- 판정 시점: 2026-07-19 KST
- 검토 브랜치: `feat/vendor-disclosure-pipeline-v2-20260718`
- 검토 시작 HEAD: `3ab26298414d`
- 범위: 최종 수용 기준 24개와 운영 배포 선행 게이트

이 문서는 로컬 구현과 테스트가 보여 주는 사실, 실제 hosted 환경에서만 증명할 수 있는 사실, 아직 실행하지 않은 검증을 구분한다. 로컬 fixture나 mock 통과를 hosted staging·운영 검증 완료로 간주하지 않는다.
`NEXT_PUBLIC_PREVIEW_STUB_MODE=true`인 Supabase-free Preview 빌드 성공도 hosted DB,
migration 적용, 실제 공개 catalog 또는 운영 승인 증거로 간주하지 않는다.

## 판정 정의

| 상태 | 의미 |
|---|---|
| `PASS` | 해당 수용 기준을 직접 증명하는 재현 가능한 코드·테스트·명령 증거가 있다. |
| `PASS_WITH_BLOCKS` | 기준의 핵심 계약은 증명됐지만 해당 범위를 완전히 처리하려면 명시된 수동·외부 차단 항목이 남아 있다. |
| `BLOCKED_EXTERNAL` | 로컬 계약은 확인했지만 Supabase hosted 환경, Storage, 실제 관리자 계정 등 외부 조건이 없어 완료할 수 없다. |
| `NOT_VERIFIED` | 구현 또는 부분 테스트는 있으나 수용 기준이 요구하는 전체 동작·성능·브라우저 검증을 아직 실행하지 않았다. |
| `FAIL` | 명시적 누락이나 최종 스펙과의 충돌이 확인됐다. |

## 현재 결론

**NO-GO — 병합·운영 배포·카나리를 완료 상태로 보고할 수 없다.**

| 상태 | 개수 |
|---|---:|
| `PASS` | 11 |
| `PASS_WITH_BLOCKS` | 1 |
| `BLOCKED_EXTERNAL` | 5 |
| `NOT_VERIFIED` | 5 |
| `FAIL` | 2 |
| 합계 | 24 |

## PART A 판정

| ID | 수용 기준 | 상태 | 직접 증거와 보수적 판정 |
|---|---|---|---|
| A1 | 마이그레이션 클린 DB 적용 + 타입 재생성 | `FAIL` | 로컬 PGlite의 개별·순서 계약 테스트와 `20260720120000`까지의 정적 release manifest 검증은 통과한다. 그러나 `apps/web/src/types/database.types.ts`에 `agencies`, `price_snapshots`, `official_prices`, `official_price_options`, `v_public_official_prices`, `disclosure_semantic_staging`이 모두 0건이다. 실제 clean Supabase 전체 적용과 타입 재생성이 완료되지 않았다. |
| A2 | anon base select 차단, 공개 뷰 허용, 타 사용자 wishlist 차단 | `BLOCKED_EXTERNAL` | fail-closed probe는 base/public/owned-table 전 컬럼, 두 사용자 격리, 실제 `vendor_favorites`, view column·security option·definition hash, cleanup을 검증한다. Git `skip-worktree`·`assume-unchanged`로 숨긴 변경도 외부 요청 전에 거부한다. 다만 승인된 전용 hosted staging ref와 실제 두 세션 실행 영수증은 아직 없다. |
| A3 | 더미 시드 `/price/studio` 렌더와 검색·지역·대행사·가격·정렬 필터 | `NOT_VERIFIED` | `catalog.test.ts`가 이름/alias, 지역, 대행사, 기본가, wishlist, 최저가 정렬 조합을 검증한다. 실제 더미 DB를 연결한 `/price/studio` 브라우저 렌더와 조작은 실행하지 않았다. |
| A4 | 라운지 `업체 탐색`이 가격 리스트로 연결 | `PASS` | `Sidebar.tsx`는 canonical `/wedding/vendors` 여정을 유지한다. rewrite 대상 `/vendors`는 인증·데모 가드를 공유하는 앱 화면을 렌더하고, 선택 카테고리를 `/wedding/vendors?category=...` 안에서 이동한다. 모바일의 legacy UUID 상세는 같은 origin `/vendors/{uuid}`를 WebView로 열며, 찜·조합·알림 요청만 네이티브 세션의 폐쇄형 API bridge를 사용한다. |
| A5 | 0건 empty state, 견적 공유 CTA, `zero_result` 로깅 | `PASS` | `PricePresentation.test.tsx`가 지정 카피와 CTA를 검증한다. `runtimeDisclosureDataBoundary.test.ts`와 `PriceExplorer.tsx`가 전체 필터 결과인 `filtered.length`를 `zero_result`에 사용하는 것을 고정한다. |
| A6 | 조합 담기→추가금→합계→비로그인 저장 게이트 | `NOT_VERIFIED` | 옵션 범위/합계, session store, 세 슬롯, 로그인 게이트, 중복 저장 방지 컴포넌트·단위 테스트는 통과했다. 실제 브라우저 클릭 기반 전체 플로우는 실행하지 않았다. |
| A7 | 카테고리별 200개 업체에서 예산 역산 200ms 미만 | `PASS` | `budgetFinder.test.ts`가 카테고리별 200개 fixture, 최대 20개 반환, 200ms 제한을 검증했고 로컬 실행은 1ms였다. |
| A8 | 업체 상세 SSG + 유효한 JSON-LD | `NOT_VERIFIED` | 상세 JSON-LD는 공통 고정 FAQ를 재사용해 `BreadcrumbList`, `WebPage`, `Dataset`, `FAQPage` 네 구조를 생성하며 단위 테스트가 통과한다. 정확한 CI 조건의 비운영 build도 성공했다. 그러나 실제 발행 DB slug의 static params 산출과 외부 Schema validator 증거는 아직 없다. |
| A9 | 카드 노출부터 조합까지 올바른 event type/weight 실제 적재 | `BLOCKED_EXTERNAL` | event weight, context whitelist, 서버 weight 덮어쓰기, tracker batching 테스트는 통과했다. hosted DB에 실제 UI 플로우가 적재된 행을 조회한 증거는 없다. |
| A10 | 어드민 JSON 업로드→승인→발행→소비자 반영 | `BLOCKED_EXTERNAL` | upload/review/promotion API와 PGlite transaction 계약은 있다. 실제 관리자 계정, staging DB·Storage, ISR 재검증을 연결한 전 과정은 실행하지 않았다. |
| A11 | 확인 필요 병합이 alias를 남기고 재업로드 자동 매칭 | `PASS` | `vendorAliasProposalsMigration.test.ts`가 승인 alias 보존과 다음 업로드 exact 자동 매칭을 검증한다. |
| A12 | lookup 토큰 인증과 오타 유사 검색 | `PASS` | internal lookup route 테스트가 인증·`no-store`를, `pricePublicationImmutabilityMigration.test.ts`가 한 글자 오타 RPC 매칭을 검증한다. |
| A13 | 모든 공시 가격 화면에 §7.6 고지 두 줄 | `PASS` | `period.test.ts`, `PricePresentation.test.tsx`, 공통 `PriceDisclosureFooter`, 업체 상세가 지정된 두 문장을 사용한다. |
| A14 | 리스트 Lighthouse 모바일 성능 90+ | `NOT_VERIFIED` | Lighthouse/LHCI 설정이나 대표 데이터가 연결된 결과 보고서가 없다. 무데이터 build 시간은 이 기준의 증거가 아니다. |

## PART B 판정

| ID | 수용 기준 | 상태 | 직접 증거와 보수적 판정 |
|---|---|---|---|
| B1 | 혼합 포맷 scan manifest와 HWP 수동 큐 | `PASS_WITH_BLOCKS` | 2026-07-18 default baseline은 249 units, `converted=235`, `needs_manual_conversion=14`, `error=0`이었다. 2026-07-19 역사적 재처리는 `converted=241`, `needs_manual_conversion=8`, `error=0`이었다. 2026-07-20 current identity 전수 재처리는 `converted=238`, `needs_manual_conversion=8`, current `error=3`, stale `error=0`이다. error 3은 같은 SHA의 셀레네하우스 복사본 양쪽과 조선 팰리스 XLSX의 미지원 EMF를 의도적으로 fail-closed한 결과다. source 파일은 xlsx 219, docx 3, pdf 22, png 1, hwp 8이며 동일 stem PDF가 없는 HWP 8개만 수동 큐다. |
| B2 | 지정 구조·파일명 파서 테스트 | `PASS` | `scripts/ingest/__tests__/scan.test.ts`의 지정 구조 대응 테스트가 모두 통과한다. §3을 지키기 위해 실제 업체명 대신 동일 구조의 명시적 샘플명이 사용된다. |
| B3 | extract cache hit 무호출과 실패 상태 표시 | `PASS` | ingest 테스트가 cache hit 시 OpenAI API 미호출, 실패 unit 상태 표 노출을 검증한다. 고정 8건 무료 수동 감사는 했지만 현재 fixed-eight v7.11 계획의 실제 OpenAI 호출은 0건이므로 provider 품질 검증을 대신하지 않는다. 과거 append-only ledger의 유료 시도는 별도 역사 비용으로 유지한다. |
| B4 | 만원·소수 표기를 원 단위 정수로 변환 | `PASS` | money parsing fixture와 발생 위치 단위 양방향 coverage 테스트가 통과한다. 같은 금액의 다른 행, XLSX 중복 렌더링, 병합 가격 열, 수량·월 범위 제외를 회귀 검증한다. |
| B5 | 동일 지역 중복 업체 후보 탐지 | `PASS` | 동일 지역의 정확한 더미 쌍 `샘플정우웨딩`/`광주샘플정우웨딩`을 자동 병합하지 않고 dedupe 후보 1건으로 내보내는 테스트가 통과한다. |
| B6 | load provenance와 원본 Storage 보존 | `BLOCKED_EXTERNAL` | source file/quote/object key/hash 계약 테스트는 있다. 실제 ingest 상태는 `loaded=0`이며 staging Storage 업로드·보존·signed download 증거가 없다. |
| B7 | 검수 UI 근거·원본·수정 승인·중복 병합 | `BLOCKED_EXTERNAL` | preview route, signed URL 계약, 검수/병합 API·컴포넌트 테스트는 있다. 실제 Storage와 관리자 계정을 사용한 브라우저 E2E는 없다. |
| B8 | `/admin/enrich` Zod 자동 폼, 저장·검증, 링크 전용 검색 도우미 | `NOT_VERIFIED` | 필드별 Zod validator와 폼 metadata를 한 선언형 registry에 두고 validation schema·폼 정의를 함께 파생하며 drift 회귀 테스트가 통과한다. enrich route·검색 링크 계약도 테스트한다. 실제 관리자 브라우저 입력→저장→재조회는 hosted staging 부재로 실행하지 않았다. |
| B9 | 설명 가능한 recommend 결과와 3개 미만 완화 | `PASS` | `recommendation.test.ts`와 route 테스트가 태그·예산·필수속성 점수, 설명, 결과 부족 시 단계적 완화를 검증한다. 광고·수수료 변수는 점수 입력에 없다. |
| B10 | §3 금지사항 위반 없음 | `FAIL` | 과거 네 demo migration에 `샘플`로 명백히 표시되지 않은 실제 업체처럼 보이는 이름·브랜드·주소·가격·평점이 있다. 운영 문서는 이를 immutable migration의 유일한 핀 고정 예외로 기록했으나 최종 스펙은 예외를 허용하지 않는다. 이미 적용됐을 수 있는 migration을 재작성하면 안 되므로, 이력을 보존하려면 최종 스펙의 명시적 예외 승인이 필요하다. 신규 seed·fixture·runtime에는 예외가 없다. |

## 검증 명령과 결과

다음 결과는 별도 표시가 없는 한 로컬 workspace에서 직접 실행했다.

| 명령 | 결과 | 의미와 한계 |
|---|---|---|
| `corepack pnpm test:ingest` | `423 total / 422 pass / 0 fail / 1 Windows file-symlink EPERM skip` | scan/convert/cache byte integrity·안전한 orphan 정리/extract cache/XLSX drawing·formula 보존/정확한 보조 locator/발생 위치 coverage/money/dedupe/load·Storage·semantic staging 계약을 검증한다. 실제 provider·hosted write 증거는 아니다. |
| `corepack pnpm ingest:typecheck` | `PASS` | ingest TypeScript 계약 통과. |
| semantic staging·vendor merge PGlite 집중 회귀 | migration `5/5 PASS`, merge/direct-update `4/4 PASS` | 가격 기반·policy-only semantic의 승인 업체 병합, late-failure 전체 롤백, pending price vendor 직접 변경 원자 동기화, linked price snapshot 이동 차단을 실제 SQL 함수·trigger로 검증한다. 다중 세션 hosted 동시성 증거는 아니다. |
| `corepack pnpm --filter @hanbang/web test` | web `304 files / 2,597 tests PASS` | Turbo orchestration은 제한 시간 안에 종료되지 않아 web과 mobile을 각각 실행했다. 이 행은 업체 가격·예산·아모라·semantic migration을 포함한 web 전체 회귀다. |
| `corepack pnpm --filter @hanbang/web exec vitest run "src/constants/__tests__/runtimeDisclosureDataBoundary.test.ts" "src/lib/vendors/__tests__/publicDisclosureEvidencePrivacyMigration.test.ts" --reporter=verbose` | `2 files / 8 tests PASS` | 최신 `zero_result`, public `raw_text`, private `source_quote`, PII/길이 DB fence를 검증한다. |
| `corepack pnpm --filter @hanbang/web typecheck` | `PASS` | 최신 전체 P1 변경 뒤 재실행했다. |
| `corepack pnpm --filter @hanbang/web lint` | `PASS` | 최신 전체 P1 변경 뒤 재실행했다. |
| `corepack pnpm --filter @hanbang/web exec vitest run "src/lib/price/catalog.test.ts" "src/components/price/PricePresentation.test.tsx" --reporter=verbose` | `2 files / 9 tests PASS` | 필터 조합, empty state, 공시 원문, 로그인 경계, 조합 표시를 검증한다. |
| 업체 앱 여정·인증 bridge·쓰기 경계·예산 migration·아모라 업체 도구 대상 회귀 | `11 files / 74 tests PASS` | 웹/네이티브 bridge allowlist·크기 제한·401 전달, cookie CSRF와 native Bearer 분리, 앱 내 업체 화면, 옵션 없는 wishlist 적재, 추천·상세 상한, 예산 outlier 무변형 실패를 검증한다. 실제 기기·hosted DB 증거는 아니다. |
| `corepack pnpm --filter @hanbang/mobile test` | `111/111 PASS` | legacy UUID 상세, WebView same-origin navigation, 폐쇄형 업체 API bridge를 포함한 현재 모바일 전체 Node 회귀다. |
| Vercel Preview shape `next build` | `PASS`, 109 static pages | Preview stub 경계에서 번들·라우트 생성을 증명한다. 실제 운영 DB나 발행 업체 slug의 성공 증거는 아니다. |
| `corepack pnpm ingest status --state-dir reprocess-20260719-poppler5` | 249 total, 238 converted, 8 manual, 3 current error, 0 stale error, 0 current extracted/validated/loaded; historical ledger 713,410 input / 523,539 output | current converter v6 변환 identity와 역사 비용 원장을 증명할 뿐, fixed-eight v7.11 추출 품질·DB load·공개를 증명하지 않는다. |
| `corepack pnpm supabase:release:fence` | `PASS`, predecessor 27개 + successor 20개 migration hash/order 고정 | 20900의 combo direct-write fence, 21000의 0~10억원 웨딩 예산 계약, 20260720120000의 private semantic staging 계약을 포함한 로컬 정적 무결성만 증명한다. hosted 적용 또는 배포 준비 완료 증거는 아니다. |
| `corepack pnpm supabase:release:test` | `166/166 PASS` | backup·restore·write fence·release controller·SQL read-only·service destination·successor contract·semantic base-table deny를 포함한 hosted probe의 로컬 fail-closed 계약을 검증한다. 실제 hosted probe·backup·restore 영수증은 아니다. |
| `corepack pnpm supabase:release:fence:remote` | `NOT RUN` — manifest상 실행 전 차단 예상 | hosted staging, backup, restore, Storage, finalizer가 `missing`이다. 실제 remote 명령 영수증은 없으며, 실행한다면 DB 명령 전에 차단돼야 한다. |

### 타입 재생성 확인 명령

다음 확인에서 모든 심볼 수가 0이었다.

```powershell
$symbols = @(
  'agencies',
  'price_snapshots',
  'official_prices',
  'official_price_options',
  'v_public_official_prices',
  'disclosure_semantic_staging'
)
foreach ($symbol in $symbols) {
  (Select-String -LiteralPath 'apps/web/src/types/database.types.ts' -Pattern $symbol -SimpleMatch | Measure-Object).Count
}
```

## 해소된 P0 — 20700 release manifest drift

상태: **정적 무결성 해소 — 외부 배포 게이트는 계속 차단**

`20260718207000_public_disclosure_evidence_privacy.sql` 추가 직후 다음 명령이 실패했다.

```text
corepack pnpm supabase:release:fence
SUPABASE_RELEASE_FENCE_BLOCKED: MIGRATION_SET_DRIFT
expected: 20260718120000 ... 20260718206000
received: 20260718120000 ... 20260718206000, 20260718207000
```

이 결과는 안전 fence가 신규 미고정 migration을 올바르게 차단했다는 뜻이며, 당시 release-ready였다는 뜻이 아니다. 이후 successor manifest 마지막에 20700과 정규화 SHA-256을 고정하고 운영 문서의 migration 범위를 20700까지 갱신했다. 실패 이력은 삭제하지 않고 아래에 재검증 결과를 남긴다.

```text
재검증 일시: 2026-07-18 KST
재검증 working tree 기준 시작 HEAD: 3ab26298414d
당시 manifest 마지막 migration: 20260718207000_public_disclosure_evidence_privacy.sql
당시 normalized SHA-256: b6a1b3dcab9bbc47f0b9dcbef31f4a03097d837b149d8008656b822d105b4512
현재 manifest 마지막 migration: 20260720120000_disclosure_semantic_staging.sql
현재 마지막 migration normalized SHA-256: 67d57fdaf8af58611f76f87890754dd535a563c8e057e144248edcf019fec249
정적 fence 결과: PASS — predecessor 27개, successor 20개 migration 검증
관련 release 전체 테스트: PASS — 166/166
remote fence 결과: 미실행. manifest가 deployment_blocked이므로 외부 증거 전에는 DB 명령 전에 차단되어야 함
```

## 아직 확보되지 않은 실제 운영 증거

`docs/operations/VENDOR_DISCLOSURE_PIPELINE_V2_2026-07-18.md`와 successor release manifest가 다음 항목을 아직 미완료로 기록한다.

- 실제 OpenAI 고정 8건 추출과 2,342건 발생 위치 ground truth 자동 채점, token·비용 ledger.
  2026-07-19 문서는 prompt v6의 파일럿 결과가 아닌 역사적 채점표 제작 기록이고, 현재
  prompt `v7.11-exact-xlsx-auxiliary-repair`도 실제 provider 8건 실행 전까지 품질
  미검증이다. `docs/operations/VENDOR_DISCLOSURE_PILOT_MANUAL_AUDIT_2026-07-19.md`와
  `docs/operations/VENDOR_DISCLOSURE_FIXED8_EXECUTION_HANDOFF_2026-07-20.md` 참조
- hosted staging 전체 migration 및 dry-run 대조
- staging private Storage 업로드와 signed download
- hosted 두 세션 alias 경쟁·재조회·deadlock 부재
- destination-fenced 서버 저장으로 combo를 실제 생성한 뒤 같은 소유자 세션으로 삭제하고 재조회 0건을 확인한 hosted 양성 경로
- 실제 관리자 계정의 수정·승인·중복 결정
- 승인 데이터의 공개 페이지·아모라 end-to-end
- 집계 `pg_cron` job의 안전한 활성화·검증·비활성화 rollback 경로(현재 job은 의도적으로 `active=false`)
- 운영 DB backup/restore rehearsal
- 외부 서명형 단기 배포 승인 verifier와 successor release controller(현재 production build는 이 경로가 없어 의도적으로 fail-closed)
- 실제 EAS iOS·Android preview/internal binary build와 설치 smoke test
- migration 적용, 운영 배포, 배포 후 canary
- 대표 데이터가 연결된 Lighthouse 모바일 90+

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`의 상태는 이 증거가 채워질 때까지 `deployment_blocked`여야 한다. 차단을 우회하거나 미검증 항목을 임의로 `PASS` 처리하지 않는다.

## 완료로 전환하기 위한 최소 순서

1. 모든 신규 migration을 포함한 최신 웹·ingest·모바일 test/typecheck/lint/build를 처음부터 재실행한다.
2. clean Supabase DB에 정확한 migration 순서를 적용하고 `database.types.ts`를 재생성한다.
3. hosted staging에서 RLS, Storage, admin, events, alias 동시성, 공개 페이지·아모라 E2E를 실행한다.
4. 대표 더미/승인 데이터로 실제 모바일 브라우저 조합 플로우와 Lighthouse를 검증한다.
5. §3의 immutable legacy migration 예외를 최종 스펙에 명시적으로 승인하거나, 승인하지 않으면 전체 기준을 계속 `FAIL`로 유지한다.
6. 운영 backup과 restore rehearsal, rollback 담당과 절차를 확보한 뒤에만 운영 배포·canary로 진행한다.
