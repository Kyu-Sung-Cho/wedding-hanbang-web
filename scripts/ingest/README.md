# 공시 원본 적재 CLI

한국소비자원 참가격 공시 원본을 로컬에서 스캔·변환·추출·검증한 뒤, 사람 검토 전 `pending` 상태로만 staging에 적재하는 파이프라인이다. 원본 폴더는 읽기 전용으로 취급하며 웹 검색, 업체 사이트 fetch, 공개 발행은 하지 않는다.

> **2026-07-20 현재 상태:** 원본 253개 파일의 경로·크기·SHA-256은 전부 일치한다.
> 249개 단위 중 238개가 현재 converter로 변환됐고, HWP 8개는 사람 변환 대기,
> 동일 바이트 복사본 2개는 `duplicate_source_content`, 조선 팰리스 embedded EMF 1개는
> `xlsx_media_format_unsupported`로 차단됐다. 현재 identity로 실제
> 추출·strict validation·staging load·공개 발행된 단위는 모두 0이다. 자세한 근거는
> `docs/operations/VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`를 따른다.

## 디렉터리와 실행 순서

기본 원본 위치는 저장소 루트의 `data/raw/`이다. 다운로드 당시 폴더와 파일 이름을 바꾸지 않는다.

```text
data/raw/
  결혼준비대행서비스/{지역}/{업체 파일 또는 업체 폴더}
  예식장/{지역}/{예식장 파일}
```

생성 상태(`manifest.json`, `.converted/`, `.cache/`, `validated/`)의 기본 위치는 Git에서 통째로 제외된 `scripts/ingest/.state/default/`다. `--state-dir pilot-2026q3` 같은 상대경로와 절대경로 모두 `scripts/ingest/.state/`의 자식만 허용하며, root 자체나 상위경로 탈출은 차단한다. manifest의 기록 위치가 요청한 state와 다르면 이후 단계도 중단한다. CLI는 state가 raw 안에 있거나 지원 파일이 하나도 없는 잘못된 raw root면 기존 manifest를 덮어쓰기 전에 중단한다.

```powershell
corepack pnpm ingest scan data/raw
corepack pnpm ingest convert
corepack pnpm ingest extract --plan
# 승인된 고정 8건 실행은 정확한 8개 ID를 고정한다.
corepack pnpm ingest extract --units <id1,id2,id3,id4,id5,id6,id7,id8> --plan
corepack pnpm ingest validate
corepack pnpm ingest status
corepack pnpm ingest load --snapshot 2026Q3
```

각 단계는 source/artifact fingerprint 기반으로 재실행 가능하다. `load`는 기본 dry-run이며 DB와 Storage를 건드리지 않는다.
`status`는 raw 업체명·경로·오류 본문을 출력하지 않고 stage별 count 표와 manual/error/pending 수, token, 추정 비용 합계를 보여준다. 실패 unit은 content-safe `unit_id`와 `extract_failed` 같은 제한된 오류 코드만 추가로 표시한다.

## 변환 안전 규칙

