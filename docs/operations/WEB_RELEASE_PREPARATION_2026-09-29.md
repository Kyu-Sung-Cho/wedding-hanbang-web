# 웹 출시 후보 준비 — 2026-09-29

웹 우선 출시를 위한 후속 작업이다. 앞선 [다섯 차례 점검](WEB_FIVE_PASS_AUDIT_2026-09-28.md)은 로컬 검증 이력으로 유지한다. 이 문서는 그 이후의 변경과 실제 운영 조회를 구분한다. 원격 쓰기·배포·고객 자료 반입은 실행하지 않았다.

## 1. 운영 기준 확인 — 완료

- E: `git fetch --prune origin` 후 후보 시작점과 원격 main은 모두 `4216fddad09f8fbfd4ff75399adc6b9b36f2651f`다. 기존 수정은 `codex/web-prelaunch-audit`에 보존했다.
- E: Vercel에서 `hanbang.ai`가 가리키는 production 배포는 `dpl_BcP6JGq6iRihwkiEsv8jYXeGYhGB`, READY, 같은 main commit이며 두 도메인 alias를 확인했다. 새 후보의 운영 배포 성공을 뜻하지 않는다.
- E: 연결된 Supabase `slrtobkksjmxgzatjyqb`는 ACTIVE_HEALTHY, PostgreSQL 17.6, 고정 system identifier와 일치했다.
- E: 기존 `reset_current_couple_membership()`과 직전 migration 기록은 존재한다. 새 `reset_expected_couple_membership(uuid,uuid)`와 `20260928144843` 기록은 없다. 따라서 새 웹만 먼저 배포하면 초기화 기능은 503으로 차단된다.
- E: 실제 원장은 229행이며 로컬 전신 SQL은 240파일이다. 기존 고정 운영 baseline 215행과 검증된 후속 14개를 합친 버전 목록이 운영 229행과 정확히 일치했다. 파일 수를 원장 행 수로 가정하던 새 실행 검증을 수정했다. 기존 미적용 역사 SQL을 추가 적용하거나 원장을 다시 쓰지 않는다.
- E: 기존 초기화 함수의 실제 정의·소유자·권한·설정을 새 PG17 fixture와 비교해 일치함을 확인했다. 새 함수의 부재도 함께 확인했다.
- 조회는 READ ONLY 트랜잭션의 시스템·함수·권한·원장 존재 여부로 제한했다. 고객 행을 조회하거나 기능을 실행하지 않았다.

## 2. 이번 후보의 추가 수정

- 새 초기화 SQL 하나만 검증하는 PostgreSQL 17 적용·롤백 시험과 실행 경로를 구현했다. 기존 240개 계약 원문은 변경하지 않았다.
- 운영 전역 쓰기 차단·DB/Storage 원본 백업·복원·rollback의 이번 후보용 완료 증거는 아직 확보하지 못했다. 따라서 새 운영 경로는 읽기 전용 inspect만 열고, rehearse/apply는 원격 요청 전에 차단한다. 로컬 query 주입 시험이 실제 운영 적용 허용을 의미하지 않는다.
- 구버전 native WebView는 새 소유자 헤더를 거부한 뒤 응답하지 않아 개인 가격 기능이 시간 초과될 수 있었다. 새 native는 문서 nonce에 묶인 지원 표식을 제공하고, 새 웹은 표식이 없는 앱에서 개인 API를 보내기 전에 안내한다. 사용 가능한 앱 업데이트를 단정하지 않고 웹브라우저의 `hanbang.ai` 이용 방법을 안내한다. 공개 가격 조회와 일반 웹브라우저 이용은 유지한다.
- 실제 배포 중인 모바일 버전과 업데이트 제공 여부는 미확인이다. 모바일 호환성의 검증 범위는 별도 [기록](WEB_RELEASE_MOBILE_COMPATIBILITY_2026-09-29.md)에 남긴다.

## 3. 운영 보안 알림 확인

E: Supabase advisors는 7개 유형, 189개 개별 알림을 반환했다. 알림 개수를 곧바로 취약점 개수나 해결 개수로 해석하지 않는다.

