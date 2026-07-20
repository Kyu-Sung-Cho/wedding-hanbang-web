# 업체 공시 고정 8건 실행 인계 — 2026-07-20

## 현재 판정

- 저장소: `wedding-vendor-disclosure-v2`
- 브랜치: `feat/vendor-disclosure-pipeline-v2-20260718`
- 이 인계 작업의 최초 기준 ancestor: `150ee21d990662f6399a336c6e5576751ec351d3`
  (`feat(ingest): harden fixed-eight paid extraction`)
- 이 문서가 포함된 최종 HEAD는 자기 참조를 피하기 위해 본문에 하드코딩하지 않는다. 다른
  컴퓨터에서는 PR #64의 원격 branch HEAD를 fetch하고, GitHub check가 그 SHA에 귀속됐는지
  확인한다. 커밋되지 않은 worktree는 실행 승인이나 배포 증거가 아니다.
- 통합 PR: [#64](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/64), Draft, base `main`
- 2026-07-20 최신 재검증 시점까지 이번 연속 작업의 신규 유료 API 호출은 `0건`이다. 아래 변경과 테스트는 모두 로컬·무과금 경로에서 수행했으며, 실제 고정 8건 추출은 아직 시작하지 않았다.
- 내구성 비용 원장 원본은 `102행`, `67,495 bytes`, SHA-256 `32d3943160aa6ff656ce08b1411664bd3de2c1285657a15837b5eec0ccfd3d46`이며 기록 당시 누계는 `$4.0023985`다. nano-USD 올림과 GPT-5.6 보수 단가를 적용한 비용 fence 누계는 `$4.185901626`, `$20` 기준 잔여 예산은 `$15.814098374`다. 원장 바이트는 재작성하지 않는다. `$1.541804`는 v7.5·v7.6 두 실행만 더한 부분합이므로 전체 누계로 사용하면 안 된다.
- 로컬 유료 실행 도메인은 이미 최초 초기화됐다. 2026-07-20 read-only status는 canonical
  state binding·현재 ledger snapshot이 위 hash/행/바이트와 일치하고 `claim_count=0`,
  `pending_claim_count=0`, 예약 비용 `$0`임을 확인했다. init을 다시 실행하지 않는다.
- parser v3/converter v6 전수 재실행 뒤 유료 호출 없이 생성한 최신 paid-plan schema v4 계획은 `gpt-5.6-luna`, `125 requests`, 예상 input `1,357,066`, 예상 output `1,347,972`, 예상 비용 `$9.7841645`, 1회 최대 예약 `$2.769`, 전체 최악 비용 `$1,384.50`(정보용), 상태 `approved_sequential_runtime_fence`, SHA-256 `32fb11f972467405bed56ad3c1a59200b759f6702365b1583e0698e6debdf155`다. 계획 뒤에도 원장 `102행`과 위 ledger SHA-256은 그대로이고 claim은 `0건`이므로 이 계획 생성으로 비용은 발생하지 않았다.
- 실패 단위 유료 repair와 전체 배치·staging apply는 각각 실행 가능한 repair 러너와 상태 인식형 25건 러너가 완성될 때까지 코드 경계에서 차단한다.
- 운영 병합·운영 배포는 PR #64의 hosted evidence 게이트가 실패 중이므로 아직 NO-GO다.
- 2026-07-20 원본 전수 재검증 결과는 `253 files / 249 units / 23,767,447 bytes`, 원본 SHA 불일치 `0`, current v6 변환 산출물 `332 refs` 중 누락·fingerprint 불일치 `0`이다. 현재 단계는 `238 converted / 8 HWP manual / 3 current error / 0 stale error / 0 extracted / 0 validated / 0 loaded`다. 오류 3개는 동일 셀레네하우스 복사본 2개와 조선 팰리스 XLSX embedded EMF 1개다.
- canonical 산출물에서 라온제나 분당 drawing 1개와 케이트웨딩플랜 formula 4개를 직접 확인했다. B20/B25/B26은 원식과 기존 cached 금액 셀을 분리해 보존하고, C28 `TODAY()`는 실행 없이 기존 cached 표시값만 보존한다. formula 행의 cached 금액 중복은 `0`이다.
- Vercel Production의 `OPENAI_API_KEY`와 모델·feature flag는 `env pull`에서
  `[SENSITIVE]` marker로 내려오므로 로컬 값 길이로 유효성을 판정할 수 없다. 과거
  server-side Production checker에서는 OpenAI·모델 조건이 통과했지만 그 deployment는
  domain에 승격되지 않았다. 현재 로컬 ingest process에는 복호화 key가 없으므로 이번
  고정 8건 provider 호출은 시작하지 않았고 실제 신규 비용도 `0`이다.

## 실제 모델과 Luna의 의미

- 현재 `EXTRACTION_MODEL` env는 미설정이며 저장소 기본 해석이 literal API identifier
  `gpt-5.6-luna`이다.
- 여기서 `Luna`는 다른 공급자나 별칭으로 치환되는 이름이 아니다. OpenAI Responses API에 그대로 전달되는 모델 식별자다.
- 허용 모델은 `gpt-5.6-luna`, `gpt-5.6-terra` 두 개뿐이다.
- `OPENAI_API_KEY` 값은 Git, 로그, 문서, 채팅에 기록하지 않는다.

## 이번 안전성 변경

1. 최종 추출 캐시는 현재 요청별 체크포인트를 모두 다시 읽고 병합·금액 원장·증거 modality·토큰 합계를 재생한 결과와 같을 때만 사용한다.
2. 체크포인트와 최종 캐시는 결정론적 경로, 일반 파일, 현재 prompt/processing/scanner/converter/model identity, canonical content hash를 모두 검증한다.
3. 모델에 전달되는 이미지 바이트는 요청에 묶인 SHA-256과 즉시 대조한다. 같은 길이의 파일 교체도 차단한다.
4. 저해상도 확대 타일은 결정론적으로 다시 생성하고 기존 content-addressed 타일과 해시가 같을 때만 재사용한다. symlink/junction 및 선점된 임의 파일은 차단한다.
5. repair 재시도는 최초 요청과 다른 exact request hash를 비용 원장과 체크포인트에 기록한다.
6. 실제 OpenAI provider를 쓰는 core 경로와 CLI는 고정 8건의 정확한 순서가 아니면 공급자를 만들기 전에 중단한다. `--plan`도 같은 승인 범위를 사용한다.
7. validation은 extraction 체크포인트부터 최종 캐시까지 재생 검증한 뒤에만 실행한다.
8. score와 load는 검증 로직을 다시 실행해 `data`, `issues`, `coverage_gaps`가 저장된 pending artifact와 정확히 같은지 확인한다.
9. fixed-eight pass receipt는 strict validated-artifact 채점 모드를 명시한 보고서만 받을 수 있다.
10. `loadValidated({ apply: true })`는 CLI를 우회해 직접 호출해도 상태 인식형 배치 러너 완성 전에는 즉시 실패한다.
11. 현재 추출 계약은 prompt `v7.11-exact-xlsx-auxiliary-repair`다. 비-XLSX 텍스트 근거는 정확한 `line:N:` 접두어, XLSX 근거는 정확한 단일 셀 또는 `XLSX_DRAWING`/`XLSX_FORMULA` locator와 전체 payload를 사용한다. 기본 요청과 locator repair 모두 `line:5`/`line:51`, `B1`/`B10` 접두어 충돌, 잘못된 part/text-box/cell, payload 부분 인용, 합성 quote, 보조 행의 `line:N` 별칭을 허용하지 않는다. formula는 실행하거나 계산하지 않고 pricing-basis 근거로만 사용할 수 있다.
12. 유료 실행 전 승인 문서는 exact fixed-eight 순서, 모델, prompt/processing 버전, 원본·변환 fingerprint, 요청 해시, 토큰·비용을 content-addressed SHA-256으로 묶는다. CLI 실제 실행에는 `extract --plan`이 발급한 정확한 `--approved-plan-sha256`이 필요하다.
13. 실제 공급자 호출 직전 paid-call intent를 내구성 있게 기록하고, 비용 원장과 요청 체크포인트가 기록된 뒤에만 해제한다. 고아 intent는 수동 정산 전 재개를 차단하며, 비용 fence는 이전 내구성 원장 누계까지 포함해 `$20` 상한을 적용한다.
14. 유료 계획 schema v4는 계획 생성 직전의 비용 원장 바이트 SHA-256·바이트 수·행 수·누계와 domain committed nano-USD를 함께 묶는다. 계획 뒤 원장이 잘리거나 바뀌면 실행을 차단한다.
15. initial 요청과 응답 내용에 의존하지 않는 static repair 요청을 모두 계획 단계에서 미리 해시·승인한다. 실제 공급자 호출 직전 exact request hash가 승인 계획과 다르면 호출하지 않는다.
16. paid-call intent는 같은 디렉터리의 fsync 임시 파일을 hard-link no-overwrite 방식으로 원자 발행한다. 동일 요청을 동시에 시작해도 하나만 승인되고 나머지는 `already_pending`으로 닫힌다.
17. 체크포인트와 성공 비용 원장은 request id·usage·request fingerprint·승인 계획 SHA가 양방향으로 일치해야 한다. 같은 승인 계획의 부분 완료 재개는 완료된 요청을 다시 호출하지 않는다.
18. 원문 연결 검증은 단순히 인용문 안에 단어와 금액이 각각 존재하는 것만 보지 않는다. 같은 원본·같은 연속 행 블록 또는 같은 XLSX 레코드 영역에 속한 관계만 허용하며, 경쟁 업체·경쟁 금액·원거리 조각 합성은 `source_record_scope_ambiguous`로 차단한다.
19. 운영 `extractManifest`에서는 provider 또는 유료 실행 권위 경로를 주입할 수 없다. 임의 test provider는 production-paid 모드에 진입할 수 없다. fixed-eight 유료 체인 테스트는 OS 임시 경로와 schema 검증된 정적 응답만 받는 내부 scripted provider를 사용하며, API key 또는 유료 활성화 환경이 있으면 거부한다.
20. 승인 계획 schema v4는 요청별 예상 비용의 합계와 다음 1회 공급자 상한 예약이 잔여 승인액 안에 드는지를 검증한다. 최대 4회 시도를 모든 요청에 적용한 `maximum_cost_usd`는 정보용이며 승인액을 넘을 수 있고, 이때 `completion_not_guaranteed: true`다. 실행 시 환경 변수로 비용 상한을 올려도 실제 절대 fence는 계획의 절대 상한, 런타임 환경 상한, 고정 `$20` 중 가장 낮은 값만 쓴다.
21. 각 GPT-5.6 유료 시도는 비용 계산용으로 `1,050,000 input + 16,000 output`을 보수 예약한다. 입력 수치는 전체 context window를 그대로 사용해 현재 공식 모델 문서의 max input `922,000`보다도 크게 잡은 값이며 실제 공급자 입력 제한이라는 뜻이 아니다. Luna 1회 예약액은 cache-write `1.25배`와 272,000 초과 long-context `입력 2배·출력 1.5배`를 반영한 `$2.769`다. 실제 응답에서 cached/write 세부 토큰이 완전하고 서로 일치하며 정확한 완료 체크포인트가 있을 때만 실제 사용액으로 정산해 남은 예약을 해제한다. 미완료·모호한 claim은 전액 예약을 유지하고 공급자 사용량이 예약을 넘으면 수동 정산 전 중단한다. 누계와 예약은 nano-USD 올림, 상한은 nano-USD 내림으로 계산한다.
22. 유료 계획 전에 `~/.wedding-hanbang-paid-execution-v1` 로컬 실행 도메인을 명시적으로 한 번 초기화하고 상태를 확인해야 한다. 초기화는 기존 checkpoint namespace를 먼저 검사해 실패 시 authority나 anchor를 반쯤 만들지 않으며, state 안의 `.cache/paid-execution-domain-binding.json`에도 동일한 domain·manifest·canonical state binding을 no-overwrite로 남긴다. claim과 무관한 schema v1·test-only·genesis 이전 checkpoint는 역사 자료로 유지하되 완료 증거로 쓰지 않고, post-genesis production claim 관련 v3 checkpoint는 전체 무결성을 검증한다. 각 provider 시도는 계획 SHA·요청 hash·unit·fingerprint·batch·attempt에 묶인 영구 claim을 provider 호출 전에 원자 발행한다. claim은 정확히 한 개의 production ledger 행과 무결성 검증된 해당 batch checkpoint가 모두 있어야 완료로 인정하며, 누락·변조·state rollback·새 계획을 통한 동일 요청 재포장은 수동 reconciliation 전 차단한다.
23. 요청별 예상 비용 합계 또는 1회 최대 예약이 잔여 예산을 넘으면 승인 파일과 SHA를 만들지 않는다. 전체 최악 비용은 완료 가능성을 보장하지 않는 정보용 수치이며, 각 호출 직전 원자적 domain claim과 nano-USD fence가 다음 예약을 감당하지 못하면 provider 생성 전에 중단한다. SHA 없는 실제 실행도 provider 생성 전에 차단한다.
24. 저해상도 이미지 확대 타일은 Windows 긴 경로를 피하도록 같은 state 볼륨의 짧은 scratch 경로에서 생성한다. scratch 부모의 symlink/junction을 차단하고, 결과를 fsync·SHA-256 검증한 뒤 hard-link no-overwrite로 최종 content-addressed 경로에 발행하며 임시 파일과 디렉터리를 제거한다.

## 역사적 Vercel Preview 빌드 복구 증거

- Preview에는 운영 Supabase 공개 URL/anon key를 복사하지 않는다. Vercel의 Preview 범위에만 `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`를 둔다.
- 가격 상세 페이지의 정적 경로·메타데이터·페이지 렌더와 공통 가격 카탈로그 로더가 Preview 스텁에서 Supabase client를 열지 않도록 수정했다.
- 운영/일반 환경은 스텁이 없으면 기존대로 설정 누락을 숨기지 않고 fail-closed 한다.
- 로컬에서 `VERCEL_ENV=preview`, `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`, Supabase 공개 변수 공백 조건으로 전체 Next.js 빌드 및 109개 정적 페이지 생성을 통과했다.
- 수정 커밋 `bbb98a92`를 push한 새 Vercel 배포 `BkY4maSucyXG6vjCZgSe2wFMWmkQ`가 `Ready`가 됐다. Preview URL은 `https://wedding-hanbang-web-git-feat-vendor-disclosure-p-061770-hanbang.vercel.app`이다.
- Preview에서 `/price/studio`는 Supabase 설정 오류 없이 정상 렌더했고, 존재하지 않는 `/price/vendor/preview-vendor`는 정상 404로 닫혔다. Preview stub의 wishlist API가 의도적으로 503을 반환해 빈 목록 UI에 오류 안내가 보이는 점은 Preview 전용 UX 후속 항목이며 운영 성공 증거로 해석하지 않는다.
- 해당 push의 Web Quality, Mobile, Vendor Disclosure, Static Release, Vercel, Vercel Preview Comments 검사는 PASS다. Production Readiness는 hosted evidence 부재로 의도대로 FAIL이며, 그 결과 전체 Quality Gate와 운영 병합·배포는 계속 차단된다.
- 위 배포와 검사는 해당 과거 SHA의 회복 증거다. 최종 인계에는 PR #64 remote HEAD와 같은 SHA에 귀속된 새 checks만 사용한다.

## 고정 8건 순서

1. `7f21b5176a0063d2746ce81345d347d4e2218081c19c540be722e9505eecb587`
2. `0a7e35c83b56423e27308887c63be675f2d24123941d53b620d315c9f7fec89c`
3. `fb24bede2e46a3ee18a1426f7f6c0d4a82b0b069a17bee736339f89a4d0d2f00`
4. `467af65b41d314bbce9fddd38bff84961d33700d5e7da17f04e337afaa212ead`
5. `0aea5091993fbb729d4c746d0e31ecb26ef40c7c44030349c2e255f2a0d4ee38`
6. `9cd5e12d7941a7175b2388164081bb1c3886ea4b2badee4c80fff0ea18f9831c`
7. `cb0858314e9ea894d1cb90fb213cdda0d8aa00b2b6cd5b7839b5b96b07480e29`
8. `9bd413d45460d6f9e754a39d57592b25c1dc5adec8ea86bba0e432c83dce16a7`

앞의 7건은 blocking이고 마지막 메이브라이드 이미지는 non-blocking이다. 다만 메이브라이드도 반드시 실행·채점하며 판독 불가 금액은 `null + needs_review + coverage_gaps`로 남긴다.

```powershell
$units = '7f21b5176a0063d2746ce81345d347d4e2218081c19c540be722e9505eecb587,0a7e35c83b56423e27308887c63be675f2d24123941d53b620d315c9f7fec89c,fb24bede2e46a3ee18a1426f7f6c0d4a82b0b069a17bee736339f89a4d0d2f00,467af65b41d314bbce9fddd38bff84961d33700d5e7da17f04e337afaa212ead,0aea5091993fbb729d4c746d0e31ecb26ef40c7c44030349c2e255f2a0d4ee38,9cd5e12d7941a7175b2388164081bb1c3886ea4b2badee4c80fff0ea18f9831c,cb0858314e9ea894d1cb90fb213cdda0d8aa00b2b6cd5b7839b5b96b07480e29,9bd413d45460d6f9e754a39d57592b25c1dc5adec8ea86bba0e432c83dce16a7'
corepack pnpm ingest paid-execution-domain-status --state-dir reprocess-20260719-poppler5
corepack pnpm ingest extract --state-dir reprocess-20260719-poppler5 --units $units --plan
# 바로 위 계획의 SHA가 문서의 값과 정확히 같을 때만 실행한다.
corepack pnpm ingest extract --state-dir reprocess-20260719-poppler5 --units $units --approved-plan-sha256 32fb11f972467405bed56ad3c1a59200b759f6702365b1583e0698e6debdf155
```

## 불변 채점 근거

- base inventory SHA-256: `17a927f52d51774c9f3e149a3dba6fb3acfa0c5f79587d010089a00ac1988d75`
- base occurrences: `2,342`
- overlay SHA-256: `aa574571c58b4b513854a69457e232f5689dc443ec9571785c5232c772459810`
- adjudication SHA-256: `7c746d70d3bfc9c31c1af9689792fd0613fbca82ce480712a617681c65276afc`
- effective readable occurrences: `2,404`
- human-required occurrences: `7`
- unreadable cells: `2`

통과 기준은 blocking 7건 각각 지어낸 금액 `0`, 판독 가능한 누락 `0`, unsupported structured amount `0`, 업체·카테고리·지역·대행사 연결 오류 `0`, 실제 coverage gap `0`이다.

## 검증 현황

- `corepack pnpm test:ingest`: `423 tests / 422 pass / 0 fail / 1 Windows file-symlink EPERM skip`
- `corepack pnpm exec tsc -p scripts/ingest/tsconfig.json --noEmit`: PASS
- `corepack pnpm exec turbo run typecheck`: `4/4 PASS`
- `git diff --check`: PASS
- workspace package typecheck: ingest + shared + design-tokens + mobile + web PASS
- web full tests: `2,597/2,597 PASS` (`304` test files)
- mobile full tests after the cross-account refresh/replay fence: `111/111 PASS`
- web/mobile lint: PASS
- Vercel Preview 동일 환경 전체 web build: PASS (`109` static pages generated)
- Expo web/iOS/Android export: PASS
- mobile release readiness: `104/104 PASS`
- Supabase release tests: `166/166 PASS`
- static release fence: predecessor `27` + successor `20` PASS
- 가격 탐색 렌더 QA: 320/360/390/1440px에서 문서 가로 overflow와 새 console warning/error `0`; 320px 앱 화면의 아모라 launcher 중복은 컴포넌트 회귀 테스트로 `1개`를 고정했다.
- Preview에서 legacy UUID resolver는 유효하지 않은 UUID를 `/price/studio`로 안전하게 돌려보냈고, wishlist API의 의도된 `503`은 재시도 가능한 오류 UI로 표시됐다. 둘 다 운영 DB 성공 증거는 아니다.
- 실제 운영 공개 Supabase를 읽는 로컬 production build: `PUBLIC_VENDOR_STATIC_PARAMS_UNAVAILABLE`로 fail-closed. anon REST 직접 확인도 `v_public_prices`에 `404 / PGRST205`를 반환해 아직 migration 적용 및 발행 catalog를 증명하지 못했다.
- semantic 출처·연결, 변환 캐시 byte 무결성·안전한 orphan 정리, score receipt, load,
  paid-plan·ledger·authority 회귀는 위 `423`개 ingest 테스트에 포함된다.

이 결과는 코드의 자동 테스트 통과를 뜻할 뿐 실제 OpenAI 고정 8건 추출, 운영 원문 대비 채점, 파일럿 통과 또는 배치 실행 완료를 뜻하지 않는다. Preview stub으로는 인증 앱 shell과 실제 업체 데이터의 브라우저 E2E를 증명할 수 없고, 실제 기기 smoke도 별도 게이트로 남는다.

## Git 및 원본 격리

- Git에는 코드와 문서만 올린다. `scripts/ingest/.state/`, `data/raw/`, 비밀 env/API key, 중간 산출물은 커밋하지 않는다.
- 원본 외부 URL은 다시 직접 다운로드하지 않는다. `price.go.kr/.../file_down.do` 직접 fetch는 과거에 한 번 있었고 지시 위반이었다. 재발 금지다.
- 다른 컴퓨터에서 코드를 이어갈 수 있도록 코드·테스트·문서만 커밋·push한다. 원본, state, GT/overlay/adjudication 산출물, 유료 호출 원장·intent·승인 문서와 비밀키는 Git과 분리해 안전하게 백업·복구해야 한다. 현재 manifest와 artifact 경로는 로컬 state에 묶이므로 Git pull만으로 유료 적재를 재개할 수 없다.
- state 백업은 `.cache/paid-execution-domain-binding.json`을 그대로 보존하고, 백업 manifest에는 그 파일 hash와 현재 `domain_id`, domain manifest hash, 원장 snapshot hash·행 수·바이트 수를 참조값으로 기록한다. 실행 도메인 디렉터리와 인접 anchor는 state 백업에 복사하거나 과거 시점으로 복원하지 않는다. 삭제·복원·재초기화로 안전 차단을 우회해서는 안 된다.
- domain binding은 `authoritative_state_dir_realpath`를 고정한다. 고정 8건과 승인된 후속 배치가 모두 끝날 때까지 이 worktree와 state 디렉터리를 이동·이름 변경·삭제하지 않는다. 경로가 바뀌면 의도대로 fail-closed하며 자동으로 새 경로에 다시 묶지 않고 수동 reconciliation이 필요하다.

## 아직 해결되지 않은 차단 항목

1. **실제 고정 8건 실행·채점 전**: 이 문서 갱신 시점까지 신규 OpenAI 호출은 `0건`이다. Vercel Production secret은 로컬 CLI에서 복호화할 수 없으므로 실제 key를 현재 로컬 ingest process에 비공개로 주입해야 한다. 코드 테스트 통과는 실제 원문에서 지어냄·누락·연결 오류 0건을 증명하지 않는다.
2. **사람 검수형 exhaustive linkage map 부재**: 자동 검증은 업체명·카테고리·금액을 같은 원본의 같은 연속 line block 또는 XLSX record component에 묶고 모호하면 차단한다. 하지만 2,342개 수동 금액 inventory가 모든 업체·패키지·홀 소유 관계를 사람 검수로 전수 표기한 map은 아니다. 따라서 실제 8건 score와 수동 대조 전에는 연결 오류 0건을 선언하지 않는다.
3. **미지원 원본 미디어 1건**: 조선 팰리스 XLSX의 `xl/media/image1.emf`는 취소 시점별 배상률 정책 표다. v6는 이를 숨기지 않고 `xlsx_media_format_unsupported`로 차단한다. 검수된 PNG/JPEG 대체 증거를 제공하기 전에는 이 업체 단위를 추출·적재하지 않는다.
4. **XLSX 레이아웃 메타데이터 한계**: 변환기가 셀 border/table 경계를 보존하지 않는다. 빈 열 없이 인접한 표, 숫자만 있는 단위 선언 표에서 경쟁 identity를 안전하게 구분할 수 없으면 자동 통과하지 않고 `source_record_scope_ambiguous` 또는 사람 검수로 닫는다.
5. **이미지 판독 한계**: 이미지-only 근거는 자동 진위 판별이 불가능하므로 visual-review warning과 `needs_review`를 유지한다. 메이브라이드의 알려진 판독 불가 2개 셀을 금액으로 추정해 적재하면 안 된다.
6. **상태 인식형 25건 runner 미완료**: batch safety journal은 계획·증거 형식만 제공하며 실제 순차 실행, 배치별 비용 원장 갱신, 직전 배치 대비 needs_review 2배 급증 중단, staging pending 적용을 수행하는 runner는 아직 없다. `load --apply`는 계속 fail-closed다.
7. **실패 단위 repair runner 미완료**: repair approval은 이전 계획·strict score·새 요청을 묶는 비실행 증거 artifact일 뿐이다. 이를 schema v4 요청별 예약, 로컬 authority claim, 비용 원장, batch checkpoint에 연결해 실제 공급자 호출을 수행하는 유료 repair runner는 아직 없다. artifact 생성만으로 재실행이 승인됐다고 해석하면 안 된다.
8. **실행 도메인은 로컬 단일 권위**: 현재 anti-replay는 이 Windows 사용자 홈의 한 권위와 한 canonical state 경로만 보호한다. authority root와 anchor만 삭제해도 state-side binding이 재초기화를 차단한다. 남은 우회 범위는 권한 있는 운영자가 root·anchor·state binding을 함께 파괴하거나 state 전체를 초기화 전 시점으로 롤백하는 의도적 복합 파괴, 또는 다른 컴퓨터에서 별도 도메인을 만드는 경우다. 유료 실행은 이 권위가 있는 한 컴퓨터에서만 하고, 다른 컴퓨터는 코드 개발 전용으로 사용한다. 진짜 다중 컴퓨터 유료 실행과 자동 재해복구에는 중앙 transactional/append-only 저장소가 필요하다.

## 다음 실행 순서

1. 보안·유지보수·성능 최종 리뷰에서 P0/P1이 없는지 확인한다.
2. 관련 파일만 선별 stage하고 raw/state/env가 제외됐는지 확인한 뒤 checkpoint commit·push한다.
3. `paid-execution-domain-status`를 다시 실행해 canonical state·ledger hash·행·바이트,
   claim `0`, pending claim `0`을 대조한다. 도메인은 이미 초기화됐으므로 init을 재실행하지
   않는다. 고정 8건과 승인된 후속 배치가 끝날 때까지 worktree/state 절대 경로를 고정한다.
4. canonical state의 checksum backup을 만든다. state binding과 그 hash, 현재 domain ID·domain
   manifest hash·원장 snapshot hash/행/바이트 참조를 기록하되 authority 디렉터리와 anchor
   자체는 복사하지 않는다. 이 백업을 과거 시점으로 복원해 유료 실행을 재개하지 않는다.
5. 비밀 env를 현재 process에만 로드하고 위 exact fixed-eight `extract --plan`을 실행한다.
6. 모델 식별자, 요청 수, 예상 토큰·비용, 1회 최대 예약, 정보용 전체 최악 비용,
   `completion_not_guaranteed`, 승인 SHA와 절대 ceiling을 기록한다.
   `estimated_cost_usd <= authorized_incremental_usd`이고 다음 1회 예약이
   `min(plan absolute limit, runtime env absolute limit, $20) - domain committed` 안에 들 때만
   위 승인 SHA 명령으로 순차 실행을 시작한다. 실행 중에는 매 시도 직전 같은 조건을 다시
   검사하며 남은 예산이 부족하면 미완료 상태로 안전하게 중단한다.
7. validate 후 strict score를 실행한다. 실패 단위는 원문 증거와 prompt 다음 버전 수정안을
   보고하고, 최초 계획·strict score·변경 요청 hash에 묶인 repair-subset 승인 artifact까지만
   생성·검증한다. 현재 artifact는 **NOT EXECUTABLE / BLOCKED**다. schema v4 요청별
   예약·authority claim·원장·checkpoint를 갖춘 별도 유료 repair runner를 구현하고 다시
   리뷰하기 전에는 실패 단위를 공급자에 재호출하지 않는다.
8. blocking 7건이 전부 통과할 때만 immutable pass receipt를 발급한다.
9. 25건 배치는 아직 실행하지 않는다. 현재 batch journal은 의도적으로
   `blocked_pending_state_aware_runner`다.

## 완료라고 말하면 안 되는 항목

- 실제 고정 8건 추출·채점이 끝나기 전의 파일럿 통과
- exhaustive linkage GT와 pass receipt provenance 결합이 끝나기 전의 "연결 오류 0건" 또는 배치 승인
- strict score와 repair-subset 승인 artifact만으로 실패 단위를 안전하게 재실행할 수 있다는 주장(실행 가능한 유료 repair runner와 재검증도 필요)
- state-aware 25건 러너가 없는 상태의 전체 배치 또는 staging apply
- 관리자 검수 전 공개 발행
- hosted DB 백업·복구, 실제 모바일 binary, 운영 카나리 증거가 없는 상태의 PR 병합·운영 배포
- 로컬 실행 도메인을 중앙 다중 컴퓨터 lock 또는 자동 재해복구 체계라고 부르는 것