- 지원 형식은 XLSX, DOCX, HWP, PDF, PNG이다. 변환 전에 개별 원본 50MB 상한을 검사한다.
- XLSX는 병합 셀을 좌상단 값으로 풀고 `시트명!A1: 값` 좌표 line과 sheet markdown table을 함께 기록한다. DrawingML text box는 `XLSX_DRAWING <part>#text-box-N`, worksheet 수식은 `XLSX_FORMULA [sheet=...;cell=...;part=...#cell-...]` locator로 보존한다. 수식은 XML 원문만 읽고 계산하거나 외부 함수를 실행하지 않으며, 캐시 결과는 기존 canonical 셀을 가리키기만 해 금액을 중복 기록하지 않는다. drawing part 1,000개·text node 10,000개, formula 10,000개·개별 8,192자·합계 200,000자 상한을 적용하고 malformed/shared/array 수식은 fail-closed한다. archive 전체는 최대 10,000 entries, 개별 uncompressed 50MB, 합계 250MB이고, workbook은 최대 100 sheets, sheet range 250,000 cells, non-empty 100,000 cells, merge 10,000개, 전체 직렬화 텍스트 300,000자다. `xl/media/`는 표의 희박함과 무관하게 최대 100개, 개별 10MB, 합계 50MB를 적용하고 지원 이미지 전부를 별도 vision 증거로 보존한다.
- DOCX는 ZIP entry 2,048개, 압축 해제 합계 32MB, 압축비 200배를 넘으면 변환하지 않는다. 본문 텍스트와 `word/media/`의 지원 이미지를 함께 꺼내며 embedded media는 최대 100개, 개별 10MB, 합계 32MB 제한과 실제 바이트·해시 검증을 적용한다.
- XLSX/DOCX embedded media는 PNG/JPG/JPEG/WebP/GIF만 자동 vision 증거로 인정한다. EMF/WMF 등 미지원 형식은 조용히 버리지 않고 현재 converter·source fingerprint·오류 코드에 묶인 실패로 기록하며, 원본에서 PNG/JPEG로 변환한 뒤 scan부터 다시 실행한다.
- PDF는 200페이지·추출 텍스트 600,000자 상한을 둔다. 텍스트 양과 관계없이 모든 페이지를 `pdftoppm` 180dpi PNG로 만들며, 페이지당 20MB·전체 100MB·실행 120초·stderr 16KiB 한도를 적용한다. rasterizer가 없거나 실패하면 unit을 수동 변환 상태로 남긴다. Windows에서는 깊은 content-addressed 최종 경로를 Poppler에 직접 넘기지 않고 같은 `.converted/` 볼륨의 짧은 임시 경로에서 렌더링·검사한 뒤 원자적으로 게시한다. PATH 탐색이 불안정한 환경은 검증된 실행 파일을 `INGEST_PDFTOPPM_PATH` 절대경로로 지정할 수 있다.
- 이미지 추출 요청은 이미지당 20MB, 요청당 원본 합계 40MB, base64 payload 50MiB, 한 요청 5장, unit당 최대 20회로 제한한다. 파일 확인과 실제 읽기 사이에 크기나 경로가 바뀌면 중단한다.
- HWP는 자동 해석하지 않는다. 같은 디렉터리·동일 stem의 PDF가 있을 때만 그 PDF를 대체본으로 인정한다. HWP와 다른 형식이 섞여 있어도 대체 PDF가 없는 HWP가 하나라도 있으면 unit 전체를 `needs_manual_conversion`으로 막는다. 대체 PDF가 있어도 HWP와 PDF 양쪽의 원본 provenance와 Storage object를 보존한다.
- 지원되지 않는 지역 폴더는 `unknown_region` 오류로 막으며 vendor 생성까지 진행하지 않는다. scan과 extract는 심볼릭 링크까지 실제 경로로 해석해 raw/artifact root 밖 파일을 읽지 않는다.

## OpenAI 추출과 비용 감사

실제 추출은 OpenAI Responses API만 사용한다. 요청은 `store:false`, Zod structured output, SDK 자동 재시도 0회, 애플리케이션 429/5xx 최대 3회 재시도(최초 포함 총 4 attempts), 구조화 출력 검증 실패 repair 재요청 정확히 1회, 120초 timeout을 사용한다. 429/5xx의 `Retry-After` 초·HTTP date는 존중하되 대기 상한은 60초다. 그 밖의 4xx는 재시도하지 않으며 자동 이중 호출도 하지 않는다.

```text
INGEST_OPENAI_ENABLED=true
OPENAI_API_KEY=<key>
EXTRACTION_MODEL=gpt-5.6-luna   # 기본값·저비용
# 복잡한 이미지/저품질 파일 파일럿만 명시적으로 gpt-5.6-terra 선택
```

처음에는 반드시 `extract --plan`의 형식별 층화 8건과 비용을 확인하고, 승인된 실행은
`--units`로 정확한 8개 ID를 고정한 계획을 다시 출력한다. 계획 확인만으로는 API를
호출하지 않는다. 활성 계약은 prompt `v7.11-exact-xlsx-auxiliary-repair`, plan schema v4,
exact fixed-eight 순서다. 정확한 ID와 최신 승인 계획은
`docs/operations/VENDOR_DISCLOSURE_FIXED8_EXECUTION_HANDOFF_2026-07-20.md`를 따른다.
실제 호출은 `--plan`만 제거해서 실행할 수 없다. 같은 컴퓨터·같은 canonical state에서
유료 실행 도메인을 최초 1회 초기화하고 상태를 확인한 뒤, 계획이 출력한 정확한 SHA를
`--approved-plan-sha256`에 넣어야 한다.