| 알림 | 관측 수 | 이번 판단 범위 |
|---|---:|---|
| RLS 활성·정책 없음 | 69 | 클라이언트 접근을 닫고 서버 전용으로 쓰는 테이블도 포함한다. 일괄 정책 추가 금지. 전체 허용 동작 검증으로 확대하지 않음 |
| SECURITY DEFINER view | 11 | 실제 정의를 읽었다. 공개 가격은 승인·공개 필터, 개인 view는 본인·커플 필터가 있다. 경고만 보고 일괄 invoker 변경하면 기존 접근 계약이 달라짐 |
| 고정 search_path 없음 | 19 | 추가 보완 대상으로 남긴다. 직접 호출 불가 trigger와 클라이언트 권한이 없는 함수도 포함. 이번 초기화 함수에는 고정 경로·시간 제한을 적용 |
| public 스키마 확장 | 1 | pg_trgm. 의존 연산자·기존 계약 확인 없는 즉시 이동은 하지 않음 |
| 익명 SECURITY DEFINER 실행 | 21 | trigger와 본인 권한 검사 helper, 공개 업체·운영 모드 조회를 포함. 함수 종류와 본문을 확인했으며 전체 경고 해소로 표시하지 않음 |
| 회원 SECURITY DEFINER 실행 | 67 | 의도한 회원 기능도 포함. 새 초기화 보호와 별개로 기존 RPC 권한을 일괄 회수하지 않음 |
| 유출 비밀번호 차단 비활성 | 1 | 이메일/비밀번호 로그인 코드가 존재하므로 소셜 로그인 전용이라는 이유로 무시할 수 없음. 연결 조직은 Pro로 확인했고 공식 문서의 요금제 조건을 충족함. 운영 Auth 설정 활성화와 가입·변경 오류 처리 확인은 남음 |

E: `cleanup_expired_fittings`와 `increment_fitting_usage`의 anon·authenticated EXECUTE는 이번 운영 조회에서도 false다. 기존 PR469의 권한 회수는 유지된다. 두 함수의 search_path 경고는 해소된 것이 아니다.

E: anon·authenticated는 public·extensions 스키마 CREATE 권한이 없다. TEMP 권한은 있다. 이 사실만으로 mutable search_path가 안전하다고 단정하지 않는다.

