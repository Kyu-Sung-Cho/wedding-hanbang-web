# 기존 피팅 함수 두 개의 실행 권한 제한

상태: **운영 적용 전 검증 문서.** 코드·로컬 테스트를 운영 완료로 간주하지 않는다.
W12 승인 합성 탈퇴 검증은 [별도 마감 기록](../docs/operations/W12_SYNTHETIC_SUPPORT_CLOSEOUT_2026-09-28.md)에 있다.
적용 후 결과는 `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/fitting-acl/`의
독립 영수증과 `PRODUCTION_VERIFICATION.md`에 별도로 기록한다. 이 문서는 적용 전 실행 계약이다.

## 문제와 선택

2026-09-28 읽기 전용 운영 catalog에서 다음 두 함수가 postgres 소유
`SECURITY DEFINER`이며 PUBLIC·anon·authenticated·service_role 모두 실행 가능한 상태를 확인했다.
본문에는 호출자 또는 대상 커플 소유권 검사가 없다.

| 정확한 함수 | 운영 정의 UTF-8 SHA-256 |
|---|---|
| `public.cleanup_expired_fittings()` | `c4eb796a6da0f0c1e1f3cdf3abc1e6138b388a3f78726ead302583b7088356aa` |
| `public.increment_fitting_usage(uuid,date)` | `9b17d7a47a88cfcbbc1100416e37abddf60b43c10562ca158a424428e6c8df03` |

근거 파일은 `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/fitting-advisor-catalog-review.json`이고
SHA-256은 `249f432ba87db63d9da05065c203289fe46b9eeb1b577ab66f5e1d0c74e7f1fb`다.
실제 고객 행을 조회·변경하거나 해당 함수를 호출해서 악용 가능성을 시험한 기록은 아니다.
현재 apps/packages/migrations/docs 검색에는 호출이 없지만 모든 과거 배포 클라이언트의 호환성을 증명하지 않는다.