```powershell
corepack pnpm ingest paid-execution-domain-status --state-dir reprocess-20260719-poppler5
# status가 paid_execution_domain_missing이고 기준 state 백업이 끝난 경우에만 최초 1회 실행한다.
corepack pnpm ingest paid-execution-domain-init --state-dir reprocess-20260719-poppler5
corepack pnpm ingest paid-execution-domain-status --state-dir reprocess-20260719-poppler5
corepack pnpm ingest extract --state-dir reprocess-20260719-poppler5 --units <exact-8-unit-ids> --plan
corepack pnpm ingest extract --state-dir reprocess-20260719-poppler5 --units <exact-8-unit-ids> --approved-plan-sha256 <sha-from-the-immediately-preceding-plan>
```

입력 조각에는 원본 상대경로와 파일 ID를 데이터 라벨로 붙이되, 라벨이나 원문을
지시문으로 취급하지 않는다. 성공한 배치별 schema-validated 체크포인트는 fingerprint와
prompt 버전에 묶어 저장하므로 뒤 배치가 실패해도 앞 배치를 다시 과금하지 않는다.
체크포인트가 손상됐거나 다른 fingerprint와 섞이면 재사용하거나 자동 재과금하지 않고
중단한다. 해당 cache 파일과 ledger ID를 보존해 원인을 확인한 뒤 손상 파일만 격리하고
재실행한다.

extract는 state별 `.cache/locks/extract.lock`을 원자적으로 생성해 같은 state의 inter-process 동시 실행을 차단한다. lock에는 PID·hostname·시작 시각·소유 ID를 기록한다. 같은 host의 죽은 PID 또는 손상된 lock을 발견해도 자동 삭제하지 않는다. 표시된 PID가 실제 종료됐는지 확인하고 cache·ledger를 보존한 뒤 lock 파일만 수동 격리 또는 제거해 재실행한다.

각 실제 provider 시도는 `.cache/ai-ledger.ndjson`에 임의 `run_id`, content-free ledger ID, unit/fingerprint/model/request ID, token, 추정 비용, latency, 성공 여부와 안전한 오류 분류만 기록한다. 구조화 출력이 유효하지 않아도 provider가 반환한 usage와 request ID는 원장에 남긴다. 프롬프트·원문·응답 본문·API key는 기록하지 않는다. CLI를 다시 실행한 실제 시도는 새 `run_id`로 남고, 같은 로컬 ledger의 staging 재적재만 멱등이다.

## 검증과 보수적 차단

