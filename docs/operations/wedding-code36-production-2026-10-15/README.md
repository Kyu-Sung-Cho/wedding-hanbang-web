# WeddingCode 36문항 운영 반영 준비

상태: **PREPARATION ONLY — 배포·DB 적용·운영 검증 완료 영수증이 아님**

사용자는 2026-10-15 대화에서 수정된 36문항을 운영 사이트에 반영하고 커플 연결과 결과를 검사하도록 명시적으로 요청했다. 이 문서는 그 요청의 좁은 릴리스 범위를 정리한다. 다른 기능의 미해결 출시 조건을 닫았다고 주장하지 않는다.

## 직접 확인한 기준점

2026-10-15 17:05 KST 읽기 전용 확인 기준:

| 항목 | 값 |
| --- | --- |
| 저장소 | `Kyu-Sung-Cho/wedding-hanbang-web` |
| 운영·원격 main·분리 작업 트리 시작 SHA | `56e564b0f2653a22f40ca1c07f1eb8e75f9d7fd1` |
| Vercel 팀 | `hanbang` / `team_XwMZqiJ4wXM2Ypvs99icXaQx` |
| Vercel 프로젝트 | `wedding-hanbang-web` / `prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes` |
| 운영 도메인 | `hanbang.ai`, `www.hanbang.ai` — verified |
| 직전 운영 배포 | `dpl_96vNCcCubkYqmVPdYvX7RyWYjRzP` — READY |
| 직전 운영 빌드 URL | `wedding-hanbang-4tbu492y1-hanbang.vercel.app` |
| 앱 경로·운영 브랜치 | `apps/web`, `main` |
| Vercel Node | `24.x` |
| 설치 | `cd ../.. && pnpm install --frozen-lockfile` |
| 빌드 | `cd ../.. && pnpm build:web` |
| 인증 | 기존 Vercel token으로 GET 성공, GitHub API GET 성공; secret 값 미기록 |
| 운영 응답 | `GET https://hanbang.ai/wedding-code` → HTTP 200 |

GitHub main 보호는 관리자에게도 적용된다. `strict=true`이며 필수 검사는 정확히 `Code Quality (breakage signal only — not a release authorization)`이다. 리뷰 요구 수는 0이지만 보호 규칙을 우회하는 direct push나 admin merge를 절차로 삼지 않는다.

## 범위와 기존 NO-GO의 적용

- 기준은 지금 운영 중인 main이다. 과거 integration branch나 전체 로컬 변경을 함께 올리지 않는다.
- 앱 변경은 WeddingCode 36문항 입력, 개인 결과, 초대, 참가자별 결과 조회, 공유 설정 및 관련 검사로 한정한다.
- DB 변경은 새 `wedding_code36_*` 객체만 대상으로 한다. 기존 응답, 기존 커플, 아모라, Auth, Storage 데이터의 수정·이전·삭제·backfill은 포함하지 않는다.
- `START_HERE.md`의 과거 전체 integration branch NO-GO를 현재 운영 main의 모든 좁은 변경에 대한 자동 차단으로 해석하지 않는다. 현재 개인정보 인계의 표면별 표도 WeddingCode는 별도 current gate와 exact SHA 검증이 필요하다고 명시한다.
- 반대로 넓은 NO-GO와 분리했다는 이유로 동의, 소유자 접근, 보관·삭제, source binding, scoped DB 검증을 생략하지 않는다. 사람이 이해하는지와 심리측정 타당도는 자동 테스트로 검증됐다고 쓰지 않는다.
- 기존 release manifest의 `deployment_blocked`와 과거 evidence 항목은 바꾸지 않는다. 다른 기능을 켜거나 기존 쓰기 fence를 내리지 않는다.

## CI와 앱 사전 검사

