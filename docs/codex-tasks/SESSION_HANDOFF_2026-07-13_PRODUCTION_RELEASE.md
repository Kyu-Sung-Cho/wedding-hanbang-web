# 2026-07-13 운영 출시 인계

## 현재 결론

- 운영 배포는 아직 **NO-GO**다. CI나 운영 안전장치를 우회하지 않는다.
- 작업 브랜치는 `agent/amora-openai-gpt56`, PR은 `#38`이다.
- 이 문서 작성 직전 코드 후보 HEAD는 `ebcc17507ab98a3c8175d8cb60c298f5be0c789f`였다. 이 문서를 추가한 커밋부터는 exact-SHA 검증과 모바일 빌드 증거를 다시 만들어야 한다.
- 로컬에 있던 제품 코드와 기존 문서는 모두 원격 브랜치에 올라가 있었고, 원격 브랜치 누락 감사에서도 추가 통합이 필요한 제품 커밋은 발견되지 않았다.
- 병합, Vercel 운영 배포, alias 승격, 운영 DB 변경, 카나리는 수행하지 않았다.

## 이번 세션에서 실제로 변경한 외부 상태

2026-07-12T22:45:43Z에 Supabase 운영 프로젝트 `slrtobkksjmxgzatjyqb`의 Kakao Auth 공급자를 `Enabled`에서 `Disabled`로 변경했다. 저장 뒤 공급자 목록을 다시 읽어 `Kakao Disabled`를 확인했다.

이 조치는 현재 웹의 `NEXT_PUBLIC_OAUTH_KAKAO_ENABLED=false` 및 모바일 로그인 화면의 비활성 카카오 버튼과 일치한다. 따라서 현재 노출된 소비자 기능을 제거한 것이 아니라, 사용자에게 제공되지 않는 hosted OAuth 경로를 서버 측에서도 닫은 containment다.

키 값, Client Secret, fingerprint, digest는 이 문서와 Git 커밋에 기록하지 않는다. Supabase 설정에서 사용되던 Kakao REST 자격증명과 Client Secret은 모두 노출된 것으로 간주해 교체해야 한다.

## Kakao 대응 현황

- 전체 Git 이력 검사는 과거 `docs/DEVELOPMENT_PLAN.md`에 들어갔다가 제거된 Kakao REST API, Native app, JavaScript 형태 값 3개를 계속 검출한다.
- 도입 커밋은 `9732e40fc90fa3ee10ac5af03a9151743ccecb01`, 제거 커밋은 `682ab2c6cc580ffc7b80e119e638ecb421481830`이다. 삭제 diff에도 값이 포함되므로 두 커밋 모두 검사 대상이다.
- Kakao Developers에 로그인해 확인한 현재 계정은 앱 목록이 0개였다. 과거 키를 발급한 기존 웨딩한방 앱 소유 계정이 아니므로 이 계정에서 회전·삭제할 수 없다.
- 새 Kakao 앱은 생성하지 않았다.
- 기존 앱 소유 계정에서 REST API, Native app, JavaScript 키와 현재 Supabase 연결에 사용된 Client Secret을 교체·삭제해야 한다.
- 교체 뒤에는 구 키 요청 실패, 허용 도메인·패키지·키 해시·IP 제한, 노출 기간 사용 로그를 값 없이 확인해야 한다.
- 공급자 폐기 증거가 생기기 전에는 secret scanner 예외를 추가하지 않는다.

### 공급자 회전 뒤 권장 Git 처리

현재는 전 저장소 이력 재작성보다 `history 전용 exact-digest revoked-key allowlist`가 영향이 작다. 단, 아래 조건을 모두 만족해야 한다.

1. Kakao에서 구 키가 실제 삭제됐고 더 이상 인증되지 않는다.
2. 예외는 `Kakao platform key` 카테고리와 history patch에만 적용한다.
3. 같은 값이 working tree에 다시 나타나면 계속 실패한다.
4. 값과 digest를 로그·문서·fixture에 출력하지 않는다.
5. 한 글자 다른 값과 새로운 Kakao 키는 history에서도 계속 실패한다.
6. 임시 저장소 add/remove 이력, HEAD 재도입, 실제 전체 이력, PR merge-ref를 모두 회귀 테스트한다.

법무·계약상 이력 자체 삭제가 필요하면 allowlist를 사용하지 않고, 모든 브랜치·태그·PR·clone·GitHub Support를 포함한 별도 coordinated rewrite를 승인받아야 한다. force-push는 별도 승인 없이 수행하지 않는다.

## GitHub와 CI 상태

