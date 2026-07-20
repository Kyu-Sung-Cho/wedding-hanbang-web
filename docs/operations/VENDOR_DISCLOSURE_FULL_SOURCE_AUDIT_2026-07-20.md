# 업체 공시 원본 전수 감사 — 2026-07-20

## 결론

현재 로컬 원본은 **253개 파일 / 249개 업체 단위**이며, 경로·바이트 수·SHA-256을
전수 재계산한 결과 원본 불일치는 `0건`이다. 그러나 이것은 “모든 업체 정보가
운영 서비스에 적재됐다”는 뜻이 아니다.

- 자동 변환 완료: `238 units`
- 사람이 변환해야 하는 HWP: `8 units`
- 동일 바이트 복사본이라 자동 처리를 차단한 단위: `2 units`
- XLSX 내부 EMF를 PNG로 변환해야 하는 단위: `1 unit`
- 현재 prompt·parser·converter·validation identity로 추출 완료: `0 units`
- strict validation 완료: `0 units`
- staging pending 적재 완료: `0 units`
- 관리자 승인 및 공개 발행: `0 units`

따라서 현재 판정은 **원본 보존 PASS / 변환 부분 PASS / 내용 추출·채점·적재·공개
NO-GO**다. 원본이 있다는 이유로 업체별 가격·정책·홀·패키지 내용이 모두 제품에
들어갔다고 보고해서는 안 된다.

## 원본 전수 인벤토리

검사 대상 raw root:

`C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw`

| 구분 | 파일 수 |
|---|---:|
| XLSX | 219 |
| PDF | 22 |
| HWP | 8 |
| DOCX | 3 |
| PNG | 1 |
| 합계 | 253 |

- 전체 바이트: `23,767,447`
- 경로 기반 업체 단위: `249`
- 결혼준비대행서비스: `54 units / 56 files`
- 예식장: `195 units / 197 files`
- manifest 대비 원본 경로 누락: `0`
- manifest 밖 추가 원본: `0`
- 원본 크기 불일치: `0`
- 원본 SHA-256 불일치: `0`
- 0-byte/지원하지 않는 확장자/symlink 원본: `0`

다중 원본 단위는 3건이다. Gramercy는 PDF 2개, VeryGoodWedding은 XLSX 3개,
Hotel Intercity는 PDF 2개를 하나의 업체 단위로 보존한다.

## 변환 산출물 감사

검사 state:

`scripts/ingest/.state/reprocess-20260719-poppler5`

- converter: `v6-complete-xlsx-drawing-formula-evidence`
- 변환된 단위: `238`
- HWP 수동 변환: `8`
- 현재 오류: `3` — 동일 원본 복사본 2 + 미지원 EMF 1
- stale 오류: `0`
- 산출물 참조: `332`
- 산출물 누락: `0`
- 산출물 fingerprint 불일치: `0`
- 정상 변환 XLSX: `216 files`
- XLSX 비어 있지 않은 셀: `29,669` — `시트!셀: 값` 누락 `0`, manifest cell count 불일치 `0`
- PDF: `22 files / 27 pages` — 원본 페이지 수와 래스터 이미지 수 불일치 `0`
- DOCX: `3 files / XML text segment 369` — Mammoth 텍스트 누락 `0`
- XLSX/DOCX embedded media: `64` — 지원 이미지 63개 원본 바이트 해시 불일치 `0`, 미지원 EMF `1`

이번 보강으로 PDF는 “텍스트가 300자 미만일 때만” 이미지를 만들지 않고 모든 페이지의
시각 정보를 보존한다. DOCX는 본문뿐 아니라 embedded media도 제한·해시 검증 후
추출한다. XLSX/DOCX에서 모델이 읽을 수 없는 미디어 확장자를 조용히 건너뛰지 않고
현재 converter·source fingerprint·오류 코드에 묶인 명시적 오류로 차단한다.

XLSX의 셀 값뿐 아니라 drawing text와 formula도 보존한다. drawing text는 DrawingML의
텍스트 상자만 strict parse하여 `XLSX_DRAWING <part>#text-box-N` locator로 기록하고,
formula는 workbook relationship으로 실제 worksheet part를 확인한 뒤
`XLSX_FORMULA [sheet=...;cell=...;part=...#cell-...]` locator에 원식과 cached-result
셀 locator를 기록한다. 수식을 실행하거나 cached 금액을 formula 행에 복제하지 않는다.
외부 참조·경로 이탈·지원하지 않는 shared/array/data-table 구조, malformed XML/UTF-8,
개수·길이 상한 초과는 모두 fail-closed한다.

