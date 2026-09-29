# 제공자 참여 기능 운영 배포 판정 — 2026-09-29

**판정: 현재 후보는 운영 배포 보류.** 디자인 보완이나 단순 Vercel 재배포로 해결되지 않는다.
사용자의 “배포할 만하면 배포하고, 아니면 무엇이 더 필요한지 확인” 요청에 따라
코드·원격 main·운영 DB metadata·실제 production 배포를 다시 확인했다.

## 이번에 직접 확인한 상태

- 후보 앱 코드: `03636e74647a0fee1e96bd889ebd4308e84caff8`, 감사 시작 시 clean checkout.
- fetch 후 원격 main: `4216fddad09f8fbfd4ff75399adc6b9b36f2651f`.
- 이 후보 브랜치 `codex/provider-participation`의 PR은 없다. 해당 후보의 원격 CI 결과도 없다.
- Vercel production `dpl_BcP6JGq6iRihwkiEsv8jYXeGYhGB`는 READY이며 위 main commit과
  `hanbang.ai`·`www.hanbang.ai` alias를 확인했다. 이번 후보 배포 성공을 의미하지 않는다.
- 운영 Supabase `slrtobkksjmxgzatjyqb`를 read-only로 조회했다. migration ledger 229개,
  `provider_profiles`·`provider_search_catalog`·`provider-portfolio`·Storage restrictive 정책은
  모두 없고 제공자 migration 적용 수는 0이다. 고객 행이나 사진 bytes는 읽지 않았다.
- 정적 준비 CLI 재실행: 243개 계약 검증 성공,
  `productionApplyImplemented=false`, `runtimeEvidenceVerified=false`, `releaseAuthorized=false`.
- 실제 production 빌드의 사전 검사 함수를 로컬에서 `VERCEL_ENV=production` 인자로
  실행했다. `VENDOR_DISCLOSURE_STATIC_RELEASE_CONTRACT_INVALID` / `FOLLOWUP_RELEASE_INVALID`로
  차단됐다. 이 검사는 원격 호출 없이 파일만 읽었다. 전체 production build나 deploy를 실행한 것은 아니다.
- 기존 개발 브랜치 하나는 운영 데이터 복제본이고 다른 하나는 다른 목적의 복원 검증 대상이며
  `MIGRATIONS_FAILED` 상태다. 제공자 합성 QA 대상으로 재사용하지 않았다.
- 이 PC에서 Docker·Podman 명령은 없고 WSL 배포판 조회도 미설치 오류로 종료됐다.

관찰은 2026-09-29 KST 이번 감사 시점의 상태다. apply 직전에는 다시 확인해야 한다.

## 웹만 먼저 올리면 생기는 문제

공용 계정 삭제 로직의 `inventoryCommunityDeletionMedia`는 모든 사용자에 대해
`inventoryProviderPortfolioMedia`를 호출한다. 이 함수는 `provider_profiles`와
`provider-portfolio`를 조회하고, 테이블 부재도 `provider_inventory_unavailable`로 처리한다.
따라서 삭제 절차가 실행되면 제공자 기능을 쓰지 않은 기존 사용자도 삭제가 재시도 상태에
머물 수 있다. 최종 Storage 스캔에도 새 버킷이 포함된다.

이는 코드와 운영 리소스 부재를 결합한 판단이다. 운영에서 실제 탈퇴 요청을 생성해
장애를 재현하지 않았다. UI 링크를 숨기거나 신규 API의 503을 허용해도 이 의존성은 남는다.

근거: `apps/web/src/lib/accountDeletion/communityStorageSaga.ts`의 제공자 inventory,
공용 inventory 병렬 호출, `AUTOMATIC_DELETION_BUCKETS` 최종 스캔 및 retry 처리.
제공자 전용 배포 스위치는 없으며 AI 도구와 사진 정리 cron도 신규 기능에 연결되어 있다.

## 배포 전에 필요한 작업과 완료 기준