1. 변경 파일을 목적별로 확인한다. 다른 기능의 변경, 운영 환경 파일, secret, 실제 사용자 원문은 포함하지 않는다.
2. 문항 버전 `wcr36-r6-2026-10-15`, fingerprint `982e2623c147bd7bbeefd2f7e1a6fb7ec27cbbd28e60bb62a0c002c148735f16`을 현재 앱과 원본에서 대조한다.
3. 전체 1·2·3·4·5점, 25가지 동일선택 커플 조합, 동점, 중립, 서로 다른 장면, 미응답, 공유 철회를 검사한다. 사람·인구의 비율이나 궁합 점수로 해석하지 않는다.
4. 본인 비밀키 없이 초대키만으로 결과를 읽을 수 없는지, 제삼자·다른 커플·만료·철회·동시 참가·중복 제출·새로고침·브라우저 복구를 검사한다. 개인 이름을 공유하지 않으면 비교 본문에 개인 비공개 이름이 새지 않아야 한다.
5. 관련 테스트 후 web typecheck, lint, production build, 기존 WeddingCode 회귀 검사를 수행한다. 사용한 명령과 실제 결과를 별도 영수증에 남긴다.
6. PR CI의 다섯 축(Web Quality, Web Tests 4개 shard, Mobile Quality, Vendor Disclosure Quality, Static Release Contracts)을 모두 확인한다. main push에는 설치 캐시 잡만 실행되므로 이를 테스트 통과로 세지 않는다.
7. PR에서 최신 main과 합쳐 검사한 tree를 기록한다. 병합 tree가 검사 tree와 같은지 확인한다. 필수 Code Quality green은 코드 파손 검사일 뿐 운영 DB 적용 증거가 아니다.

## 새 DB 변경을 안전하게 닫는 순서

기존 explicit scoped lane의 실제 구현은 `scripts/lib/wedding-code-pair-session-release.mjs`, `wedding-code-pair-session-conflict-release.mjs` 등이다. 기본 successor controller의 넓은 migration 세트를 실행하는 대신 새 범위에 맞춘 exact contract와 검증을 갖춘다. 기존 lane은 migration 전체 목록을 고정하므로 새 SQL이 있으면 `NEW_MIGRATION_NOT_REVIEWED`로 막히는 것이 정상이다.

적용 전 필요한 증거:

- [ ] 새 lane 또는 동등하게 검토된 scoped 실행 경로가 source에 있고 실제 mutation entrypoint가 검증되어 있다. 기존 controller를 우회하는 임의 SQL 호출을 release 성공으로 간주하지 않는다.
- [ ] 단 하나의 새 migration 원문과 SHA-256, 생성·변경할 객체·권한·함수 목록이 고정되어 있다. 구 migration의 파일·hash는 동일하다.
- [ ] 실행 source는 clean exact commit이다. GitHub commit, PR 검증 tree, DB receipt, web 배포 source가 연결된다.
- [ ] 운영 project ref와 DB system identifier를 원격 관측으로 확인한다. 기존 환경변수 이름이 있다는 사실만으로 올바른 DB라고 판정하지 않는다.
- [ ] 적용 전 ledger와 대상 객체의 부재/정확한 기존 정의, 영향을 받지 않아야 할 객체 catalog digest를 저장한다. 운영 사용자 행의 원문을 로그에 남기지 않는다.
- [ ] 이 좁은 추가 릴리스의 복구 증거는 새 객체의 적용 전 부재, 기존 catalog/ledger digest 보존, transaction rehearsal rollback이다. 기존 고객 행을 변경·이전하지 않으므로 고객 데이터의 새 export는 만들지 않는다. 이 metadata 기록을 전체 DB 백업 또는 재해 복구 검증으로 부르지 않는다. 기존 DB의 제공자 백업 상태는 이 문서에서 검증하지 않았다. 실제 범위가 기존 데이터 수정으로 넓어지면 별도 백업·복구 gate를 먼저 추가한다.
- [ ] 새 테이블 접근권한·RLS·RPC ACL·고정 search_path·최소 권한을 검사한다. service-role 전용임을 anon/authenticated의 실제 거절로 확인한다.
- [ ] 보관 기간, 결과 공유 동의와 철회, 본인 데이터 삭제 경로가 앱 고지와 DB 동작에서 맞는지 확인한다. 이 조건은 새 개인정보 저장 범위의 실제 gate다.
- [ ] 단일 transaction에서 rehearsal하고 rollback 후 ledger와 보존 catalog가 같음을 관측한다. rehearsal이 운영에서 실행되면 이를 단순한 read-only 검사라고 부르지 않는다.
- [ ] 적용 직전 source·SQL hash·ledger를 재확인하고, deadline/동시 실행 방지를 건다. 결과가 모호하면 자동 재시도하지 않고 읽기 전용 재관측으로 판정한다.
- [ ] 적용 후 새 객체·권한·함수 원문·ledger 한 건 증가 및 나머지 catalog 불변을 확인한다. 적용 파일명만 ledger에 있는 것으로 성공 판정하지 않는다.

