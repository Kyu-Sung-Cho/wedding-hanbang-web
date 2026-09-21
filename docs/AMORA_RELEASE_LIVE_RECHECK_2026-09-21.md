# 아모라 추가 검수·운영 직접 확인 — 2026-09-21

상태: **BLOCKED / 미배포**. 제품 수정본의 로컬 검증과 운영 출시를 구분한다.
이 문서는 이번 후속 점검의 직접 관측 기록이며 기존 보고서의 과거 실행 결과를 덮어쓰지 않는다.

## 이번 작업에서 한 일과 하지 않은 일

- 결정 저장·승인·영수증과 개인정보 확인 대상 경계를 독립적으로 다시 읽었다.
  지정 범위에서 새로 확정할 기능 결함은 발견하지 못했다. 모든 화면·상황의 무결함을 뜻하지 않는다.
- 관련 웹 테스트 6개 파일 / 179개 테스트를 다시 실행해 모두 통과했다.
  memory route, TodayOne preferences, couple reset, decision tools/migration/result card를 포함한다.
- 저장소 핵심 회귀 25개 테스트가 통과했다. 그중 실제 로컬 PostgreSQL 17 동시성·권한·영수증 검증은 10개다.
  나머지는 후보 계약과 합성 hosted helper 검증이다. 테스트 이름의 hosted는 이번 실행이 원격 환경이었다는 뜻이 아니다.
- 02:41 KST에 이전 전체 검증에서 고정한 소스 188개의 SHA-256을 다시 대조했다. 차이 없음(`drift: []`).
  이번 후속 점검에서 제품 소스·SQL·릴리스 안전장치는 변경하지 않았다.
- `git diff --check`, `git diff --cached --check` 통과. 미해결 merge conflict 없음.
- 실제 GitHub/Vercel/Supabase 상태를 조회했다. 운영 DB 조회는 Management API의 `read_only:true`와
  SQL `BEGIN READ ONLY`를 함께 사용했다. 고객 원문·Auth 사용자·Storage 원본은 조회하거나 출력하지 않았다.
- 이번에는 commit, push, PR 생성/병합, Vercel 배포, 원격 DB 변경, 시험 프로젝트 재개,
  새 프로젝트 생성, 유료 전환, 데이터 복원/삭제를 하지 않았다.

## 실제 운영 상태

### GitHub

원격 main은 `969f6f5ab8c67d1e0f19025063a9c4fafd767efd`로 통합 기준과 같았다.
GitHub 인증은 정상이며 `codex/amora-release-integration-20260920` 브랜치의 PR은 없다.

[main CI 실행 35513607926](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/35513607926)을 직접 조회했다.
웹/모바일/저장소/정적 계약 검사와 Code Quality 신호는 성공했다.
`Production Readiness: BLOCKED (Hosted Evidence Required)`와 `Quality Gate`는 실패했다.
현재 CI 소스는 운영 증거가 없으면 의도적으로 실패하도록 돼 있다.
이는 GitHub 인증 실패가 아니며, 이번 로컬 수정본의 CI 결과도 아니다.

### Vercel / hanbang.ai

2026-09-21 02:36 KST 직접 API 조회:

- deployment: `dpl_31QnaA1KfgCWosXyQwnX5XVB2NPp`
- 상태: `READY`, target: `production`
- Git source: main / `969f6f5ab8c67d1e0f19025063a9c4fafd767efd`
- alias에 `hanbang.ai`, `www.hanbang.ai`가 실제 포함돼 있다.

따라서 현재 도메인은 기존 main 배포에 연결돼 있다. **이번 미커밋 아모라 수정본이 배포됐다는 뜻이 아니다.**
로컬 저장 Vercel access token의 만료로 첫 직접 조회가 403이었으나,
기존 설치 CLI의 조회 명령으로 인증이 갱신된 뒤 같은 API 조회가 200으로 성공했다.
토큰을 출력하거나 저장소로 복사하지 않았고, 배포 명령도 실행하지 않았다.

### 기존 운영 Supabase

