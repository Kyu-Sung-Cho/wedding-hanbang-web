# W13 최신 백업 수집 준비

상태: **원본 수집·전체 복원 미완료. 최신 변경 이력과 별도 권한 변경을 대조하는 준비 작업.**

기준 소스는 `4216fddad09f8fbfd4ff75399adc6b9b36f2651f`다. 이전
`RECOVERY_DELIVERY_STAGE_2026-09-13.md`의 합성 복원 결과를 유지한다.
그 결과를 현재 고객 원본의 DB·Auth·Storage 복원 성공으로 확대하지 않는다.

## 이번에 직접 확인한 상태

2026-09-28 10:40–10:53 UTC에 운영 프로젝트의 카탈로그를 읽기 전용으로 관측했다.
고객 대화·계정·사진 원문을 조회하거나 내려받지 않았다. 함수 본문과 마이그레이션
원문은 DB 안에서 해시로 계산했으며, 자동 작업의 명령도 해시만 반환했다.

| 항목 | 확인된 사실 | 의미와 한계 |
|---|---|---|
| 로컬 SQL | 현재 정적 계약이 정확한 240개 파일과 원문을 검증 | 파일 개수만 맞추는 허용 목록이 아님 |
| 운영 변경 이력 | 고정된 과거 215행과 정확한 후속 SQL 14개의 예상 값이 실제 229행과 전부 일치 | version·name·statement SHA256 비교. 전체 스키마 동일성은 별도 |
| 별도 join 권한 변경 | 기존 validator의 `after` 검사 통과 | 세 함수의 정의 해시·소유자·명시/실효 권한 확인 |
| 별도 fitting 권한 변경 | 기존 validator의 `after` 검사 통과 | 두 함수의 정의 해시·설정·명시/실효 권한 확인 |
| DB 및 확장 | PostgreSQL 17.6, pg_cron 1.6.4, supabase_vault 0.3.1 | 복원 대상의 실제 호환성은 별도 확인 |
| 자동 정리 | `wedding-code-pair-session-purge` 작업 1개가 활성 상태. 명령 해시·일정·DB/user·로컬 대상이 기존 릴리스 기준과 일치 | 옛 baseline의 cron 0 조건과 다름. 운영 보존기간 관리 작업을 제거하지 않으며 복원 대상의 실행 차단은 별도 |
| 관리 영역 | Auth·Storage·Realtime 등의 객체 해시와 관계 목록 변화 | Supabase 관리 변경을 포함하므로 후속 수집 계약에서 검토 필요 |
| 현재 PC | 비관리자 조회에서 BitLocker 상태 접근 거절, QEMU 실행 0개 | 암호화가 꺼졌다는 뜻이 아님. 원본 반입 조건 미확인 |

이 관측들은 각각의 읽기 전용 트랜잭션 결과다. 하나의 백업 snapshot이나 쓰기 중단
상태를 증명하지 않는다. W12 합성 계정 삭제 결과를 전체 삭제 replay로 간주하지 않는다.

첫 관측에서 발견한 객체 해시 차이 120건 중 15건은 조회 환경 차이였다. MCP 기본
`search_path`에는 `extensions`가 포함되어 있다. `public,pg_catalog`를 명시한 동일
카탈로그 질의에서는 기존 public 테이블 7개, event trigger 6개, 확장 view 2개의
해시가 과거 baseline과 정확히 일치했다. 운영 구조를 수정하지 않았으며, 나머지
105건을 자동 승인한 것도 아니다.

최종 질의는 내장 객체가 먼저 선택되도록 `pg_catalog,public` 순서를 사용한다.
두 순서로 실제 조회한 객체 1,141개·관계 289개·원장 229행·Storage 정책이 모두
동일함을 확인했다. 전체 카탈로그 질의가 참조하는 내장 함수와 표를 public보다
먼저 찾게 하면서, 같은 정의 표기를 유지한다.

## 수집 도구가 아직 받을 수 없는 이유

기존 archive CLI는 과거 SQL 227개 계약을 먼저 읽어 현재 디렉터리에서
`NEW_MIGRATION_NOT_REVIEWED`로 종료한다. 별도로 전체 관측을 과거 validator에
대입하면 cron 0 조건 때문에 `BASELINE_EXTERNAL_STATE_CHANGED`가 발생한다.
이 조건과 과거 파일 해시는 당시의 기록이므로 덮어쓰지 않는다.

새 `scripts/lib/recovery-capture-lineage.mjs`는 기존 240개 정적 계약과 과거 관측을
재사용하여 정확한 예상 원장을 만든다. 이 모듈의 비교 범위는 변경 이력과 수동 권한
변경이다. 전체 운영 baseline 채택, 고객 원본 수집, 호스트 반입, 복원 실행을 허용하지
않으며 기존 capture/restore CLI의 제한을 바꾸지 않는다.

같은 모듈의 `buildRecoveryCaptureInventorySql(repoRoot)`는 과거 inventory SQL의
고정 해시를 확인한 뒤 읽기 전용 트랜잭션 안에 `SET LOCAL search_path = pg_catalog, public;`
를 추가한다. 원문 SQL 파일을 바꾸지 않으며, 질의 반환 자체가 실행이나 복원 승인은
아니다. 후속 수집기에서도 이 조회 환경을 일관되게 사용해야 한다.

## 다음 실행 순서

1. **수집 기준 확정:** 최신 카탈로그 차이와 자동 작업을 검토하고, 별도 capture
   successor에 현재 기준을 연결한다. 기존 동일 snapshot·두 번의 안정성 대조·Storage
   원본 재읽기·암호화 기능은 재사용한다. 현재 원본 용량이 기존 크기 제한 안인지도
   실제 메타데이터로 확인해야 한다.
2. **반입 환경과 전달 연결:** PC의 볼륨·메모리 기록 파일 보호, 전용 접근 범위,
   대상 격리, DPAPI 암호화 자료 전달·복호화 경로를 확인한다. BitLocker 표시 하나로
   모든 조건을 완료 처리하지 않는다.
3. **대상 복원 연결:** 관리 schema·globals·확장, Auth 및 Storage 서비스와 파일 bytes를
   복원하고 비교한다. 복구 대상의 자동 작업이 검증 중 데이터를 바꾸거나 외부 작업을
   실행하지 못하게 해야 한다. 운영 자동 작업을 이 준비 단계에서 끄지는 않는다.
4. **실제 복구 시험:** 승인된 작업창과 쓰기·업로드 안정 조건에서 원본을 수집하고,
   분리된 대상에 복원한 뒤 삭제 이력 재적용과 재검증을 한다. 여기까지의 실제 결과가
   있어야 W13을 완료할 수 있다.

운영 관측 원문은 저장소의 테스트 fixture로 복사하지 않았다. 외부 증거 폴더
`web-launch-20260928/w13-capture-preparation/`의 `catalog-observation.json`,
`join-observation.json`, `fitting-observation.json`, `managed-observation.json`,
`metadata-comparison.json`에 질의와 응답, 비교 결과를 보존한다. 조회 환경 대조는
`render-context-observation.json`, `render-context-comparison.json`,
`catalog-explicit-search-path.json`, `canonical-metadata-comparison.json`, 자동 작업
대상 확인은 `cron-destination-observation.json`이다. 최종 builder 질의의 실제 응답은
`catalog-first-builder-observation.json`이다. 실제 배포·출시 판정은 별도다.
