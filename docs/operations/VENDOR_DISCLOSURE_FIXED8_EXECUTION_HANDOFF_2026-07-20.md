# 업체 공시 고정 8건 실행 인계 — 2026-07-20

## 현재 판정

- 저장소: `wedding-vendor-disclosure-v2`
- 브랜치: `feat/vendor-disclosure-pipeline-v2-20260718`
- 작업 시작 기준 HEAD: `3cf4c950e4c064238679b72462877afde0b676e3`
- 최신 push HEAD: `bbb98a92b70576083d0718c5ebadb86787d5eb9c` (`fix(web): keep preview price pages Supabase-free`)
- 통합 PR: [#64](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/64), Draft, base `main`
- 2026-07-20 최신 재검증 시점까지 이번 연속 작업의 신규 유료 API 호출은 `0건`이다. 아래 변경과 테스트는 모두 로컬·무과금 경로에서 수행했으며, 실제 고정 8건 추출은 아직 시작하지 않았다.
- 내구성 비용 원장 원본은 `102행`, `67,495 bytes`, SHA-256 `32d3943160aa6ff656ce08b1411664bd3de2c1285657a15837b5eec0ccfd3d46`이며 기록 당시 누계는 `$4.0023985`다. GPT-5.6 cache-write 1.25배를 보수적으로 재평가한 비용 fence 누계는 `$4.185901625`, `$20` 기준 잔여 예산은 `$15.814098375`다. 원장 바이트는 재작성하지 않는다. `$1.541804`는 v7.5·v7.6 두 실행만 더한 부분합이므로 전체 누계로 사용하면 안 된다.
- 전체 배치와 staging apply는 상태 인식형 25건 러너가 완성될 때까지 코드 경계에서 차단한다.
- 운영 병합·운영 배포는 PR #64의 hosted evidence 게이트가 실패 중이므로 아직 NO-GO다.

## 실제 모델과 Luna의 의미

- 로컬 비밀 환경 파일의 `EXTRACTION_MODEL` 값은 `gpt-5.6-luna`이다.
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
11. 현재 추출 계약은 prompt `v7.8-deterministic-line-and-cell-evidence`다. 비-XLSX 텍스트 근거는 정확한 `line:N:` 접두어, XLSX 근거는 정확한 셀 또는 포함 범위 locator를 사용하며 `line:5`/`line:51`, `B1`/`B10` 같은 접두어 충돌을 허용하지 않는다.
12. 유료 실행 전 승인 문서는 exact fixed-eight 순서, 모델, prompt/processing 버전, 원본·변환 fingerprint, 요청 해시, 토큰·비용을 content-addressed SHA-256으로 묶는다. CLI 실제 실행에는 `extract --plan`이 발급한 정확한 `--approved-plan-sha256`이 필요하다.
13. 실제 공급자 호출 직전 paid-call intent를 내구성 있게 기록하고, 비용 원장과 요청 체크포인트가 기록된 뒤에만 해제한다. 고아 intent는 수동 정산 전 재개를 차단하며, 비용 fence는 이전 내구성 원장 누계까지 포함해 `$20` 상한을 적용한다.
14. 유료 계획 schema v3는 계획 생성 직전의 비용 원장 바이트 SHA-256·바이트 수·행 수·누계를 함께 묶는다. 계획 뒤 원장이 잘리거나 바뀌면 실행을 차단한다.
15. initial 요청과 응답 내용에 의존하지 않는 static repair 요청을 모두 계획 단계에서 미리 해시·승인한다. 실제 공급자 호출 직전 exact request hash가 승인 계획과 다르면 호출하지 않는다.
16. paid-call intent는 같은 디렉터리의 fsync 임시 파일을 hard-link no-overwrite 방식으로 원자 발행한다. 동일 요청을 동시에 시작해도 하나만 승인되고 나머지는 `already_pending`으로 닫힌다.
17. 체크포인트와 성공 비용 원장은 request id·usage·request fingerprint·승인 계획 SHA가 양방향으로 일치해야 한다. 같은 승인 계획의 부분 완료 재개는 완료된 요청을 다시 호출하지 않는다.
18. 원문 연결 검증은 단순히 인용문 안에 단어와 금액이 각각 존재하는 것만 보지 않는다. 같은 원본·같은 연속 행 블록 또는 같은 XLSX 레코드 영역에 속한 관계만 허용하며, 경쟁 업체·경쟁 금액·원거리 조각 합성은 `source_record_scope_ambiguous`로 차단한다.
19. 운영 `extractManifest`에서는 provider 또는 유료 실행 권위 경로를 주입할 수 없다. 임의 test provider는 production-paid 모드에 진입할 수 없다. fixed-eight 유료 체인 테스트는 OS 임시 경로와 schema 검증된 정적 응답만 받는 내부 scripted provider를 사용하며, API key 또는 유료 활성화 환경이 있으면 거부한다.
20. 승인 계획 schema v3는 예상 비용뿐 아니라 최대 4회 시도와 repair payload까지 포함한 `maximum_cost_usd`도 `authorized_ceiling_usd` 이하인지 검증한다. 실행 시 환경 변수로 비용 상한을 올려도 실제 fence는 환경 상한과 `승인 전 원장 누계 + 승인 ceiling` 중 더 낮은 값만 쓴다.
21. GPT-5.6 입력 비용은 계획·최대치·호출 예약 모두 cache-write 상한인 기본 입력 단가의 `1.25배`로 계산한다. 실제 응답에서 cached/write 세부 토큰이 완전하고 서로 일치할 때만 일반 입력 `1배`, cache write `1.25배`, cache read `0.1배`로 정산한다. 세부 사용량이 없거나 모순되면 전 입력을 `1.25배`로, 전체 사용량이 불완전하면 호출 예약액으로 보수 정산한다. 과거 v2 원장 바이트는 바꾸지 않고 누계 계산에서만 같은 보수 상한을 적용한다.
22. 유료 계획 전에 `~/.wedding-hanbang-paid-execution-v1` 로컬 실행 도메인을 명시적으로 한 번 초기화하고 상태를 확인해야 한다. 초기화는 기존 checkpoint namespace를 먼저 검사해 실패 시 authority나 anchor를 반쯤 만들지 않으며, state 안의 `.cache/paid-execution-domain-binding.json`에도 동일한 domain·manifest·canonical state binding을 no-overwrite로 남긴다. claim과 무관한 schema v1·test-only·genesis 이전 checkpoint는 역사 자료로 유지하되 완료 증거로 쓰지 않고, post-genesis production claim 관련 v3 checkpoint는 전체 무결성을 검증한다. 각 provider 시도는 계획 SHA·요청 hash·unit·fingerprint·batch·attempt에 묶인 영구 claim을 provider 호출 전에 원자 발행한다. claim은 정확히 한 개의 production ledger 행과 무결성 검증된 해당 batch checkpoint가 모두 있어야 완료로 인정하며, 누락·변조·state rollback·새 계획을 통한 동일 요청 재포장은 수동 reconciliation 전 차단한다.
23. 계획의 최대 비용이 남은 예산 또는 고정 승인 상한을 넘으면 per-unit 및 합계 예상·최대 토큰/비용은 보고하되 승인 파일과 승인 SHA를 만들지 않는다. SHA 없는 실제 실행은 provider 생성 전에 차단한다.
24. 저해상도 이미지 확대 타일은 Windows 긴 경로를 피하도록 같은 state 볼륨의 짧은 scratch 경로에서 생성한다. scratch 부모의 symlink/junction을 차단하고, 결과를 fsync·SHA-256 검증한 뒤 hard-link no-overwrite로 최종 content-addressed 경로에 발행하며 임시 파일과 디렉터리를 제거한다.

## Vercel Preview 빌드 복구

- Preview에는 운영 Supabase 공개 URL/anon key를 복사하지 않는다. Vercel의 Preview 범위에만 `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`를 둔다.
- 가격 상세 페이지의 정적 경로·메타데이터·페이지 렌더와 공통 가격 카탈로그 로더가 Preview 스텁에서 Supabase client를 열지 않도록 수정했다.
- 운영/일반 환경은 스텁이 없으면 기존대로 설정 누락을 숨기지 않고 fail-closed 한다.
- 로컬에서 `VERCEL_ENV=preview`, `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`, Supabase 공개 변수 공백 조건으로 전체 Next.js 빌드 및 109개 정적 페이지 생성을 통과했다.
- 수정 커밋 `bbb98a92`를 push한 새 Vercel 배포 `BkY4maSucyXG6vjCZgSe2wFMWmkQ`가 `Ready`가 됐다. Preview URL은 `https://wedding-hanbang-web-git-feat-vendor-disclosure-p-061770-hanbang.vercel.app`이다.
- Preview에서 `/price/studio`는 Supabase 설정 오류 없이 정상 렌더했고, 존재하지 않는 `/price/vendor/preview-vendor`는 정상 404로 닫혔다. Preview stub의 wishlist API가 의도적으로 503을 반환해 빈 목록 UI에 오류 안내가 보이는 점은 Preview 전용 UX 후속 항목이며 운영 성공 증거로 해석하지 않는다.
- 해당 push의 Web Quality, Mobile, Vendor Disclosure, Static Release, Vercel, Vercel Preview Comments 검사는 PASS다. Production Readiness는 hosted evidence 부재로 의도대로 FAIL이며, 그 결과 전체 Quality Gate와 운영 병합·배포는 계속 차단된다.

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

- `corepack pnpm test:ingest`: `356 tests / 355 pass / 0 fail / 1 Windows symlink EPERM skip`
- `corepack pnpm ingest:typecheck`: PASS
- `corepack pnpm exec turbo run typecheck`: `4/4 PASS`
- `git diff --check`: PASS
- workspace package typecheck: ingest + shared + design-tokens + mobile + web PASS
- web full tests: `2,554/2,554 PASS` (`298` test files)
- web lint: PASS
- Vercel Preview 동일 환경 전체 web build: PASS (`109` static pages generated)
- source-record linkage focused tests: `30/30 PASS`
- score + pass receipt focused tests: `59/59 PASS`
- load + pipeline focused tests: `26/26 PASS`
- semantic provenance validation tests: `51/51 PASS`
- production provider 격리·승인 ceiling·cache usage·고정 8건 안전 재개·Windows 긴 이미지 경로를 포함한 extraction tests: `73/73 PASS`
- local execution domain + paid plan + ledger + repair approval targeted tests: `28/28 PASS`

이 결과는 코드의 자동 테스트 통과를 뜻할 뿐 실제 OpenAI 고정 8건 추출, 운영 원문 대비 채점, 파일럿 통과 또는 배치 실행 완료를 뜻하지 않는다.

## Git 및 원본 격리

- Git에는 코드와 문서만 올린다. `scripts/ingest/.state/`, `data/raw/`, 비밀 env/API key, 중간 산출물은 커밋하지 않는다.
- 원본 외부 URL은 다시 직접 다운로드하지 않는다. `price.go.kr/.../file_down.do` 직접 fetch는 과거에 한 번 있었고 지시 위반이었다. 재발 금지다.
- 다른 컴퓨터에서 코드를 이어갈 수 있도록 코드·테스트·문서만 커밋·push한다. 원본, state, GT/overlay/adjudication 산출물, 유료 호출 원장·intent·승인 문서와 비밀키는 Git과 분리해 안전하게 백업·복구해야 한다. 현재 manifest와 artifact 경로는 로컬 state에 묶이므로 Git pull만으로 유료 적재를 재개할 수 없다.
- state 백업은 `.cache/paid-execution-domain-binding.json`을 그대로 보존하고, 백업 manifest에는 그 파일 hash와 현재 `domain_id`, domain manifest hash, 원장 snapshot hash·행 수·바이트 수를 참조값으로 기록한다. 실행 도메인 디렉터리와 인접 anchor는 state 백업에 복사하거나 과거 시점으로 복원하지 않는다. 삭제·복원·재초기화로 안전 차단을 우회해서는 안 된다.
- domain binding은 `authoritative_state_dir_realpath`를 고정한다. 고정 8건과 승인된 후속 배치가 모두 끝날 때까지 이 worktree와 state 디렉터리를 이동·이름 변경·삭제하지 않는다. 경로가 바뀌면 의도대로 fail-closed하며 자동으로 새 경로에 다시 묶지 않고 수동 reconciliation이 필요하다.

## 아직 해결되지 않은 차단 항목

1. **실제 고정 8건 실행·채점 전**: 이 문서 갱신 시점까지 신규 OpenAI 호출은 `0건`이다. 코드 테스트 통과는 실제 원문에서 지어냄·누락·연결 오류 0건을 증명하지 않는다.
2. **사람 검수형 exhaustive linkage map 부재**: 자동 검증은 업체명·카테고리·금액을 같은 원본의 같은 연속 line block 또는 XLSX record component에 묶고 모호하면 차단한다. 하지만 2,342개 수동 금액 inventory가 모든 업체·패키지·홀 소유 관계를 사람 검수로 전수 표기한 map은 아니다. 따라서 실제 8건 score와 수동 대조 전에는 연결 오류 0건을 선언하지 않는다.
3. **XLSX 레이아웃 메타데이터 한계**: 변환기가 셀 border/table 경계를 보존하지 않는다. 빈 열 없이 인접한 표, 숫자만 있는 단위 선언 표에서 경쟁 identity를 안전하게 구분할 수 없으면 자동 통과하지 않고 `source_record_scope_ambiguous` 또는 사람 검수로 닫는다.
4. **이미지 판독 한계**: 이미지-only 근거는 자동 진위 판별이 불가능하므로 visual-review warning과 `needs_review`를 유지한다. 메이브라이드의 알려진 판독 불가 2개 셀을 금액으로 추정해 적재하면 안 된다.
5. **상태 인식형 25건 runner 미완료**: batch safety journal은 계획·증거 형식만 제공하며 실제 순차 실행, 배치별 비용 원장 갱신, 직전 배치 대비 needs_review 2배 급증 중단, staging pending 적용을 수행하는 runner는 아직 없다. `load --apply`는 계속 fail-closed다.
6. **실행 도메인은 로컬 단일 권위**: 현재 anti-replay는 이 Windows 사용자 홈의 한 권위와 한 canonical state 경로만 보호한다. authority root와 anchor만 삭제해도 state-side binding이 재초기화를 차단한다. 남은 우회 범위는 권한 있는 운영자가 root·anchor·state binding을 함께 파괴하거나 state 전체를 초기화 전 시점으로 롤백하는 의도적 복합 파괴, 또는 다른 컴퓨터에서 별도 도메인을 만드는 경우다. 유료 실행은 이 권위가 있는 한 컴퓨터에서만 하고, 다른 컴퓨터는 코드 개발 전용으로 사용한다. 진짜 다중 컴퓨터 유료 실행과 자동 재해복구에는 중앙 transactional/append-only 저장소가 필요하다.

## 다음 실행 순서

1. 보안·유지보수·성능 최종 리뷰에서 P0/P1이 없는지 확인한다.
2. 관련 파일만 선별 stage하고 raw/state/env가 제외됐는지 확인한 뒤 checkpoint commit·push한다.
3. 초기화 전 canonical state의 기준 백업과 checksum manifest를 만든다. 이 기준 백업에는 아직 존재하지 않는 domain binding을 임의로 넣지 않으며, 이후 이를 복원해 유료 실행을 재개해서는 안 된다.
4. 같은 유료 실행 컴퓨터에서 `corepack pnpm ingest paid-execution-domain-init --state-dir <state-dir>`을 최초 1회만 실행하고, `corepack pnpm ingest paid-execution-domain-status --state-dir <state-dir>`의 domain·state·ledger·claim 상태를 확인한다. 이미 초기화됐으면 init을 재실행하지 않는다. 이 시점부터 고정 8건과 승인된 후속 배치가 끝날 때까지 worktree/state 절대 경로를 고정한다.
5. 초기화 직후 state를 다시 백업한다. 이 실행 기준 백업에는 state binding과 그 hash, 현재 domain ID·domain manifest hash·원장 snapshot hash/행/바이트 참조를 기록하되 authority 디렉터리와 anchor 자체는 복사하지 않는다.
6. 비밀 env를 현재 process에만 로드하고 exact fixed-eight `extract --plan`을 실행한다.
7. 모델 식별자, 예상/최대 토큰, 예상/최대 비용, 승인 SHA와 승인 ceiling을 기록한다. `maximum_cost_usd <= authorized_ceiling_usd <= $20 - prior_durable_ledger_cost_usd`가 모두 성립할 때만 별도 대기 없이 실제 추출한다.
8. validate 후 strict score를 실행한다. 실패 단위는 원문 증거와 prompt 다음 버전 수정안을 보고하고, 최초 계획·strict score·변경 요청 hash에 묶인 repair-subset 승인 artifact로 실패 단위만 재실행한다.
9. blocking 7건이 전부 통과할 때만 immutable pass receipt를 발급한다.
10. 25건 배치는 아직 실행하지 않는다. 현재 batch journal은 의도적으로 `blocked_pending_state_aware_runner`다.

## 완료라고 말하면 안 되는 항목

- 실제 고정 8건 추출·채점이 끝나기 전의 파일럿 통과
- exhaustive linkage GT와 pass receipt provenance 결합이 끝나기 전의 "연결 오류 0건" 또는 배치 승인
- strict score와 repair-subset 승인 artifact 없이 실패 단위를 안전하게 재실행할 수 있다는 주장
- state-aware 25건 러너가 없는 상태의 전체 배치 또는 staging apply
- 관리자 검수 전 공개 발행
- hosted DB 백업·복구, 실제 모바일 binary, 운영 카나리 증거가 없는 상태의 PR 병합·운영 배포
- 로컬 실행 도메인을 중앙 다중 컴퓨터 lock 또는 자동 재해복구 체계라고 부르는 것