공식 조치 안내: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [view 권한](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [확장 스키마](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [익명 함수 실행](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [회원 함수 실행](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [유출 비밀번호 차단](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 4. DB 엔진 업데이트 검토

S: Supabase의 [09-25 PostgreSQL 17.11 공지](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)는 17.6 이후 보안 수정과 호환성 확인 항목을 안내한다. 현재 프로젝트가 공지의 모든 취약점에 노출됐다고 단정하지 않는다.

E: 공식 opclass 기준 카탈로그 검사에서 ltree index·float GiST index·비내장 추정기를 쓰는 연산자는 각각 0개다. pgcrypto 1.3은 설치돼 있으나 public 함수 본문과 앱·공유 코드·migration 검색에서 PGP 암호화 호출은 발견하지 못했다. 과거 외부 적재 자료의 암호화 방식까지 증명한 결과는 아니다. 고객 암호문을 읽거나 잘못된 키 복호화 시험을 하지 않았다.

업데이트 제공 여부·백업·복구·점검 시간 확인 후 엔진 업데이트를 별도로 진행해야 한다. 이번 새 함수 배포에 엔진 업그레이드를 몰래 포함하지 않는다.

## 5. 출시 순서와 남은 조건

1. 변경 코드·새 SQL 실행 경로의 로컬 검증을 마치고 정확한 후보 commit을 고정한다.
2. W13의 실제 DB/Auth/Storage 원본 복원·삭제 이력 재반영과 전역 운영 변경 조건을 마감한다. 기존 합성 복원 PASS와 새 SQL ROLLBACK 시험으로 대체하지 않는다.
3. 새 DB 기능을 먼저 적용·독립 확인한 뒤, 같은 후보의 웹 배포와 실제 로그인·저장·초기화·오류 경보를 확인한다. 구버전 앱의 제한도 함께 확인한다.
4. 사용자가 지금 진행하기 어렵다고 한 iPhone 최종 확인은 미완료로 유지한다. Google·네이버 검색 등록은 사용자가 별도 계정으로 진행하기로 한 보류 상태를 유지한다.

근거: 저장소 `AGENTS.md`는 “운영 변경 전에 전역 web/API/Auth/public DB/Storage write fence, DB 백업, Storage 원본 백업, 복구 검증, rollback artifact를 먼저 확보한다”고 규정한다. 현재 원본 복원 완료 증거가 없으므로 배포 승인으로 해석하지 않는다. 새 복구 프로젝트 생성·PC 보안 설정 변경은 이번 작업에 포함하지 않았다.

## 6. 이번 추가 검증

- E: 구 native 대응의 웹 helper·세 실제 컴포넌트 59개, native bridge·실제 TSX 29개 통과. 웹·모바일 타입과 변경 파일 lint 통과.
- E: 최신 제품 변경을 포함한 로컬 Next 배포용 빌드는 2026-09-29 00:10:44 UTC에 exit 0으로 완료했다. 외부 네트워크를 차단한 합성 환경이며 `VERCEL_ENV`를 제거했다. 운영 배포·운영 승인 성공을 뜻하지 않는다.
- E: CI 신호·모바일 링크·화면 문구·제어문자 검사 20개 통과. 앞선 전체 검사 숫자에 중복 합산하지 않는다.
- E: 정상 환경에서 실제 production CLI에 새 apply 모드를 전달한 차단 시험은 `COUPLE_RESET_GLOBAL_RELEASE_GATES_REQUIRED`, exit 1로 끝났고 실행 receipt도 만들지 않았다. top-level의 기존 환경 안전 검사는 유지되며, 새 runtime은 source·receipt·transport 접근 전에 운영 변경 모드를 거절한다.
- E: 실제 로컬 PostgreSQL 17 시험 **21개 통과·실패/제외 0개**다. 계정·커플 불일치, 권한 거절, 동시 초기화, 행·기존 함수·원장 보존, 실패 원자 롤백을 포함한다. 새 배포 bundle의 SHARE 잠금이 기존 초기화의 잠금 승격과 교착하던 반례를 재현해 profiles EXCLUSIVE 선점으로 수정했다. 기존 요청은 정상 완료되고 뒤늦은 배포만 기준 상태 변경으로 거절되는 것을 확인했다.
- E: 독립 검수에서 일반 함수 소유자와 같은 열을 유지한 view 정의 변경이 보존 해시에 잡히지 않는 반례를 재현했다. 함수 소유자, view 정의·옵션을 해시에 포함하고 변경 전·후 거절과 롤백을 실제 PG17에서 확인했다. 위 21개에 포함되므로 중복 합산하지 않는다.
- E: 실행 흐름 시험 **11개 통과·실패/제외 0개**다. 잘못된 대상·인자·원장, 소스 변조, 기록 쓰기·fsync 실패, 시간 초과, commit 결과 미확정에서 재시도·성공 오표시가 없는지 검증했다. 실제 DB 시험과 별도로 주입한 합성 query/오류를 쓰며 운영 COMMIT 증거가 아니다.
- E: 최종 정적 계약 시험 **6개 통과·실패/제외 0개**다. 원문 해시, 기존 계약 승계, 누락·변조 거부, 미등록 SQL 차단을 확인했다. 신규 실행 흐름·native 시험·fixture와 기존 PGlite 시험의 네 소스를 계약에 고정했다. 루트 담당자의 마지막 정적 fence도 241개 SQL 검증을 통과했고 배포 미승인 상태를 유지했다.
- E: 최종 계약을 반영한 웹 배포 fence의 영향 구간 **2개 선택 실행 통과**다(`release1-web-fence-final.log`). 나머지 11개는 이번 선택 실행에서 제외했으며 영구 skip을 추가하지 않았다. 기존 전체 검사 이력과 이번 재실행 범위를 합쳐 전체를 다시 실행했다고 표시하지 않는다.
- E: 새 두 시험을 `test:repo`와 `supabase:release:test`에 모두 등록했고, 등록 누락·존재하지 않는 파일 검사를 포함한 3개가 통과했다. stage에 들어간 13개 참조 파일의 bytes도 계약 해시와 일치했다. 추가 줄의 제한된 자격증명 패턴 검색에서 일치는 없었으며 모든 종류의 비밀정보 부재를 보장하는 검사는 아니다.
- 위 DB 시험 로그는 `C:/Users/kcho1/.codex/visualizations/web-five-pass-20260928/release1-couple-reset-native-final.log`와 `release1-couple-reset-runtime.log`다. 앞선 실패 재현 로그도 같은 폴더에 보존했다.

운영 조회 증거: `C:/Users/kcho1/.codex/visualizations/web-release-prep-20260929/`의 `read-only-readiness.json`, `migration-ledger-metadata.json`, `reset-target-catalog.json`. 같은 폴더에 빌드·CLI 차단·소스 검사 로그를 보존했다. 기존 복원 미완료 근거는 `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/W13_HOST_READINESS.md`다. 원격 계정·키·고객 원문은 이 문서에 저장하지 않는다.