- 숫자를 추정하지 않으며 모든 가격에는 `source_quote`가 있어야 한다.
- min/max의 모든 non-null 값이 quote에서 확인돼야 한다. `124만`, `100~120만원`, `KRW 1,000,000`, `₩1,000,000` 같은 공유·명시 통화 단위도 해석하며, 해석 불가나 일부 값 불일치는 사람 검토 warning으로 남긴다. 예식장 대관료와 식대는 서로 다른 `source_quote`를 보존한다.
- 반대 방향으로 원문 금액을 `시트!셀`, `XLSX_DRAWING` 또는 줄 발생 위치별로 전수 스캔한다. 같은 금액이 다른 행에 반복되면 각각 대응해야 하며, XLSX canonical 셀과 렌더링 표의 중복 표현은 한 번만 센다. `XLSX_FORMULA`는 캐시 숫자를 복제하지 않으므로 원 canonical 셀 발생만 센다. 일반 XLSX 셀은 요청에 실제로 포함된 한 셀의 연속 원문 조각만 허용하고, `XLSX_DRAWING`/`XLSX_FORMULA` 보조 locator는 exact part/cell/text-box와 정규화된 전체 payload가 모두 일치해야 한다. 다른 청크 locator·부분 payload·합성 quote·`line:N` 우회는 차단한다. 연결되지 않은 발생은 `coverage_gaps`와 warning으로 남긴다.
- `unknown` 문서, doc_kind와 payload가 충돌한 문서, 적재 가능한 가격 값이 없는 문서는 오류로 막는다. `mixed` 표기여도 agency 루트에 hall payload가 있거나 hall 루트에 agency/partner payload가 있으면 scan-derived 루트 경계를 우회할 수 없고 `document_kind_conflict`로 차단한다.
- 같은 대행사 package_name에 서로 다른 가격·옵션 변형이 둘 이상이면 한쪽을 고르지 않고 unit을 차단한다. 같은 snapshot/source identity의 기존 package와 값이 다를 때도 overwrite하지 않고 명시적으로 실패한다.
- hall 합계 가격도 quote가 없으면 오류다. 중복 후보는 같은 지역의 normalized name trigram 0.7 이상만 `dedupe_candidates.json`에 제안하고 자동 병합하지 않는다. vendor와 agency 후보를 구분하며, 대행사 병합도 같은 non-null 지역에서만 사람 결정으로 실행한다.
- 검증 warning을 포함한 모든 이슈 코드는 staging 행의 `validation_issue_codes`에 보존한다. 이슈가 하나라도 있으면 `needs_review=true`이며, `needs_review=false`여도 자동 승인을 뜻하지 않는다. 공개 전에는 모든 `pending` 행을 원본과 직접 대조해 승인해야 한다.
- 모든 원본을 안정적인 `source_file_id`로 라벨링한다. 단일 원본 행의 빈 ID는 유일 원본으로 자동 결속하지만, 다중 원본의 패키지·partner 가격·옵션·예식장 대관료·식대·개별 항목은 실제 근거 `source_file_ids`가 필수다. 누락, 중복, unit 밖 ID, 변환 증거 없는 ID는 validation error로 적재를 차단하며 임의 파일이나 전체 묶음으로 대체하지 않는다.
- doc_kind별 가격 적재 경로는 `agency_disclosure → official_agency_packages`, `partner_price_list → official_prices`, `hall_disclosure → official_prices`, `mixed → 포함된 각 경로`로 제한한다. canonical `halls[]`는 홀별 venue/meal/decoration/options pending 행으로 보존한다. 가격행이 없는 `pricing_basis`, 문서 section, 업체별 위약금·환불·변경 정책도 출처와 함께 private `disclosure_semantic_staging`에 pending-only로 보존하며 공개 API나 자동 승인 경로를 만들지 않는다. 업체 정책은 `partner_record_ref`와 실제 private `vendors.id`를 함께 저장하고, `price_row_staged` 정책은 같은 snapshot·vendor의 `official_prices.id`까지 해소되지 않으면 semantic write 전에 실패한다. 이후 승인된 업체 dedupe는 가격 기반·policy-only semantic의 vendor FK만 preserved vendor로 원자 이동하고 `partner_record_ref`는 보존한다. linked pending price의 vendor 직접 변경은 semantic FK와 함께 이동하며 snapshot 직접 이동은 차단한다.

## staging 적재 계약

아래 `--apply` 명령과 fence는 상태 인식형 25건 배치 러너가 구현·리뷰된 뒤에만 사용할
미래 계약이다. 현재 CLI와 `loadValidated({ apply: true })`는 환경 변수가 모두 맞아도
`load_apply_blocked_pending_state_aware_batch_runner`로 무조건 중단한다. 현재 가능한
적재 검증은 `--apply` 없는 dry-run뿐이다.

```powershell
corepack pnpm ingest load --snapshot 2026Q3 --apply --confirm-project-ref <STAGING_PROJECT_REF>
```

```text
INGEST_LOAD_ENABLED=true
INGEST_TARGET_ENV=staging
INGEST_STAGING_PROJECT_REF=<STAGING_PROJECT_REF>
INGEST_STORAGE_BUCKET=disclosure-raw
INGEST_PREVIEW_STORAGE_BUCKET=disclosure-preview
SUPABASE_PROJECT_REF=<STAGING_PROJECT_REF>
SUPABASE_PRODUCTION_PROJECT_REF=<PRODUCTION_PROJECT_REF>  # staging과 달라야 하며 apply 대상 금지
SUPABASE_URL=https://<STAGING_PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
```