세 선택지를 검토했다. 현 상태 유지는 확인된 권한 결함을 남긴다. 함수 삭제·본문 재작성은
기존 서버 실행 동작까지 바꾼다. 이번에는 **정확한 두 함수의 PUBLIC·anon·authenticated
EXECUTE만 회수**하여 노출을 닫고 postgres·service_role의 권한과 본문을 보존한다.
Supabase 공식 [함수 권한 안내](https://supabase.com/docs/guides/database/functions#function-privileges)와
[익명 SECURITY DEFINER 경고](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)를 확인했다.

## 고정 범위

- 프로젝트 `slrtobkksjmxgzatjyqb`, database `postgres`, PostgreSQL 17,
  system identifier `7581440907192989109`만 허용한다.
- 같은 이름의 overload까지 정확히 두 개여야 한다. 정의 SHA·소유자·SECURITY DEFINER·
  NULL 설정·정규화한 명시 ACL·역할별 실제 EXECUTE 권한을 함께 검사한다.
- 함수 본문·설정·테이블 행·Auth·Storage·기본 권한·migration ledger를 변경하지 않는다.
  기본 권한과 ledger의 hash/행 수는 트랜잭션 전후 및 독립 조회에서 대조한다.
- 임의 SQL·대상 URL·다른 프로젝트·혼합 모드·중복 인수·`--rollback`은 받지 않는다.
  일반 DB migration 릴리스와 W13 원본 복원 게이트의 범위를 넓히지 않는다.
- 기존 함수의 고정되지 않은 `search_path`는 이번 범위에서 유지된다. 따라서 그 경고의
  해소나 프로젝트 전체의 보안 완료를 주장하지 않는다. 추후 본문/설정 변경은 별도 검토한다.

## 실행 계약

등록된 명령은 `corepack pnpm supabase:release:apply`이며 새 범위 선택자는
`--legacy-fitting-acl`이다. 계약 JSON은 함수와 고정 SQL 템플릿을 pin하고 런타임은
계약 파일의 SHA를 pin한다. 런타임 실제 SHA는 영수증에 기록하며 **깨끗한 정확한
commit** 검사로 실행 소스와 결합한다. JSON이 자신을 검사하는 런타임 SHA까지
서로 순환 참조한다고 주장하지 않는다.

환경의 기존 `SUPABASE_ACCESS_TOKEN`은 프로세스로만 전달한다. 콘솔·Git·영수증에
출력하지 않는다. 공식 Management API 주소가 코드에 고정되며 redirect·자동 retry가 없다.
관측도 관리 연결의 `read_only:false`로 보내지만 SQL은 `BEGIN READ ONLY`로 감싸고
실제 transaction read-only 상태를 검사한다. [공식 API 계약](https://supabase.com/docs/reference/api/v1-run-a-query).

모든 모드는 정확한 commit과 아래 확인 문자열을 요구한다. 영수증은 저장소 밖의
존재하지 않는 절대 경로여야 한다. 기존 파일 덮어쓰기·심볼릭 링크 경로를 거절한다.

```powershell
corepack pnpm supabase:release:apply --legacy-fitting-acl --inspect --expected-commit=<40자리-검증-commit> --project-ref=slrtobkksjmxgzatjyqb --receipt-out=<새-절대경로.jsonl> --confirm-production=legacy-fitting-acl-20260928:slrtobkksjmxgzatjyqb:inspect:<같은-commit>
```

`rehearse`나 `apply`도 모드와 확인 문자열의 모드를 함께 바꾼다.

1. 사전 catalog와 정확한 소스를 검증하고 영수증을 CreateNew·fsync로 남긴다.
2. `apply`는 먼저 같은 권한 변경 SQL을 ROLLBACK으로 예행하고 별도 관측으로 원복을 확인한다.
3. 소스와 계약을 다시 검사한 뒤 같은 사전·사후 조건을 가진 COMMIT 묶음을 한 요청으로 보낸다.
4. 별도 관측으로 두 함수의 anon/authenticated EXECUTE false, postgres/service_role true,
   동일 정의·설정·기본 권한·ledger를 확인한다. 별도 CLI `inspect`로도 다시 확인한다.
5. 적용 이후 Supabase advisors를 조회하여 이 두 함수의 공개 실행 경고 변화를 기록한다.

잠금 제한 5초·SQL 문장 제한 30초·HTTP 제한 45초·사전 관측 유효기간 120초다.
영수증 기록 실패나 응답 손실은 완료로 처리하지 않는다. 변경 요청을 보낸 뒤 불확실하면
**재전송하지 않고 새 읽기 전용 inspect로 결과부터 확인**한다. 이미 제한된 정확한 상태이면
변경 없이 `already-restricted-verified`를 반환한다.

COMMIT 뒤 실행 권한을 다시 여는 자동 복구는 없다. 보안 경계를 다시 열어야 하는 장애라면
원인과 영향을 검토한 별도 결정을 남겨야 한다. 이번 ACL 변경에 전체 DB/Auth/Storage 복원을
선행시키지는 않지만, **정식 웹 출시의 W13 원본 복원 조건은 그대로 남는다.**

## 검증과 한계

관련 시험은 `test:repo` 및 `supabase:release:test`에 등록한다.

```powershell
node --test scripts/tests/legacy-fitting-acl-release.test.mjs scripts/tests/legacy-fitting-acl-native.test.mjs scripts/tests/legacy-fitting-acl-controller.test.mjs
```

네이티브 PostgreSQL 17 합성 시험은 운영과 같은 함수 정의·역할을 구성하고 실제 생성 SQL을
실행한다. 운영 system identifier 그대로의 SQL은 로컬에서 거절됨을 먼저 검증한다.
실행 동작 시험에서는 **system identifier 리터럴 한 개만 로컬 값으로 치환**하며 나머지
묶음은 보존한다. 이를 운영 실행으로 주장하지 않는다. 익명/회원 권한 거절, 서버 권한 유지,
ROLLBACK, ACL·본문·상속 권한 변조 거절 및 권한 변경 중 합성 행 보존을 검증한다.

운영에서는 고객 자료를 수정하는 서비스 역할의 함수 실행 시험을 하지 않는다.
권한 제한의 운영 성공은 영수증과 독립 관측이 모두 있어야 기록한다. 전체 고객 기능,
과거 앱 호환성, W13 복원, W15 실기기, 검색 소유권 및 정식 출시 승인을 대체하지 않는다.