새 scoped lane은 `scripts/wedding-code36-release.mjs`, 고정 manifest는 `supabase/release-contracts/wedding-code36-v1.json`이다. 로컬 static gate `node scripts/wedding-code36-release.mjs --check-only`는 새 원문 hash와 운영 base의 기존 388개 migration·release-contract·controller 파일 보존을 검사하며 외부 credential이나 원격 호출을 사용하지 않는다. CI는 exact checkout SHA를 추가로 확인한다. controller 오프라인 단위 검사 12개가 통과했다. 이 문서 작성 시점에는 운영 적용 영수증이 없으며, 운영 관측·적용은 담당 실행자가 완료 후 기록한다.

운영 실행 시 source commit과 receipt 파일명을 고정한다. 다음은 실행자가 credential을 기존 승인된 비밀 전달 경로로 메모리에 넣은 뒤 사용하는 명령 형식이다. receipt는 Git 밖의 기존 보호 디렉터리에 새 이름으로 기록한다. 출력에는 secret이 없다.

```text
node scripts/wedding-code36-release.mjs --inspect --expected-commit=EXACT_SHA --project-ref=slrtobkksjmxgzatjyqb --receipt-out=ABSOLUTE_PRIVATE_INSPECT_JSONL --confirm-production=wedding-code36-20261015:slrtobkksjmxgzatjyqb:inspect:EXACT_SHA
node scripts/wedding-code36-release.mjs --apply --expected-commit=EXACT_SHA --project-ref=slrtobkksjmxgzatjyqb --receipt-out=ABSOLUTE_PRIVATE_APPLY_JSONL --confirm-production=wedding-code36-20261015:slrtobkksjmxgzatjyqb:apply:EXACT_SHA
node scripts/wedding-code36-release.mjs --verify --expected-commit=EXACT_SHA --project-ref=slrtobkksjmxgzatjyqb --baseline-receipt=ABSOLUTE_PRIVATE_APPLY_JSONL --receipt-out=ABSOLUTE_PRIVATE_VERIFY_JSONL --confirm-production=wedding-code36-20261015:slrtobkksjmxgzatjyqb:verify:EXACT_SHA
```

`--apply`는 내부에서 rehearsal과 rollback 재관측 후 정확한 SQL을 한 번만 commit한다. `--verify`는 같은 source commit의 apply baseline과 새 read-only 관측을 비교한다. 애매한 쓰기 결과는 자동 재시도하지 않는다.

## 배포와 Vercel 수동 Git 경로

운영 DB의 새 범위가 검증된 뒤에만 36문항 화면을 활성화한다. 운영 프로젝트 환경변수를 그대로 사용하며 로컬·Git·터미널에 secret을 복사하거나 출력하지 않는다. preflight에 실제 값의 적합성 확인이 필요하면 메모리에서 Boolean 결과만 기록한다.