| 순서 | 필요한 작업 | 완료로 인정할 증거 |
|---|---|---|
| 1 | 운영 기준선 대조 | 현재 ledger·함수 원문·제약·ACL·Storage 정책에서 이번 번들이 요구하는 선행 상태를 확인. 로컬 243개와 운영 229개 차이를 설명하는 기록 |
| 2 | 제공자 범위의 운영 적용 절차 완성 | 기존 apply 경로에 새 계약·원자적 적용·사후 검사·실패 복구를 연결하고 production 빌드가 해당 계약을 검증하도록 구현. static check만 통과시키는 허용 예외는 금지 |
| 3 | 격리 환경에서 실제 통합 검증 | 신청→관리자 승인→소개/사진 공개, 타인 접근 거부, 정지/철회 후 기존 사진 URL 차단, 파일 삭제·재시도·Auth 삭제를 실제 Auth/Storage/Next 경로로 확인 |
| 4 | 복구와 운영 전환 준비 | 적용 범위에 맞는 검토된 write fence·진행 중 작업 정리·백업/복원·운영 담당자·실패 복구 증거 확보 |
| 5 | 검증한 후보의 배포 | PR과 같은 commit의 필수 CI, DB·Storage 적용과 사후 확인, 웹 배포, 실서비스 확인 순으로 진행 |

1·2는 추가 엔지니어링 작업이다. 테스트 환경 선택만으로 배포 준비가 완료되지는 않는다.
3은 기존 로컬 SDK runner가 있어도 실제 서비스 실행 증거가 필요하며, 그 runner 밖의
Next HTTP·브라우저·35분 대기 계정 삭제 worker 흐름도 별도로 검사해야 한다.

로컬에만 있는 과거 SQL을 모두 적용하거나 ledger 숫자를 맞추는 것이 1의 해법은 아니다.
이름/버전 차이는 실제 기능 누락이나 schema 불일치와 동일하지 않다.

## 적용 범위에 대한 판단

현재 [AGENTS.md](../../AGENTS.md)의 운영 규칙은 “현재 릴리스 manifest와 컨트롤러가
허용한 `supabase:release:apply` 경로만 사용한다”, “운영 변경 전에 전역
web/API/Auth/public DB/Storage write fence, DB 백업, Storage 원본 백업, 복구 검증,
rollback artifact를 먼저 확보한다”고 명시한다. 아직 제공자 기능에 대한 별도 예외는 없다.

이번 변경은 새 테이블 외에 공용 삭제 manifest의 제약·함수와 Storage 정책도 바꾼다.
공용 삭제 worker 및 업로드와의 동시 실행 통제는 실제 필요하다. 다만 신규 버킷이 비어 있고
기존 파일을 이동·삭제하지 않는다는 점에서 전체 사이트 중단과 전체 파일 재백업의 범위를
좁힐 여지는 있다. 적용 대상과 비대상 보존을 검증하는 별도 절차로 검토해야 하며,
기존 규칙이나 production 검사를 임의로 끄지 않는다.

Supabase의 DB 백업은 Storage 원본 파일을 포함하지 않는다.
[공식 백업 문서](https://supabase.com/docs/guides/platform/backups)의 구분에 따라
DB 복원 성공만으로 사진 복구를 완료했다고 판정하지 않는다.

배포 스킬 [land-and-deploy](C:/Users/kcho1/.agents/skills/land-and-deploy/SKILL.md)의
Step 1에도 “If no PR exists: **STOP.**”이 있다. 이번 요청은 배포 불가 시 부족한 일을
확인하는 범위를 포함하므로, 운영 변경 없이 현재 판정과 필요한 작업을 정리했다.
PR만 만들거나 빌드 검사를 우회해도 위 DB·Storage 의존성과 미검증 경계는 해결되지 않는다.

## 이번 감사에서 실행하지 않은 작업

운영 DB 쓰기, migration 적용, 유료 테스트 브랜치 생성, 실제 고객 데이터 다운로드,
운영 탈퇴 요청, Git push/PR/merge, Vercel 배포는 하지 않았다. 이전 테스트·빌드 통과 기록은
[구현 검증 기록](../PROVIDER_DELIVERY_2026-09-29.md)에 있으며 이번 원격 CI 성공으로 해석하지 않는다.

다음 시작점은 운영 기준선 대조와 격리 테스트 환경 확보다. 새 Supabase 브랜치는 조직 선택과
비용 확인이 필요하며, 기존 비용 확인 질문에는 아직 선택이 없다. 로컬 경로라면 Docker
호환 런타임 준비가 먼저다. 테스트 대상이 정해진 뒤 같은 후보의 실제 증거를 축적한다.
