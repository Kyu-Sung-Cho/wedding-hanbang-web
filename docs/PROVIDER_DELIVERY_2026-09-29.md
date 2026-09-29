# 제공자 참여 기능 보완과 검증 — 2026-09-29

## 현재 판정

후속 배포 감사에서도 운영 배포 보류다. 실제 production 빌드 사전 검사의 차단과
DB 미적용 상태에서 기존 계정 삭제에 미치는 영향을 확인했다.
[배포 판정과 남은 작업](operations/PROVIDER_PRODUCTION_READINESS_2026-09-29.md)을 현재 배포 판단에 우선한다.

개인·팀·업체 참여 신청, 관리자 승인, 승인 후 소개글·사진 직접 관리, 서비스 검토,
공개 탐색과 아모라 추천 연결을 구현했다. 이번 보완은 기존 구현의 누락·오류 복구와
운영 적용 준비에 집중했다. **운영 DB 적용과 웹 배포는 아직 하지 않았다.**

구현은 `codex/provider-participation`의 별도 worktree에 있다. 기준 원격 main은
`4216fddad09f8fbfd4ff75399adc6b9b36f2651f`, 직전 구현 커밋은 `83e8d82bb`다.
원래 작업 디렉터리에 있던 다른 수정은 옮기거나 되돌리지 않았다.

## 사용자에게 제공하는 흐름

후속 문구 보완: 모호한 ‘서비스·공간’ 메뉴를 ‘웨딩 서비스’로 정리하고, 등록 분야에는
‘예식·행사 장소’와 웨딩홀·레스토랑·갤러리 대관 예시를 표시한다. 등록/탐색 화면,
랜딩 링크, 모바일 진입 메뉴와 아모라의 분야 안내에도 같은 용어를 사용한다.
이 문구 변경은 웹 관련 43개·모바일 연결 1개 테스트, 웹 TypeScript와 변경 파일 ESLint를
통과했다. 로컬 개발 화면의 데스크톱 및 320px 너비에서 문구와 줄바꿈을 확인했다.
아래 대규모 테스트·프로덕션 빌드 집계는 문구 보완 전 `8560a28f` 기능 구현 시점의 기록이다.

- [용어 보완 후 데스크톱](evidence/provider-participation/business-terminology-desktop.png)
- [용어 보완 후 320px 화면](evidence/provider-participation/business-terminology-mobile.png)

| 대상 | 실제 동작 |
|---|---|
| 개인·팀·업체 | 같은 참여 신청 절차. 사진·영상·헤어/메이크업·꽃·진행·공간·케이터링 등을 등록 |
| 공간 운영자 | 레스토랑·갤러리 등을 공간 대관 분야로 신청하고 소개·사진·서비스 조건 작성 |
| 협업 문의자 | 서비스 등록과 별도로 비즈니스 문의 접수, 제공자 센터에서 답변 확인 |
| 한방 관리자 | 등록·관리권 승인/보완/반려, 서비스 가격·조건과 추천 자격 검토, 전체 노출 정지/복구 |
| 승인 제공자 | 소개글·사진 직접 저장. 최초 공개는 본인이 선택하고, 공개 후 수정은 바로 반영 |
| 서비스 제공자 | 서비스별 제공 중단. 이력은 보존하고 즉시 공개·추천 제외, 재제출 시 다시 검토 |
| 결혼 준비 사용자 | 전체 공개 자료에서 분야·지역·이름/소개 검색, 다음 결과 불러오기 |
| 모바일 사용자 | 내 프로필의 서비스·공간 찾기/참여 메뉴에서 외부 브라우저로 웹 기능 진입 |

등록 승인은 자동 공개나 자동 추천 승인이 아니다. 소개글·사진의 직접 편집과
서비스의 가격·포함 항목·추가 비용·이용 조건 검토는 구분한다. 개인·팀·업체의 형태와
광고·협업 여부를 일반 추천의 가산점으로 사용하지 않는다.

팀은 현재 대표 담당자 한 계정으로 관리한다. 팀원 초대·공동 편집, 결제·예약 확정,
실시간 예약 가능 일정, 자동 이메일 답변 발송은 이번 구현 범위에 없다.

## 이번에 바로잡은 결함

1. **검색 범위 누락:** 브라우저에 먼저 가져온 일부 목록을 필터링하던 방식 대신 DB에서
   조건을 먼저 적용하고 안정적인 UUID 커서로 다음 페이지를 조회한다. 아모라도 같은 방식으로
   이전 100개 범위 밖의 후보를 조회한다. 지역은 등록된 문자열 조건이며 지리적 서비스 가능 범위를 추정하지 않는다.
2. **오래된 심사 접수 누락:** 관리자 큐도 종류·상태 조건을 먼저 적용한다. 해당 페이지의
   신청/서비스가 참조하는 프로필을 함께 반환해 관리권과 공개 상태를 확인할 수 있다.
3. **본인 자료 누락:** 제공자 센터의 서비스·사진·문의 100개 제한을 제거했다.
   자기 계정 자료를 서버 소유권 검사 아래 모두 반환한다.