- `source_file`은 감사용 상대경로다. 신규 scan은 portable 상대경로의 codepoint 순서로 `source_files`를 고정하며, 단일 원본은 평문 경로, 다중 원본은 그 manifest 순서의 JSON 경로 배열 문자열을 보존한다. load는 과거 manifest를 임의 재정렬하지 않는다. 변환 artifact의 `1-*`, `2-*` 접두사가 manifest 위치와 정확히 대응하기 때문이다.
- signed URL용 `source_object_keys`는 manifest `source_files`와 같은 순서로 `{sha256}.{ext}`를 각 parent/option/package에 저장한다. 내용이 같은 파일이 다른 이름으로 두 번 존재해도 positional provenance를 지키기 위해 object key 값을 중복 제거하지 않는다. 공개 view/API에는 이 private key를 노출하지 않는다.
- XLSX·DOCX·PDF 변환 텍스트는 load 직전에 전체 conversion artifact fingerprint와 개별 SHA-256을 다시 계산하고, unit 전용 `.converted/` 실제 경로 밖으로 나간 파일이면 중단한다. 개별 2MiB·unit 합계 4MiB·unit당 16개 상한 안에서만 `{sha256}.txt`로 private `disclosure-preview` bucket에 업로드한다.
- pending `official_prices`와 `official_agency_packages`에는 raw 파일 순서 중 XLSX·DOCX·PDF에 대응하는 `source_preview_keys`만 저장한다. 이 연결은 비어 있던 legacy 행의 1회 backfill 외에는 DB trigger로 변경을 막으며, public view/API에는 key와 텍스트를 모두 노출하지 않는다.
- 관리자 source API는 admin 인증 뒤 preview object를 server-side로만 내려받아 UTF-8·개별 2MiB·응답 합계 4MiB를 재검사하고 `private, no-store` JSON으로 보낸다. preview URL이나 object key, 로컬 경로는 응답하지 않으며 XLSX/DOCX는 셀 좌표가 보존된 inert `pre-wrap` 텍스트와 raw signed link를 함께 표시한다. PDF/PNG inline 원본 대조는 그대로 유지한다.
- hall 원본 가격의 `official_prices.category`는 `hall`을 유지하지만 canonical `vendors.category`는 `venue`로 매핑한다. 신규 vendor slug는 normalized 업체 identity+category+region으로 만든 결정적 ASCII 값이다.
- 대행사 루트에서 추출된 `partner_price_list` 가격은 scan-derived 대행사 이름·법인명·지역·원본을 `source_agency`로 운반한다. load는 이 identity로 agency를 먼저 보장한 뒤 `official_prices.agency_id`를 저장하고, 재실행에서도 같은 agency 연결인지 대조한다. 따라서 partner 가격만 있는 대행사도 dedupe 후보와 출처 연결에서 누락되지 않는다.
- manifest에는 `scanner_parser_version`을 기록한다. 원본 hash가 같아도 parser/지역 매핑 버전이 달라지면 과거 conversion·extraction·validation·loaded 상태를 재사용하지 않고 `scanned`부터 다시 시작한다. 버전이 없는 기존 v1 manifest는 읽을 수 있지만 다음 scan에서 보수적으로 무효화된다.
- vendor와 agency 매칭은 활성 후보를 ID 순으로 500개씩 전부 pagination한다(10,000개를 넘으면 중복 생성 대신 fail closed). 병합에서 탈락한 row는 재사용하지 않고, 보존 entity의 aliases로 이전 이름을 해석한다. 추출된 `old_names`는 `vendors.aliases`에 자동 반영하지 않는다. `vendor_alias_proposals`에 `pending`으로만 복구 가능하게 적재하고, `/admin/price`에서 사람이 선택한 제안만 가격 승인과 같은 service-role transaction 안에서 `approved` 및 alias union한다. 선택하지 않은 제안과 가격 반려 시 모든 제안은 `rejected`, 수정 저장은 `pending` 유지다. 한 번 검토된 제안은 변경할 수 없다.
- 문서 유형 미확인, validation 오류, 수동 변환, 적재 가능한 가격·semantic 행이 모두 0개인 unit은 `skipped_units`로 남고 `loaded`로 표시하지 않는다. `loaded`는 계획된 package/price/semantic pending 행이 모두 성공한 unit에만 붙는다.
- Supabase REST 여러 단계는 단일 DB transaction이 아니다. 중간 실패 시 일부 pending 행, alias proposal, Storage object가 남을 수 있다. manifest는 전체 writer 성공 전 `loaded`로 바뀌지 않으며, 원인을 고친 뒤 같은 dry-run을 확인하고 재실행한다. 재실행은 snapshot/source record key/slug/object key/ledger ID로 멱등화되고 누락된 pending alias proposal만 보충하며 기존 검토 결정을 되돌리지 않지만, operator는 실패 내역을 먼저 확인해야 한다.