실제 전수 재변환에서 다음 누락 보강을 원본별로 확인했다.

- 라온제나 분당: `XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: [ 총비용 = 예식비 + 식대총액 ]`
- 케이트웨딩플랜: `계약서!B20/B25/B26`의 원식과 cached 결과
  `₩4,160,000 / ₩2,196,000 / ₩1,464,000`을 각각 보존
- 케이트웨딩플랜 `계약서!C28`: `TODAY()`를 실행하지 않고 원식과 기존 cached 표시값
  `Friday, June 12, 2026`만 보존

보조 locator는 요청에 실제 포함된 정확한 locator와 전체 payload가 모두 일치할 때만
근거로 인정한다. 잘못된 part/text-box/cell, payload 부분 인용, 합성 quote,
`line:N` 별칭, 보조 payload를 셀처럼 꾸민 quote는 차단한다.

변환 캐시는 현재 파일의 SHA-256 지문이 manifest와 일치할 때만 재사용한다. 독립 감사가
찾은 오류 단위의 과거 미참조 `1-sheets.txt` 3개는 상태 경계·realpath·symlink/junction
검사를 거친 canonical convert 재실행으로 정리했다. 재검증 결과는 referenced artifact
`332`, generated evidence file `331`(나머지 1개는 raw PNG), missing `0`, fingerprint
mismatch unit `0`, orphan generated file `0`이다. Windows PowerShell의 260자 경로 제한은
이 content-addressed 경로를 거짓 누락으로 표시할 수 있으므로 전수 검증은 Node 파일 API와
pipeline status를 사용한다.

## 조선 팰리스 XLSX의 미지원 EMF 1건

- 원본: `예식장/강남/[서울(강남)]_조선 팰리스.xlsx`
- archive entry: `xl/media/image1.emf`
- 크기: `8,908 bytes`
- 위치: Sheet1의 대략 `A14:H16` 영역에 연결된 drawing
- 내용: 취소 시점별 예식 총비용 배상률 `10% / 20% / 35% / 50% / 70%`

이 이미지는 로고가 아니라 위약금 정책 표이므로 무시할 수 없다. Windows GDI로 진단용
PNG를 만들어 사람이 육안 확인했지만, 그 임시 파일은 원본·재현 가능한 pipeline 증거가
아니므로 Git이나 staging에 넣지 않았다. 원본 XLSX에서 이미지를 PNG/JPEG로 교체하거나
동일 업체 원본 묶음에 검수된 PNG를 제공한 뒤 scan부터 다시 실행해야 한다. 그 전까지
이 단위는 `xlsx_media_format_unsupported`로 fail-closed한다.

## 업체 identity 전수 재검사

실제 249개 단위에서 의심 identity 25건을 원본 경로와 다시 대조해 parser v3에
반영했다.

아래 규칙별 합계는 26건이지만, 중첩 괄호와 `㈜` 규칙이 동시에 적용된 1개 단위가
두 항목에 포함된다. 중복을 제거한 실제 변경 단위는 25개다.

- `_예식장`·`표준양식` 같은 제품명이 아닌 suffix 제거: 11건
- 중첩 괄호 법인명 분리: 7건
- `㈜` 법인명 분리: 6건
- 파일 복사 suffix `(1)` 제거: 1건
- `대전_` 잔여 지역 prefix 제거: 1건

예: `힐스코트(태성산업(주))`는 업체 `힐스코트`, 법인 `태성산업(주)`로 분리하고,
`더파티 김해점(더리본(주)더파티김해점)`의 전체 법인명은 잘리지 않게 보존한다.

## 동일 원본 복사본 2건

다음 두 경로는 SHA-256이 정확히 같다.

`0afd7d0ac57887f797904ba5a425486b385101328213417fb513f1c5230e085b`

1. `예식장/충청도/(충청도)_셀레네하우스웨딩(천안, 청주점).xlsx`
2. `예식장/충청도/(충청도)_셀레네하우스웨딩(천안, 청주점) (1).xlsx`