2026-09-21 02:33–02:36 KST 직접 조회:

- project: `slrtobkksjmxgzatjyqb`, 상태: `ACTIVE_HEALTHY`
- 실제 DB: `postgres`, PostgreSQL `17.6`
- system identifier: `7581440907192989109`
- 실제 migration ledger: **226행**, head: `20260920120000`
- 최신 ledger 항목: `wedding_preparation_style`
- 신규 `20260921100000` / `20260921101000`는 미적용이다.
- 전체 ledger `to_jsonb(row)`를 version 순서로 합친 SQL 측 SHA-256:
  `b8a6d177e7776127a8545d5bd283504e9584445c828114a78798de8f76516486`

저장소 237/239개 SQL과 운영 ledger 226행을 동일 개념으로 취급하지 않는다.
이 차이만으로 누락을 단정하거나, 과거 migration을 재적용하거나, ledger를 수동 보정하지 않는다.
위 SHA-256은 관측 snapshot이지 전체 역사 승인이나 운영 적용 허가가 아니다.

읽기 전용 Management API의 실제 `current_user`와 `session_user`는 둘 다 `supabase_read_only_user`였다.
이 상태에서 기존 preparation-style 관측 SQL과 validator를 함께 사용한 시도는
`PREPARATION_STYLE_OBSERVATION_INVALID`로 거절됐다. 기존 validator는 `postgres`를 요구한다.
후속 identity 조회로 `readOnly:on`, DB/버전/system identifier를 별도로 확인했다.
기존 validator를 완화하거나 `read_only:false`로 바꿔 재시도하지 않았다.
따라서 이 실행을 전체 predecessor catalog 검증 성공으로 기록하지 않는다.
새 조회 전용 inspector는 실제 조회 role 계약을 별도로 검토해야 한다.

### 기존 시험 환경

동일한 기존 무료 시험 조직 `Wedding Hanbang Staging Free`의 `plan:free`를 직접 확인했다.

- `wedding-hanbang-vendor-staging-v2` (`rgxdizztidbgwnsbadml`): `INACTIVE`
- `wedding-hanbang-vendor-staging` (`xabmxajstsgxvimizpmm`): `INACTIVE`

저장소의 과거 vendor RLS 계약은 v2를 지정하고 있으며, 과거 운영 문서에도 그 프로젝트의 시험 이력이 있다.
그 과거 승인/성공이 새 아모라 SQL의 검증이나 기존 시험 데이터 덮어쓰기 허가는 아니다.
추가 비용·유료 전환·프로젝트 신규 생성 없이 기존 v2를 재개해 아모라 검증에 재사용할지 사용자에게 질문했다.
현재까지 재개나 쓰기는 하지 않았다. 복구/시험을 위해 운영 프로젝트를 교체하지 않는다.

## 배포 전 남은 일

1. 실제 조회 role과 ledger를 반영한 239 전용 관측/적용/독립 readback 계약 구현·실패 주입 검증.
2. 기존 시험 환경의 사용 범위 확정 후 실제 Auth/RLS/두 계정·동시성·구/신 클라이언트 검증.
3. 실제 DB+Storage 원본 백업·격리 복구, 전역 write fence/진행 중 요청 종료 확인,
   privacy 경계를 보존하는 rollback과 finalizer 증거 확보.
4. clean reviewed commit과 해당 증거를 결합한 CI/PR, 실제 운영 적용, Vercel 운영 배포 및 제품 흐름 확인.

`ship`의 미완료 계획 게이트 및 `land-and-deploy`의 PR/CI 준비 조건을 충족하지 않았다.
정적 후보의 false 플래그를 true로 바꾸거나 CI의 차단을 삭제해 이를 통과시켜서는 안 된다.
구현 상세는 [239 후속 계획](AMORA_239_RELEASE_REMAINING_PLAN_2026-09-21.md),
기존 전체 로컬 검증은 [통합·재검증 기록](AMORA_RELEASE_INTEGRATION_REPAIR_2026-09-21.md)을 함께 참고한다.