- PR: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/38`
- 상태: `OPEN`, `DRAFT`, `UNSTABLE`
- Secret history gate: `FAILURE`
- Windows reviewed launcher contract: `SUCCESS`
- Node 24 Quality Gate: 앞선 실패 때문에 `SKIPPED`

과거에 완료된 로컬 증거는 launcher 8/8, write-fence 33/33, recovery 49/49, Windows recovery subset 4/4, 변경 웹 계약 60/60, 전체 웹 1105 tests, typecheck, lint, production build다. 이 문서 커밋으로 HEAD가 바뀌므로 새 final SHA에서 CI와 SHA-bound release inventory를 다시 확인한다.

## Vercel 상태와 필요한 구조

- 프로젝트: team `hanbang`, project `wedding-hanbang-web`, root `apps/web`
- Git 자동 배포: 비활성
- Deploy Hook: 없음
- 코드 후보 HEAD와 정확히 일치하는 Vercel deployment: 없음
- 현재 Production은 `main`의 과거 SHA를 사용한다.

자동 배포를 단순히 다시 켜지 않는다. 앱 저장소에는 Vercel 운영 token을 넣지 않고, 별도의 보호된 `release-control` 저장소가 exact merged SHA를 검증해 staged Production deployment를 만든 뒤 같은 immutable deployment ID만 promote해야 한다.

현재 GitHub private 저장소 요금제에서는 필요한 environment reviewer와 branch protection을 강제하기 어렵다. 다음 중 하나를 사용자가 선택해야 한다.

1. secret 없는 controller 코드는 public 저장소에 두고 보호 environment와 별도 reviewer를 사용한다.
2. private 저장소 보호 기능을 제공하는 GitHub 플랜을 사용한다.

controller에는 별도 최소권한 Vercel automation token, automation bypass secret, private 앱 저장소 read-only GitHub App 자격증명이 필요하다. 이 자격증명을 앱 저장소나 문서에 복사하지 않는다.

## Supabase DB, 백업, 복구 상태

- Supabase CLI `2.106.0`은 저장소 dependency로 설치돼 있고 운영 프로젝트 연결과 프로젝트 조회가 가능하다.
- write fence, migration, recovery entrypoint는 현재 의도적으로 Plan-only hard stop이다.
- `backupPolicy.status=not_configured`, restore project ref 0개, `age` recipient 0개, RPO/RTO/retention 미정 상태다.
- 실제 운영 backup export, restore, migration, fence activation은 수행하지 않았다.

Plan-only를 해제하려면 통합 release controller, provider-side advisory lock/CAS, exact-target migration ledger, Data API/Auth/Storage write-denial probe, signed recovery receipt, 암호화 백업, 실제 DB·Storage restore, cron 비활성 복원, parity 및 RPO/RTO 측정이 필요하다. 먼저 별도 disposable source/restore Supabase 프로젝트에서 현재 migration 전체와 중간 장애 복구를 리허설해야 한다.

사용자 결정이 필요한 항목은 disposable 프로젝트 생성 비용 승인, RPO, RTO, 보관 기간, `age` 공개 recipient, KMS/서명 보관 방식, 고정 egress release runner, maintenance 시간이다.

## 다음 컴퓨터에서 이어가는 순서

```bash
git fetch origin
git switch agent/amora-openai-gpt56
git pull --ff-only
git status --short --branch
gh pr view 38 --json state,isDraft,mergeStateStatus,headRefOid,statusCheckRollup
```

이어갈 작업은 다음 순서다.

1. Kakao Developers에서 기존 웨딩한방 앱을 소유한 계정으로 로그인한다.
2. REST API, Native app, JavaScript 키와 Client Secret을 교체하고 구 자격증명을 삭제한다.
3. Supabase Kakao 공급자는 실제 기기 OAuth 검증 전까지 `Disabled`로 유지한다.
4. 구 키 거부와 사용 로그 검토가 끝나면 history-only revoked-key allowlist와 회귀 테스트를 구현한다.
5. exact final SHA의 전체 CI를 통과시킨다.
6. 보호된 release controller 선택과 자격증명 전달 방식을 결정한다.
7. disposable Supabase 프로젝트에서 backup/restore/write-fence/migration 복구 리허설을 완료한다.
8. 모든 운영 gate가 초록일 때만 PR을 ready로 바꾸고 merge한다.
9. exact post-merge SHA를 staged deploy하고, identity·환경·DB 계약을 검증한 같은 deployment만 promote한다.
10. `hanbang.ai`에서 apex alias, health SHA, Supabase ref, 콘솔 오류, 주요 사용자 여정을 canary한다.

## 절대 하지 말 것

- Kakao 구 키 폐기 확인 전 scanner allowlist 추가
- secret gate나 skipped Quality Gate를 무시한 병합
- force-push 또는 독단적인 전체 이력 재작성
- Git 자동 배포 재활성화
- 앱 저장소 workflow에 Vercel/Supabase 운영 자격증명 저장
- 평문 DB 백업 생성
- 검증되지 않은 restore project에서 복구 연습
- local Vercel CLI 출력을 production proof로 승격
- backup·rollback 없이 운영 DB write 수행

관련 상세 문서는 `docs/codex-tasks/FULL_QA_2026-07-12.md`, `docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`, `docs/SUPABASE_REMOTE_OPERATIONS.md`, `docs/SUPABASE_RECOVERY_ARTIFACT_CONTRACT.md`다.