원본 감사 경로를 임의 삭제하거나 자동 병합하지 않았다. scanner는 두 경로를 모두
보존하되 `duplicate_source_content`로 두 단위를 차단한다. 사람이 어느 경로를
canonical source로 유지할지 결정하고 복사본을 별도 보관한 뒤 scan부터 다시 실행해야
한다.

## 사람이 변환해야 하는 HWP 8건

HWP 내용은 추정하거나 다른 업체 내용으로 대체하지 않는다. 아래 파일을 사람이 열어
동일 디렉터리·동일 stem의 PDF로 저장한 뒤 scan부터 다시 실행한다.

1. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\결혼준비대행서비스\강원도\(강원)_산과바다 베키니아호텔 주문진리조트_결혼준비대행.hwp`
2. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\예식장\강원도\(강원)_산과바다 베키니아호텔 주문진리조트_예식장.hwp`
3. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\예식장\광주\(광주)_웨딩그룹위더스 광주.hwp`
4. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\예식장\대구\(대구)_MH컨벤션.hwp`
5. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\예식장\부산\(부산)_목장원((주)푸드웨이).hwp`
6. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\결혼준비대행서비스\전라도\(전라도)_모니카블랑.hwp`
7. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\결혼준비대행서비스\충청도\(충청도)_오드 스튜디오.hwp`
8. `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\data\raw\예식장\서울(강남 외)\[서울(강남 외)]_국방컨벤션센터.hwp`

## 내용 보존·채점·적재 보강

- hall disclosure의 canonical `halls[]`를 대표 가격 한 줄로 축약하지 않고 홀별
  venue/meal/decoration/options pending 행으로 보존한다.
- 가격이 없어도 중요한 `pricing_basis`, 문서 section, 업체별 위약금·환불·변경 정책은
  private pending-only semantic staging으로 보존한다.
- semantic staging은 anon/authenticated 권한이 없고, service role도 `SELECT/INSERT`만
  허용한다. `UPDATE/DELETE`와 공개 view/API는 만들지 않는다.
- 모든 semantic row는 source file IDs, private object keys, preview keys, source quote,
  source/validation/content fingerprint를 가진다.
- 지어낸 금액 검사와 원문 금액 누락 검사를 분리한다. 가격이 맞더라도 필수
  policies/pricing_basis/sections/halls 포착이 빠지면 blocking 단위와 25건 배치를
  통과시키지 않는다.
- `KRW`, `₩` 표기 금액도 coverage inventory에 포함한다.
- old parser/converter/prompt/validation identity 산출물은 current 결과로 세지 않는다.

새 semantic staging migration은 아직 운영 DB에 적용하지 않았다. 이는 코드와 정적
권한 계약을 준비한 것이며 hosted backup/restore 및 write fence 없이 운영에 적용하면
안 된다.

2026-07-20 Supabase CLI read-only 확인에서 운영 migration head는
`20260715210000`, 로컬 미적용 migration은 `47개`
(`20260716090000`~`20260720120000`)였다. vendor release가 요구하는 선행 head
`20260716117000`에도 아직 도달하지 않았으므로 vendor migration만 분리 적용하지 않는다.
최근 자동 physical backup 7개는 모두 `COMPLETED`였지만 PITR이 비활성화돼 있고,
migration 직전 논리 backup·격리 프로젝트 restore rehearsal은 없다. 로컬 logical dump는
Docker daemon 부재로 생성되지 않았다. 따라서 자동 backup 목록은 release manifest의
`backup`/`hostedRestore` 증거를 충족하지 않는다. 운영 anon REST도
`v_public_prices`에 `404 / PGRST205`를 반환했다.

## 고정 8건 유료 추출 계획

- 실제 전달 모델 식별자: `gpt-5.6-luna`
- Luna의 의미: 별칭이나 타 공급자가 아니라 OpenAI Responses API에 그대로 전달되는
  literal model identifier
- prompt: `v7.11-exact-xlsx-auxiliary-repair`
- requests: `125`
- 예상 input tokens: `1,357,066`
- 예상 output tokens: `1,347,972`
- 예상 증분 비용: `$9.7841645`
- 단일 시도 보수 예약: `$2.769`
- 계획 SHA-256: `32fb11f972467405bed56ad3c1a59200b759f6702365b1583e0698e6debdf155`
- 이번 감사 중 실제 신규 provider 호출: `0`

과거 append-only ledger에는 102행, input `713,410`, output `523,539`, line-item
추정 누계 `$4.0023985`, 보수 fence 누계 `$4.185901626`가 남아 있다. 신규 state의
빈 ledger를 보고 역사적 비용을 0으로 되돌려 계산하면 안 된다.

2026-07-20 Vercel Production 환경을 값 비공개 방식으로 다시 pull했지만,
`OPENAI_API_KEY`와 모델·feature flag 값은 모두 `[SENSITIVE]` marker로 내려오므로 실제
형식을 판정할 수 없다. 과거 server-side Production checker는 OpenAI·모델 조건을
통과했고 `ADMIN_PASSWORD`만 실패했지만, 그 deployment는 도메인에 승격되지 않았다.
Vercel의 server runtime 비밀은 로컬 ingest CLI에 전달되지 않으므로 현재 process에는
실제 key가 없다. 키 값은 출력·저장·커밋하지 않았고 고정 8건 실행, strict score,
25건 배치는 시작하지 않았다.

## 2026-07-20 최종 로컬 게이트

- ingest typecheck: PASS
- ingest tests: `423 total / 422 pass / 0 fail / 1 Windows file-symlink EPERM skip`
- Supabase release tests: `166/166 PASS`
- static release fence: predecessor `27` + successor `20` PASS
- workspace typecheck: `4/4 packages PASS`
- workspace lint: PASS
- web tests: `304 files / 2,597 tests PASS`
- mobile tests: `111/111 PASS`
- Vercel Preview shape Next build: PASS, static pages `109`
- Expo export: Web/iOS/Android PASS
- mobile release readiness: `104/104 PASS`

이는 로컬 코드와 번들이 재현됐다는 증거다. 실제 OpenAI 응답 품질, hosted DB 적용,
운영 데이터 발행 또는 실기기 store binary의 성공 증거는 아니다.

## Git·배포 판정

- raw 원본, `.state`, 변환 산출물, 비용 ledger, API key는 Git에 올리지 않는다.
- 코드·테스트·migration·감사 문서만 Draft PR #64 branch에 올린다.
- 실제 OpenAI 고정 8건에서 blocking 7건이 `지어냄 0 / 판독 가능 누락 0 / 연결 오류 0 /
  semantic capture PASS`를 만족하기 전에는 25건 배치를 시작하지 않는다.
- 향후 staging에 적재되는 모든 행은 `pending`이어야 하며 관리자 검수 전 공개하지 않는다.
- hosted DB의 pre-migration backup, restore rehearsal, write fence, migration 적용 후 backup,
  RLS probe, rollback receipt가 없으면 DB 적용·PR 병합·운영 배포를 하지 않는다.
- PR #64는 현재 Draft이며 production-readiness hosted evidence가 없어 운영 판정은
  **NO-GO / NOT DEPLOYED**다.

## 다음 재개 순서

1. 실제 OpenAI key를 현재 로컬 ingest process에 비공개로 주입하고, Vercel 쪽은
   domain 미승격 Production build의 server-side checker로 유효성을 다시 확인한다.
2. HWP 8건을 사람이 PDF로 변환하고 동일 stem으로 저장한다.
3. 조선 팰리스 XLSX의 EMF 정책 표를 검수된 PNG/JPEG로 변환한다.
4. 셀레네하우스 동일 복사본 2건의 canonical source를 사람이 결정한다.
5. raw 전체 scan → convert → 원본/산출물 fingerprint 전수 검증을 다시 수행한다.
6. exact fixed-eight 계획을 다시 발급하고 비용 fence 안에서 순차 실행한다.
7. ground truth 발생 위치와 양방향 strict score를 수행한다. blocking 7건이 모두
   통과한 경우에만 immutable pass receipt를 발급한다.
8. 상태 인식형 25건 runner를 구현·리뷰한 뒤 배치별 비용/needs_review 급증 게이트와
   함께 전체 배치를 수행한다.
9. disposable hosted Supabase에서 clean migration, RLS, backup/restore를 먼저 증명한다.
10. 향후 적재되는 모든 staging 행은 `pending`이어야 하며, 관리자 전수 검수 후에만 공개 발행 후보를 만든다.
11. 모든 release gate가 같은 commit SHA에 귀속될 때만 PR 병합·운영 배포·카나리를 한다.