4. **소개 초안 소실:** 사진 저장/삭제 후 다른 편집기를 통째로 다시 만드는 동작을 없앴다.
   권한이 바뀌거나 조회가 실패하면 편집을 닫고, 저장하지 않은 소개가 있으면 먼저 저장하도록 안내한다.
5. **서비스 중단 누락:** 프로필 전체를 내리지 않고 개별 서비스 제공을 중단할 수 있다.
   정지된 제공자도 사진 삭제와 서비스 철회는 가능하다. 관리자는 철회 서비스를 승인할 수 없다.
6. **승인 분야와 입력값 불일치:** 사진 외 분야만 승인된 제공자에게 사진을 기본 선택하던
   문제를 수정했다. 승인된 분야만 선택하고, 기존 분야가 유효하지 않으면 명시적으로 다시 선택한다.
7. **비동기 화면 오류:** 검색·심사 큐의 늦은 응답, 중복 결과, 페이지 실패와 재시도,
   저장 버전 충돌을 처리한다. 사진 다운로드 도중 정지·철회·삭제 상태가 바뀌면 bytes 전달을 막는다.

## 검증의 범위

합성 계정과 로컬 DB만 사용했다. 실제 업체·고객 자료를 새로 만들지 않았다.
PGlite/native PostgreSQL 테스트는 SQL·RLS·동시 상태 변경·트랜잭션을 검증하며,
Supabase Auth/Storage 서비스 자체의 검증과 구분한다.

관련 명령:

```text
corepack pnpm --filter @hanbang/web test
corepack pnpm typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm --filter @hanbang/mobile test
corepack pnpm --filter @hanbang/shared test
corepack pnpm test:ingest
node --test scripts/tests/provider-participation-runtime.test.mjs scripts/tests/provider-participation-native-postgres.test.mjs
corepack pnpm supabase:provider:prepare --check
corepack pnpm supabase:provider:prepare --local-rehearsal
```

웹 빌드는 `createLocalQaWebBuildEnvironment`의 합성 환경으로
`scripts/build-web-safely.mjs`를 실행했다. 이 빌드 성공은 운영 배포를 뜻하지 않는다.
저장소 Node 테스트는 `package.json`의 `test:repo`에 등록된 동일 파일 전체를
`--test-concurrency=2`로 실행해 로컬 PG 프로세스와 메모리 사용을 제한한다.

확인한 결과:

| 검증 | 결과 |
|---|---|
| 최종 제공자·관리자·사진·인증·삭제·아모라 묶음 | 최종 수정 후 20개 파일 264개 통과, 이어 웹 TypeScript 통과 |
| 웹 전체 실행 | 1,135개 파일 중 1,133개 통과·2개 실패. 18,325개 통과·7개 실패·33개 expected fail, 1,506.58초 |
| 웹 전체에서 실패한 두 프롬프트 테스트 | 신규 탐색 활성 상태에도 옛 제목만 기대하던 전제를 수정. 관련 6개 파일 128개 재실행 통과, 앱 실행 코드 변경 없음 |
| 저장소 등록 Node 테스트 전체 실행 | 1,093개 중 1,077개 통과·16개 실패·skip 0, 1,447.81초 |
| 과거 240개 SQL 성공 검증 | 과거 코드 fixture로 분리하고 현재 243개 거절을 추가. 해당 2개 파일 19개 재실행 통과 |
| 계정 삭제 SDK 테스트 | 새 provider-portfolio 최종 스캔이 누락된 mock 수정. 해당 파일 8개 통과, Auth 삭제 전 스캔 순서도 검증 |
| 로컬 QA·CI 정적 검사 | 신규 243개 준비 검사에 연결. 관련 4개 파일 59개 및 CI 운영 차단 선택 회귀 1개 통과 |
| 제공자 DB runtime·native PG17 | 25개 통과, skip 0. 익명/소유자/타인/관리자, 검색·페이지·철회·사진·삭제·rollback 포함 |
| 신규 release 계약·native·SDK 안전장치·등록 검사 | 15개 통과, skip 0. 실제 Auth/Storage 통합 실행을 뜻하지 않음 |
| 모노레포 TypeScript | 웹·모바일·공유·디자인 토큰과 ingest 통과 |
| ESLint | 웹 오류 0·기존 경고 23, 모바일 오류·경고 0. 후속 수정한 프롬프트 테스트도 별도 통과 |
| 공유 패키지 | 134개 통과 |
| 모바일 | 1,398개 테스트 통과, 출시 준비 정적 검사 105개 통과, iOS·Android·웹 bundle export 성공 |
| 적재 스크립트 | 858개 통과·실패 0·기존 환경 의존 skip 4 |
| 웹 빌드 | 최종 앱 코드의 합성 로컬 QA 빌드 통과 |
| release 준비 CLI | --check와 --local-rehearsal 성공. 운영 적용/인가 false 유지 |