현재 project API의 `gitProviderOptions.createDeployments`는 `disabled`다. 이 값만 보고 자동 빌드 동작을 단정하지 말고 병합 뒤 exact SHA 배포가 생성되는지 확인한다. 자동 배포가 없으면 기존 프로젝트의 [공식 생성 API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)로 Git source를 지정할 수 있다. [공식 OpenAPI](https://openapi.vercel.sh)의 GitHub variant는 `type`, `ref`, `repoId`가 필수이고 `sha`를 지원한다.

다음은 **미실행 요청 예시**다. `RELEASE_COMMIT_SHA`는 실제 검사·병합된 40자리 SHA로 치환해야 한다. 기존 인증을 서버 메모리의 Authorization 헤더로만 사용한다.

```json
{
  "name": "wedding-hanbang-web",
  "project": "prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes",
  "target": "production",
  "gitSource": {
    "type": "github",
    "ref": "main",
    "repoId": 1154313327,
    "sha": "RELEASE_COMMIT_SHA"
  }
}
```

Endpoint는 `POST https://api.vercel.com/v13/deployments?teamId=team_XwMZqiJ4wXM2Ypvs99icXaQx`다. `projectSettings`, 새 환경변수, gitAccessToken, 로컬 파일 업로드, `forceNew`, `skipAutoDetectionConfirmation`은 이 경로에 불필요하다. 응답·로그는 필요한 상태 필드만 기록한다. POST timeout의 결과가 모호하면 동일 SHA 배포 목록부터 읽고 중복 생성하지 않는다.

READY 뒤 project production target 및 두 도메인의 source SHA와 deployment ID를 재조회한다. READY나 HTTP 200만으로 문항 반영을 판정하지 않는다. 미리보기는 `all_except_custom_domains` SSO 보호가 있으므로 보호 해제 대신 기존 승인된 접근 방법을 사용한다.

## 실제 운영 검증과 정리

각 운영 검사는 synthetic 제출 ID로 구분하고, 실제 사용자 응답·초대·커플을 조회하거나 재사용하지 않는다. 응답 수가 운영 분석에 섞이지 않게 test marker 또는 별도 관리 명단을 사용한다. 새 endpoint의 요청 한도 안에서 실행하고, 대량 1,000개 검사는 격리 환경에서 하며 운영 검사는 필요한 대표 케이스로 제한한다.

- [ ] 두 독립 브라우저 컨텍스트에서 36문항 완료 → 이름 우선 개인 결과 → 초대 전달 → 상대 완료 → 양쪽 커플 비교까지 실제 화면으로 확인한다.
- [ ] 전체 1·2·3·4·5점의 실제 제출과 결과를 확인한다. fallback 이름이 같을 수 있어도 평균·답의 상태·설명은 입력과 일치해야 한다.
- [ ] 전체 3점끼리와 1점/5점 조합에서 과장된 균형·성격·궁합 해석이나 네 글자 물음표가 없는지 확인한다.
- [ ] 각 이름 공유 설정, 공유 항목 축소, 비교 철회 후 양쪽 새로고침에서 실제 비교 노출이 줄어드는지 확인한다.
- [ ] 제삼자, 키 없는 조회, 잘못된 초대, 정원 초과, 자기 연결, 재시도·새로고침, 다른 커플의 독립성을 확인한다.
- [ ] 실제 UI 캡처에는 결과만 포함하고 비밀키·초대 주소·원문 응답·관리자 credential은 노출하지 않는다.
- [ ] synthetic row만 대상으로 검토된 정리 경로를 사용하고 결과 수를 기록한다. 삭제가 미구현이면 테스트 전에 이를 미충족 조건으로 처리한다.
- [ ] 검증 완료 후 실제 deployment ID·SHA·DB receipt·검사 수·실패 수·한계를 별도 완료 보고서에 기록한다.

## 복구

DB 적용 전 실패: 운영은 그대로 둔다. DB transaction 내부 오류는 rollback을 검증한다.

DB 적용 결과가 모호함: 자동 재적용·ledger 수동 수정·구 migration 재실행을 금지한다. 새 객체와 ledger를 읽기 전용으로 재관측한다.

새 DB만 적용되고 web 미배포: 기존 앱이 새 객체를 사용하지 않는다면 새 객체를 남긴다. 기존 테이블·함수를 건드리지 않았음을 postcheck로 확인한다.

web 배포 후 문제: 직전 source-bound 배포 `dpl_96vNCcCubkYqmVPdYvX7RyWYjRzP`로 [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)을 수행하는 경로를 사용한다. source·환경 적합성·접근 가능성을 직전에 재확인한다. 롤백 뒤 두 도메인과 기존 WeddingCode 흐름을 다시 검사한다. additive DB 객체와 이미 제출된 새 응답은 보존하며 DROP·데이터 덮어쓰기·이전 DB 복원은 자동 수행하지 않는다. 공유 철회·삭제 등 참가자 권리 경로가 rollback 후에도 보존되는지 별도로 확인한다.

완료의 의미는 운영에 반영된 exact source와 실제 커플 흐름을 검증했다는 것이다. 심리검사 타당도, 모든 사람의 만족, 결혼 결과 예측을 검증했다는 뜻이 아니다.

## 읽은 내부 근거

- `AGENTS.md`, `PRINCIPLES.md`, `START_HERE.md`
- `.github/workflows/ci.yml` 및 GitHub main branch protection API
- `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`의 Vercel/source-binding 절차
- `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md`의 표면별 판정
- `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`
- `scripts/lib/supabase-production-release-controller.mjs`
- `scripts/lib/wedding-code-pair-session-release-contract.mjs`, `wedding-code-pair-session-release.mjs`
- `scripts/lib/wedding-code-pair-session-conflict-release-contract.mjs`
- `scripts/supabase-release-fence.mjs`

과거 Candidate 4 문항 생성 프로토콜은 현재 저장소에서 RETIRED로 표시되어 있다. 그 문서를 새 36문항 출시 승인 근거로 재사용하지 않는다.
