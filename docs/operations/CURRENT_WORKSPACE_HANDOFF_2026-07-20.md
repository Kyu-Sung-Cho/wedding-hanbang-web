# 현재 작업 인계 — 2026-07-20

## 기준

- repository: `Kyu-Sung-Cho/wedding-hanbang-web`
- branch: `feat/vendor-disclosure-pipeline-v2-20260718`
- Draft PR: [#64](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/64)
- 다른 컴퓨터에서는 문서에 적힌 과거 SHA가 아니라 위 branch의 원격 HEAD를 기준으로 한다.
- raw 원본, `.state`, 변환물, GT overlay, 비용 ledger, API key는 Git에 포함하지 않는다.

## 이번 작업에서 바뀐 것

1. 업체명 parser를 실제 249개 단위에 다시 적용해 suffix·지역 prefix·중첩 법인명·`㈜`·
   복사 suffix 관련 의심 25건을 고쳤다.
2. source-file set 전체가 완전히 같은 복사본은 원본 경로를 보존하되 양쪽을
   `duplicate_source_content`로 차단한다.
3. PDF는 텍스트 양과 관계없이 모든 페이지를 래스터화하고, XLSX/DOCX embedded media도
   제한·해시 검증 후 증거로 보존한다. 미지원 EMF/WMF는 조용히 누락하지 않고 차단한다.
4. `KRW`, `₩` 금액을 양방향 coverage inventory에 포함했다.
5. canonical `halls[]`를 홀별 가격·식대·장식·옵션 pending 행으로 보존한다.
6. 가격행이 없는 pricing basis, 문서 section, 업체별 위약금·환불·변경 정책을 private
   pending-only `disclosure_semantic_staging`에 보존하는 schema/writer/migration을 추가했다.
7. semantic capture가 빠지면 가격 숫자가 맞더라도 blocking unit과 25건 배치를 통과하지
   못하게 하고, stale/위조 score report의 pass receipt 우회를 막았다.
8. status를 parser/converter/prompt/validation identity에 맞춰 current/stale로 분리했다.
9. XLSX drawing text를 결정론적 `XLSX_DRAWING` locator로 보존하고, worksheet formula는
   실행하지 않은 원식과 기존 cached-result 셀 locator를 `XLSX_FORMULA` 근거로 보존한다.
10. 보조 locator는 요청 범위 안의 정확한 locator와 전체 payload만 허용한다. 잘못된
    part/text-box/cell, 부분 인용, 합성 quote, line alias, 셀 locator 위조는 차단한다.
11. 변환 캐시는 파일 존재만 보지 않고 실제 바이트 SHA-256 지문을 다시 계산한다.
    삭제·변조된 산출물은 재변환하고 status도 current로 세지 않는다.
12. duplicate·변환 실패 단위의 정확한 생성 캐시만 상태 경계와 symlink/junction을
    검사한 뒤 정리한다. 발견됐던 manifest 미참조 과거 산출물 3개는 canonical 재실행으로
    정리됐고, raw 원본은 다시 전수 해시 일치했다.

## 전수 감사 결과

- raw: `253 files / 249 units / 23,767,447 bytes`
- extensions: `xlsx 219 / pdf 22 / hwp 8 / docx 3 / png 1`
- raw path·bytes·SHA mismatch: `0`
- current conversion: `238 converted / 8 HWP manual / 3 current error / 0 stale error`
- current errors: 셀레네하우스 동일 원본 2개 + 조선 팰리스 embedded EMF 1개
- conversion artifact: `332 refs / missing 0 / fingerprint mismatch 0`
- generated conversion cache: `331 referenced files / orphan 0`
- XLSX: 정상 변환 216개, 비어 있지 않은 셀 29,669개, 변환 누락 0
- PDF: 22개/27페이지, raster page count 불일치 0
- DOCX: 3개/369 text segments, 누락 0
- embedded media: 64개 중 지원 이미지 63개 hash 불일치 0, EMF 1개 차단
- current extraction/validation/load/publication: 전부 `0`
- fixed-eight current 계획: `gpt-5.6-luna`, 125 requests, 예상 input 1,357,066,
  output 1,347,972, `$9.7841645`, SHA
  `32fb11f972467405bed56ad3c1a59200b759f6702365b1583e0698e6debdf155`
- 실제 라온제나 분당 drawing 1건과 케이트웨딩플랜 B20/B25/B26/C28 formula·cached
  결과를 canonical 변환물에서 재확인했으며 formula 실행과 cached 금액 중복은 `0`
- 이번 작업의 신규 OpenAI provider call: `0`

전체 경로, HWP 목록, 중복 SHA, 형식별 검증은
`VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`에 있다.

## 아직 완료되지 않은 것

1. Vercel Production의 `OPENAI_API_KEY`와 모델 변수는 `env pull`에서
   `[SENSITIVE]`로 마스킹되므로 로컬에서 형식을 판정할 수 없다. 과거 server-side
   Production checker는 OpenAI 조건을 통과했지만, 현재 로컬 ingest process에는 실제
   복호화 key가 없어 fixed-eight를 실행할 수 없다.
2. HWP 8개는 사람이 같은 stem PDF로 변환해야 한다.
3. 조선 팰리스 XLSX의 `xl/media/image1.emf` 위약금 표를 검수된 PNG/JPEG로 변환해야 한다.
4. 셀레네하우스 동일 바이트 XLSX 2개의 canonical source를 사람이 결정해야 한다.
5. current fixed-eight 실제 추출·양방향 strict score·pass receipt는 0건이다.
6. 상태 인식형 25건 실행 runner, 전체 batch, staging apply, 관리자 검수, 공개 발행은
   완료되지 않았다.
7. 새 migration의 disposable hosted DB clean apply, RLS probe, pre/post backup과 restore
   rehearsal이 없다.
8. PR #64 production-readiness hosted evidence가 없으므로 병합·운영 배포·카나리는 NO-GO다.

2026-07-20 read-only hosted 재확인에서 운영 migration head는 `20260715210000`이었고,
로컬의 `20260716090000`부터 `20260720120000`까지 `47개` migration이 미적용이었다.
따라서 vendor migration 하나만 골라 적용할 수 없으며 먼저 Amora 27개 release 전체의
별도 안전 게이트를 통과해야 한다. Supabase 자동 physical backup은 최근 7개가
`COMPLETED`였지만 PITR은 비활성화돼 있고, 현재 시점의 migration 전 논리 backup 및
다른 프로젝트 restore rehearsal은 없다. 로컬 `pg_dump`도 Docker daemon 부재로 실행하지
못했다. 운영 anon REST의 `v_public_prices` 조회는 `404 / PGRST205`였으므로 실제 공개
catalog가 존재한다는 증거도 없다. 이 사실들 때문에 release manifest의 hosted
backup/restore evidence는 계속 `missing`이 맞다.

## 이번 로컬 검증

- ingest `423 total / 422 pass / 0 fail / 1 Windows file-symlink EPERM skip`
- Supabase release `166/166 PASS`, static fence `27 + 20 PASS`
- workspace typecheck `4/4`, lint PASS
- web `304 files / 2,597 tests PASS`
- mobile `111/111 PASS`
- Next Preview shape build `109` static pages PASS
- Expo Web/iOS/Android export PASS
- mobile release readiness `104/104 PASS`

## 다른 컴퓨터에서 이어가기

```powershell
git fetch --prune origin
git switch feat/vendor-disclosure-pipeline-v2-20260718
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm ingest:typecheck
corepack pnpm test:ingest
gh pr view 64 --web
```

Git만으로는 실제 추출을 이어갈 수 없다. 유료 실행 authority와 canonical state는 이
컴퓨터의 절대 경로에 묶여 있고 raw/state/ledger도 Git 밖에 있다. 다른 컴퓨터는 코드
개발·리뷰용으로만 사용하며, 실제 유료 실행을 옮기려면 별도의 검증된 state/authority
이관 절차가 필요하다. authority를 삭제하거나 새로 초기화해 anti-replay fence를 우회하지
않는다.

## 안전한 다음 순서

1. GitHub checks를 현재 branch HEAD에서 확인한다.
2. Vercel Production의 OpenAI 설정은 값 비공개 server-side probe로 확인한다. 이와 별개로
   실제 OpenAI key를 현재 로컬 ingest process에만 비공개로 주입한다. Vercel의
   `[SENSITIVE]` marker를 로컬 key로 사용하지 않는다.
3. HWP 8개, 조선 팰리스 EMF, 중복 2개의 사람 결정을 완료한 뒤 scan/convert/hash audit를 다시 수행한다.
4. fixed-eight를 비용 fence 안에서 실행하고 ground truth로 strict score한다.
5. blocking 7건 전부 통과 후에만 pass receipt와 25건 runner 단계로 간다.
6. disposable hosted DB에서 migration·RLS·backup/restore를 증명한 뒤 staging pending만
   적재한다.
7. 관리자 검수·release evidence·rollback receipt가 같은 commit에 귀속될 때만 병합과
   운영 배포를 검토한다.