이 표는 최초 실행과 당시 수정 범위의 집계다. 이후 CI에서 발견한 줄바꿈 검증값과
fixture 의존성 누락도 수정했다. 최종 코드의 pre-push typecheck·lint·test 9개 작업은
성공했으며, 위 최초 집계를 새 단일 전체 실행의 테스트 개수로 사용하지 않는다.
정확한 commit에 대한 CI 결과와 후속 범위는 아래 후속 기록을 따른다.

## 실제 화면 확인

빌드한 앱의 참여 안내를 데스크톱·320px·390px에서 확인했다. 가로 넘침이 없고,
제공자 센터 진입은 로그인 후 돌아갈 `/provider` 경로를 유지한다. 합성 환경에서
DB 연결 실패는 빈 검색 결과로 꾸미지 않고 오류와 다시 불러오기로 안내한다.

- [데스크톱 화면](evidence/provider-participation/business-desktop.png)
- [모바일 화면](evidence/provider-participation/business-mobile.png)
- [320px 작은 모바일 화면](evidence/provider-participation/business-small-mobile.png)

인증한 제공자·관리자의 브라우저 전체 흐름과 실제 기기에서의 모바일 동작은 아직
검증하지 않았다. 해당 화면의 로컬 컴포넌트 테스트와 실제 로그인 검증을 혼동하지 않는다.

## 운영 반영 전에 남은 일

새 배포 준비 계약은 243개 SQL과 Storage 정책·실행 코드 해시를 고정한다.
로컬 PG17에서 정확한 사후조건, 비대상 자원·기존 합성 행 보존, 전체 rollback과
마지막 단계 실패 rollback을 검사한다. 준비 CLI는 운영 적용 기능이 없다.
로컬 QA와 CI의 정적 준비 단계도 이 새 계약을 실행한다. 기존 운영 apply 및 과거 계약은
확장하지 않았고, 새 계약의 성공 결과도 releaseAuthorized=false를 반환한다.

현재 PC에는 전체 로컬 Supabase 스택을 위한 Docker/Podman/WSL이 없다.
이후 GitHub Actions의 빈 로컬 Supabase 스택에서 실제 Auth·Storage SDK 검증을 통과했다.
검증 commit과 실행 링크는 아래 후속 기록과 SDK 검증 문서에 있다.
Next HTTP·브라우저 검증용 hosted 테스트 브랜치의 비용·대상 승인은
확정되지 않아 원격 환경을 새로 만들지 않았다.

운영 반영에는 승인된 격리 환경에서의 Auth/Storage·브라우저 검증, 실제 Storage 정책
권한, 전역 쓰기 중단, DB와 Storage 원본 bytes 백업·복원 증거, 운영 책임자와
최종 적용 컨트롤러가 필요하다. 저장소의 운영 규칙을 우회하지 않았다.

2026-09-29 KST 운영 프로젝트의 read-only 조회에서는 제공자 테이블·검색 함수·
버킷·Storage fence가 없고 신규 제공자 migration 적용 수는 0이었다. 운영 ledger는 229개,
로컬 계약은 243개이며 버전 집합에 차이가 있다. 파일 수만 맞추거나 신규 SQL 세 개만
바로 넣는 것으로 해결하지 않는다. 이는 DDL 원문·catalog 전체 동등성 검증이 아닌
존재 여부와 버전 metadata의 관찰이며, 실제 적용 전에 현재 baseline부터 대조해야 한다.

자세한 실행 순서와 검증되지 않은 범위:

- [릴리스 준비 및 운영 게이트](operations/PROVIDER_PARTICIPATION_RELEASE_PREPARATION_2026-09-29.md)
- [실제 로컬 Auth·Storage SDK 검증 준비](PROVIDER_LOCAL_SDK_QA_2026-09-29.md)
- [DB 계약](PROVIDER_DATABASE_CONTRACT_2026-09-28.md)
- [이전 구현과 검증 기록](PROVIDER_DELIVERY_2026-09-28.md)
# 배포 선행 작업 후속 기록

사용자의 “뭘 더해야 하는지 보고 진행하자” 요청에 따른 후속 구현은
[운영 준비 보완 기록](operations/PROVIDER_READINESS_FOLLOWUP_2026-09-29.md)에 정리했다.
243개 계약을 production 빌드에 등록했고, 제공자 운영 증거가 없는 후보는 별도 검사로 계속 차단한다.
운영 catalog 읽기 전용 검사와 빈 실제 Supabase 스택의 Auth·Storage CI 실행 경로를 추가했다.
`b69d8413845478fb8a30ac669eadf66a1a2ceb0c`의
[실제 통합 CI](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/36538633277)가 통과했다.
승인 후 소개 수정·사진 파일 왕복·공개 철회·정리 worker 실패 재시도·Auth 삭제 및 합성 리소스 정리를 확인했다.
같은 commit의 [전체 코드 CI](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/36538633364)도
웹 테스트 네 shard·웹 빌드·모바일·저장소·정적 release 계약까지 성공했다.
이는 운영 적용이나 배포 완료를 의미하지 않는다.