원본과 생성물은 `.gitignore` 대상이다. 테스트는 `scripts/ingest/__tests__/`가 실행 중 생성한 dummy fixture만 사용하며 실제 공시 파일·OpenAI·Supabase에 접근하지 않는다.

## 2026-07-18~19 역사적 로컬 변환 파일럿

실제 다운로드 폴더를 읽기 전용으로 두고 새 default state에서 `scan → convert → status`를 다시 실행했다. 원본 249 units(253 files, 23,767,447 bytes) 중 대행사 54 units, 예식장 195 units였고, 235 units가 변환됐다. HWP 8개와 텍스트가 부족한 PDF 6개는 의도대로 `needs_manual_conversion` 큐에 남았으며 변환 오류는 0개였다. 이 파일럿에서는 OpenAI·Supabase 호출을 하지 않아 token과 추정 비용은 모두 0이다.

2026-07-19에는 Windows/Poppler 장경로 재현을 통해 성공 exit 뒤 페이지가 생성되지 않는 원인을 확인하고, 짧은 same-volume scratch에서 검증 후 게시하도록 보강했다. 새 격리 state `reprocess-20260719-poppler5`로 원본부터 다시 실행한 결과 `converted=241`, `needs_manual_conversion=8`, `error=0`이었고 PDF 수동 큐 6개는 전부 해소됐다. 새로 래스터화된 6개 unit의 8페이지는 사람이 직접 확인해 빈 페이지·잘림·회전·식별 불가 문제가 없음을 확인했다. 남은 8개는 동일 stem PDF 대체본이 없는 HWP이며 자동 성공 처리하지 않는다. 이 재검증도 OpenAI·Supabase 호출은 0이다.

고정 8건의 자동 채점표와 발생 위치 ground truth는 `docs/operations/VENDOR_DISCLOSURE_PILOT_MANUAL_AUDIT_2026-07-19.md`에 기록했다. 이것은 추출 결과가 아니며 prompt v6는 역사적 API 호출 0건 기록이다. 활성 prompt `v7.11-exact-xlsx-auxiliary-repair`와 plan schema v4도 실제 호출 0건인 품질 미검증 상태다. 텍스트 원본 2,342건은 발생 위치 단위 ground truth로 고정하고, 메이브라이드 저해상도 PNG의 판독 불가 셀은 `null + needs_review + coverage_gaps` 대상으로 분리한다. 다음 단계는 코드·테스트·보안 게이트를 통과한 commit에서 고정 8개 `--units` 계획을 재확인한 뒤 실제 추출 결과를 strict score로 자동 채점하는 것이다. 그 확인 전에는 25건 배치, staging `--apply`, 승인·공개, 운영 배포를 진행하지 않는다.

위 수치는 당시 converter의 역사적 snapshot이다. 2026-07-20 현재 parser v3/converter `v6-complete-xlsx-drawing-formula-evidence` 전수
재실행 결과는 `238 converted / 8 HWP manual / 3 current error / 0 stale error`다. 오류는
동일 원본 복사본 2개와 미지원 embedded EMF 1개다. 과거 append-only
ledger에는 실제 유료 시도 102행과 비용 기록이 있으므로 새 state의 빈 ledger를 근거로
전체 역사 비용을 0이라고 보고하면 안 된다. 현재 fixed-eight v7.11 무과금 재계획은
`125 requests / estimated input 1,357,066 / output 1,347,972 / $9.7841645`, 승인 계획 SHA-256
`32fb11f972467405bed56ad3c1a59200b759f6702365b1583e0698e6debdf155`이며 신규 provider 호출은 0건이다.
