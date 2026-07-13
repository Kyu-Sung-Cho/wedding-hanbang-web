# 운영 출시·롤백 runbook

이 문서는 `hanbang.ai`, 운영 Supabase, EAS 모바일 빌드를 함께 출시할 때의 실행 기준이다. GitHub CI나 Vercel 빌드가 초록색이라는 이유만으로 운영 준비가 끝났다고 판단하지 않는다.

## 불변 규칙

`apps/web/vercel.json`은 모든 Git push/PR의 자동 Vercel 배포를 차단한다. 과거 Kakao 키가 회전·폐기되고 전체 이력 처리가 승인되기 전에 build dependency가 저장소를 실행하거나 환경 변수를 읽지 못하게 하며, `main` 병합이 DB gate보다 먼저 production 코드를 공개하지 못하게 하는 안전장치다. 이 설정을 다시 켜는 변경은 Kakao 회전 증거와 출시 안전 검토 없이 병합하지 않는다. 모든 Production-target deployment는 별도의 보호된 trusted controller가 exact SHA로 먼저 staged한 뒤 identity와 환경 계약을 확인하고 같은 deployment ID만 명시적으로 promote한다. 로컬 CLI는 이 증거를 생산하지 않는다. DB 변경 전에는 `coming_soon` rollback anchor와 maintenance deployment만 promote할 수 있고, 일반 서비스 deployment는 backup/write fence/migration/post-contract가 모두 통과한 뒤에만 promote한다.

- 운영 Supabase ref는 `scripts/release-targets.json`의 보호 목록과 실행 인수가 모두 같아야 한다.
- `productionDatabaseWriteFence`는 실제 웹·모바일의 DB/Storage 직접 쓰기 차단을 자동 probe로 입증하기 전에는 `not_configured`를 유지한다. 형식적으로 `verified-v1`로 바꾸지 않는다.
- 운영에서는 원시 `supabase db push`, `migration repair`, `db reset --linked`, `--include-all`, SQL Editor 수동 이어붙이기를 사용하지 않는다.
- backup/restore와 Storage 객체 복구를 각각 검증한다. Supabase DB backup은 Storage 실제 객체를 포함하지 않는다.
- DB 변경 전부터 최종 canary가 끝날 때까지 정확한 Git SHA, migration 목록과 backup/recovery point가 바뀌지 않아야 한다. Anchor와 maintenance ID는 DB 변경 전에, normal ID는 fence 해제 전에 staged·검증·기록한다. Vercel alias는 아래 순서에 따라 기록된 ID로만 이동할 수 있으며, 예상하지 않은 새 deployment나 재빌드가 생기면 중단한다.
- 사용자 데이터의 삭제·가명화·소유권 변경은 수량만 맞는다고 자동 승인하지 않는다. 제품·개인정보 책임자의 명시적 결정을 release evidence에 남긴다.
- 현재 운영 `ship`과 baseline reconcile은 fence snapshot·자동 black-box evidence가 한 lifecycle로 연결되기 전까지 코드에서 의도적으로 중단된다. fuse 문자열만 바꿔 우회할 수 없다.
- Vercel project 원문 JSON은 출력하거나 evidence에 붙이지 않는다. `protectionBypass`는 실제 automation 비밀을 JSON key로 반환할 수 있으므로 key 열거도 금지하고, `automationBypassConfigured` boolean과 개수만 메모리에서 산출한다.

## GO 조건

아래 항목은 최종 production GO 조건이다. 병합 전에는 0-C의 candidate-bound 선행·리허설 증거가 모두 필요하고, 병합 후에는 새 release SHA로 아래 항목 전체를 다시 고정한다. 어느 단계에서든 필요한 항목이 실패하거나 확인할 수 없으면 다음 단계(병합 또는 운영 DB 변경)로 진행하지 않는다.

1. PR HEAD와 원격 branch가 같고 worktree가 clean이다.
2. exact SHA의 CI, 타입, 테스트, lint, build, production dependency audit가 통과했다.
3. PR은 Draft가 아니고 최신 변경을 본 독립 리뷰가 있다.
4. Vercel production 환경 변수의 **이름·적용 대상·최종 수정 시각**을 확인했다. 값은 로그나 문서에 출력하지 않는다.
5. exact SHA의 maintenance deployment가 `MAINTENANCE_MODE=true`로 응답하고 health endpoint가 같은 Supabase ref와 전체 40자 SHA를 반환한다.
6. 웹 maintenance를 우회하는 기존 모바일·오래 열린 브라우저의 Data API/Auth/Storage 쓰기가 실제 black-box probe에서 거부된다.
7. production preflight의 hard blocker가 모두 0이고 rewrite/delete inventory가 승인된 수량과 같다.
8. migration history가 local의 연속 prefix다. core baseline history만 누락됐고 catalog가 exact일 때만 전용 reconcile 절차를 먼저 사용한다.
9. maintenance/write drain 뒤의 복구 지점이 존재하고, 같은 종류의 restore를 별도 프로젝트에서 연습해 RPO·RTO·검증 결과를 기록했다.
10. 마지막 배포 모바일과 새 모바일의 expand 호환 여정을 staging에서 모두 통과했다.
11. signed iOS Team ID와 Play App Signing fingerprint가 확정됐고, association JSON·웹 fallback·실기기 deep link가 같은 exact SHA에서 통과했다.
12. 현재 과거 production deployment는 `coming_soon` 서버 gate를 포함하지 않으므로 rollback target으로 승인하지 않는다. DB 변경 전에 공개 allowlist만 여는 launch-gate 호환 deployment를 별도 생산·canary하고 deployment ID를 고정했다.
13. 사용자 연구 접수를 공개하려면 사업 책임자가 선정 기준, 최대 인원, 검토 책임자, 선정·미선정 통지 기한, 문의·삭제 요청 SLA와 통지 문안을 승인하고 release evidence에 남겼다. 이메일 확인은 선정이 아니며, 이 운영 결정 없이 자동 선정 상태나 결과 메일을 임의로 만들지 않는다.
14. Resend의 확인 메일 발송 도메인에서 **click tracking이 비활성화**되어 있고 링크가 tracking redirect로 재작성되지 않는다는 설정 화면·확인 시각을 증거로 남겼다. Fragment capability가 provider tracking URL에 복사될 수 있으므로 이 증거가 없으면 사용자 연구 메일을 운영 발송하지 않는다. Resend도 이메일 확인 같은 민감한 transactional email에는 추적 비활성화를 권장한다: [Open and Click Tracking](https://resend.com/docs/dashboard/domains/tracking).
15. 운영 Supabase Auth의 mutable 설정을 read-only Management API gate로 검사해 `direct-signup-disabled-general-password-v1` 증거를 남겼고, 관리자 계정의 생성·복구·로그인 후 변경을 모두 포괄하는 12자 role-aware 정책도 별도 non-bypassable 경계에서 검증됐다. 둘 중 하나라도 없으면 중단한다.
16. full-history scanner가 찾은 Kakao platform key 형태 값 3개의 공급자 측 회전·제한·구 값 거부·사용량 검토와 현재 환경 갱신을 증명했고, 승인된 history 처리 뒤 exact SHA secret gate가 통과했다.
17. Cloudflare Turnstile의 운영 widget이 `hanbang.ai`만 허용하고 Production에 공개 site key와 비밀 secret key가 모두 저장됐다. 회원가입·비밀번호 복구·연구 신청·설문 네 action의 실제 토큰이 서버 Siteverify에서 각각 동일 hostname/action으로 검증되고, 다른 hostname/action·재사용·만료 토큰은 거부된 증거를 남겼다. 현재 `productionTurnstileBoundary.status`는 `not_configured`이므로 이 증거 전에는 운영 push를 중단한다. Cloudflare도 서버 검증과 지정한 hostname/action 비교를 권고한다: [Validate the token](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
18. Supabase의 공개 recovery·resend·magic-link·OTP 메일 경로가 앱의 CAPTCHA·영속 limiter·중립 응답·전달 경계를 우회하지 않는 승인 모드를 실제 hosted 설정과 black-box probe로 증명했고, `productionSupabasePublicEmailBoundary`가 `verified-v1`이다.
19. hosted Auth의 canonical site URL, exact redirect allow-list, JWT/refresh 회전·재사용, OTP 길이·만료와 rate limit을 read-only로 증명했고 `productionSupabaseRedirectTokenPolicy`가 `verified-v1`이다.
20. 화면에 보이는 OAuth 공급자가 checked-in 목록과 정확히 같고 각 공급자의 실제 redirect round-trip 또는 의도된 비노출·비활성 상태를 증명해 `productionOAuthProviderContract`가 `verified-v1`이다.
21. 2026-07-12 read-only Vercel 감사 중 내부 도구 출력에 노출된 Deployment Protection automation-bypass 비밀을 회전했다. 기존 consumer를 값 없이 inventory하고, 새 비밀을 승인된 consumer에 먼저 배포해 성공을 확인한 뒤 구 비밀의 거부와 사용 로그를 검증했다. raw `protectionBypass` object나 key는 어느 로그·문서에도 다시 출력하지 않는다.

## OpenAI 키 노출 사고 복구 — 회전 선행 gate와 exact-SHA 후행 canary

2026-07-12 검증에 사용한 기존 OpenAI 키는 값 자체를 문서에 기록하지 않고 노출된 것으로 간주한다. 다음 증거가 모두 생기기 전에는 그 키나 같은 값을 운영 canary에 사용하지 않는다.

1. OpenAI 프로젝트의 API key 관리 화면에서 당시 검증 키를 폐기하고 폐기 시각을 기록한다.
2. 키 값을 출력하거나 shell history에 넣지 않는 방식으로 기존 키 인증이 거부되는지 확인한다.
3. 노출 추정 시점 이후 프로젝트 usage·비용·rate-limit 활동을 검토해 승인하지 않은 사용 여부와 대응을 기록한다.
4. 운영 전용 새 키를 발급해 Vercel **Production에만** 저장한다. Preview·Development·문서·채팅·명령행 인수·Git에는 값을 넣지 않는다.
5. 환경 변수 수정 시각과 대상 project/environment를 기록하고, 기존 production을 재배포하지 않은 채 다음 exact-SHA anchor deployment에만 적용한다.
6. normal 후보를 apex에 승격한 뒤 alias·health identity를 fence 안에서 먼저 확인하고, fence를 해제한 직후 회전 키로 Luna/Terra 모델 접근, `store:false`, 스트리밍, 도구 후속, 첨부, 거절·중단·429/5xx, 비용 상한을 exact-SHA canary해 사용량이 기대한 호출과 일치하는지 확인한다. 실패하면 release를 완료 처리하지 않고 즉시 다시 fence한다.

1~5는 build·배포 전 선행 gate다. 6은 새 GPT 코드가 없는 과거 production이나 API가 닫힌 `coming_soon` anchor에서 실행할 수 없으므로 post-promotion gate이며, 통과 전에는 release 완료나 fence 해제를 선언하지 않는다. 키 폐기·새 키 저장·실사용 canary는 서로 다른 증거다.

## Kakao 과거 key 대응 — 선행 hard gate

full-history scanner는 과거 commit에서 Kakao platform key 형태 값 3개를 검출하며 현재 release gate를 실패시킨다. 값 자체를 문서·이슈·채팅·명령행·로그에 복사하지 않는다. 아래 증거가 모두 생기기 전에는 scanner 예외를 추가하거나 병합·배포하지 않는다.

1. 비공개 fingerprint와 도입·제거 commit만으로 세 값의 Kakao 앱, key 종류와 실제 사용 표면을 inventory한다.
2. Kakao Developers에서 세 과거 값을 모두 폐기·재발급하고 작업자·UTC·대상 앱을 기록한다. 단순히 코드에서 제거된 사실은 회전 증거가 아니다.
3. 실제 사용하는 표면에 맞춰 허용 web domain·redirect URI·server IP·Android package/key hash·iOS bundle identifier를 최소 범위로 제한하고 설정 화면과 확인 시각을 남긴다.
4. Supabase hosted Kakao provider와 실제로 참조하는 Vercel/EAS 환경을 새 값으로 갱신한다. 참조 표면이 없다면 검색 범위와 공급자 설정을 근거로 “현재 consumer 없음”을 기록한다. 값은 release evidence에 남기지 않는다.
5. 과거 값의 인증 거부와 노출 추정 기간의 Kakao 사용량·로그를 검토하고 승인되지 않은 활동 여부와 대응을 기록한다.
6. normal 후보를 apex에 승격해 alias·health identity를 확인한 뒤, fence 해제 직후 exact SHA의 허용한 Kakao OAuth 흐름을 canary한다. 아직 공개하지 않을 표면은 버튼 비노출과 hosted provider 차단을 확인한다. 실패하면 즉시 다시 fence하고 maintenance deployment로 복귀한다.
7. 그 뒤 `security:secrets`를 다시 실행한다. 이력 재작성은 저장소 소유자·협업자 영향과 force-push를 명시 승인한 경우에만 하고, fingerprint allowlist는 회전·제한 증거와 보안 책임자의 승인이 있을 때만 사용한다. CI를 초록색으로 만들기 위한 무근거 allowlist는 금지한다.

회전·환경 갱신·과거 값 거부·history 처리 승인은 선행 gate이고 OAuth round-trip은 새 코드가 apex에 있을 때만 가능한 후행 canary다. 서로 다른 증거이며 하나라도 없으면 release 완료를 NO-GO로 유지한다.

## Vercel Deployment Protection bypass 노출 대응 — 선행 hard gate

2026-07-12 project protection을 읽기 전용으로 감사하는 과정에서 Vercel API의 `protectionBypass` map key에 들어 있던 automation-bypass 비밀이 내부 도구 출력에 한 번 노출됐다. 값은 문서에 기록하지 않고 노출된 자격증명으로 취급한다. 다음 순서가 끝나기 전에는 Preview 보호 우회나 운영 출시를 승인하지 않는다.

1. 저장소, GitHub Actions, Vercel 환경 변수와 알려진 외부 자동화에서 consumer의 **이름·용도·소유자**만 inventory한다. 비밀값 비교나 raw project JSON 출력은 금지한다.
2. 기존 consumer를 알 수 없거나 새 비밀을 먼저 배포할 수 없으면 구 비밀을 즉시 삭제해 가용성을 깨뜨리지 않고 책임자에게 교체 창을 승인받는다.
3. Vercel에서 새 automation-bypass 비밀을 발급하고 승인된 consumer에만 저장한다. 채팅, 명령행 인수, release evidence, shell history에 값을 넣지 않는다.
4. 새 비밀의 승인된 Preview 접근 성공을 확인한 뒤 구 비밀을 폐기하고, 구 비밀의 접근 거부를 확인한다. 실패 시 구 비밀을 복원하지 말고 새 비밀 배포 오류를 수정한다.
5. 노출 시각 전후의 bypass 사용 로그를 검토하고 승인되지 않은 접근 여부와 대응을 기록한다.
6. 이후 project protection 감사는 allowlist한 필드만 메모리에서 선택한다. `protectionBypass` object 자체와 `Object.keys(...)` 결과를 stdout/stderr에 보내지 않는다.

저장소의 오프라인 정규화기 계약은 먼저 아래처럼 검증한다.

```powershell
corepack pnpm vercel:release-inventory:test
```

`vercel:release-inventory`는 `{project, env, deployments}` JSON envelope를 stdin으로 받거나 명시한 로컬 fixture 3개만 읽고 provider API를 호출하지 않는 **정규화기**다. 운영 감사에서는 raw project 응답을 파일로 저장하지 않고 인증된 읽기 전용 producer의 메모리에서 stdin으로 즉시 전달해야 하지만, 그 producer와 신뢰 attestation은 아직 구현되지 않았다. fixture mode는 final file뿐 아니라 기존 ancestor component도 symlink/junction/reparse가 아닌지 검사하지만 portable handle-relative `openat`이 없어 검사 뒤 ancestor 교체 race까지 증명하지 못하므로 운영 증거 입력으로 사용하지 않는다. 출력은 allowlist한 project/account 식별자, 배포 SHA·상태·개수·pagination 관측 여부, 환경 변수 **이름·target·type·시각과 값 없는 scope marker**, protection mode, bypass 관측 여부·boolean·개수와 redacted digest뿐이다. 모든 출력은 `evaluationMode=offline-local-artifacts`, `sourceAttestationVerified=false`, `productionProof=false`, `releaseEligible=false`이며 CLI exit 0은 입력 정규화 성공만 뜻한다. `protectionBypass` 필드가 응답에 없으면 0개로 단정하지 않고 `automationBypassFieldObserved=false`, configured/count `null`로 보존한다. env/deployment row나 provider alias가 malformed·충돌하면 전체 입력을 거부한다. branch-specific 변수는 정확히 preview target 하나만 가져야 하며, 같은 이름과 같은 branch 또는 같은 custom-environment ID의 중복 owner도 거부한다. base preview와 branch override는 함께 존재할 수 있고 custom-environment ID는 일반 target에 더해지는 별도 scope이므로 Production target과 함께 존재할 수 있지만, 공개 요약에는 branch·custom-environment 식별자를 복사하지 않고 boolean과 custom scope 개수만 남긴다. pagination object는 own `count`, `next`, `prev` 세 필드와 정확한 row count를 모두 가져야 관측된 것으로 인정한다. `fieldObserved=true`, `singlePageComplete=true`(즉 두 cursor가 모두 null), `byState.unknown=0`은 필요한 일관성 신호일 뿐 “배포 없음”이나 “해당 SHA의 모든 배포 확인”으로 승격하지 않는다. 신뢰 producer가 expected project ID·account ID·candidate SHA를 외부에서 고정하고 `withoutSha=0`, 유일한 matching SHA group, 모든 관련 page 완료를 증명하는 gate가 구현되기 전에는 exact-SHA deployment inventory가 blocker다. 환경변수 API가 pagination을 주지 않는 경우 sanitizer도 이를 `fieldObserved=false`로 보존하며, 변수 이름 존재만 exact deployment snapshot 적용 증거로 사용하지 않는다. 각 필수 변수의 수정 시각이 staged deployment 생성 이전인지 확인하고, Vercel 문서대로 변경 뒤 새 deployment를 만들며, 최종 값·모델·feature flag는 exact runtime health/canary로 검증한다. 이 출력은 비밀 회전·구 비밀 거부·사용 로그 검토를 대신하지 않는다.

이 회전은 Vercel 배포 자격증명, OpenAI, Kakao, Supabase 자격증명 회전과 별개다. 하나의 회전 증거를 다른 공급자의 증거로 재사용하지 않는다.

## 정상 출시 순서

### 0. merge 전 후보 증거 고정

```powershell
git status --short --branch
git rev-parse HEAD
gh pr view 38 --json headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus
gh pr checks 38
```

로컬 HEAD와 PR `headRefOid`가 같은 `$CandidateSha`인지 확인하고 migration/release script fingerprint를 release ticket에 기록한다. 이 뒤 파일이나 후보 HEAD가 바뀌면 merge 전 검증을 처음부터 다시 한다. 운영 배포에 사용할 `$ReviewedSha`는 아래 0-C에서 병합 후 새로 고정하는 `$ReleaseSha`이며, 아직 이 단계에서는 정하지 않는다.

#### 0-0. Turnstile canonical/action attestation

Vercel Production에 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`와 `TURNSTILE_SECRET_KEY`를 모두 저장하고, `NEXT_PUBLIC_SITE_URL`은 정확히 `https://hanbang.ai`여야 한다. `NEXT_PUBLIC_` 값은 클라이언트 번들에 build-time 고정되므로 변수 저장 뒤 exact SHA를 새로 빌드한다. 이미 만들어진 deployment에 환경 변수만 바꿔서 증거로 재사용하지 않는다.

Cloudflare widget의 허용 hostname은 apex `hanbang.ai`만 남긴다. `www.hanbang.ai`는 앱이 apex로 308 정규화하므로 별도 허용하지 않는다. health의 아래 값은 **문자열 형식과 exact hostname 설정만 확인하는 configuration evidence**이며, 브라우저 challenge 성공 증거가 아니다.

- `turnstileCredentialsConfigured=true`
- `turnstileCanonicalHostnameConfigured=true`
- `turnstileConfigured=true`

특히 `--skip-domain` staged deployment는 브라우저 hostname이 `*.vercel.app`이므로, 위 health가 초록이어도 `hanbang.ai` 제한 production widget의 실제 challenge 성공을 증명하지 않는다. Preview health를 production Siteverify attestation으로 승격하지 않는다.

`scripts/release-targets.json`의 `productionTurnstileBoundary.status`는 `hanbang.ai`에서 실제 브라우저로 `signup`, `forgot_password`, `preregister`, `survey` 네 action을 각각 발급·검증하고, 다른 action 토큰과 다른 hostname 토큰이 거부되는 것을 확인하기 전까지 `not_configured`로 유지한다. 토큰은 5분 유효·일회용이므로 실패/재시도 때 새 토큰이 발급되는지도 확인한다. 운영 데이터나 이메일을 만드는 흐름은 운영자 소유 테스트 주소, 사전 승인된 정리 절차, 생성·삭제 증거가 있어야 한다. Cloudflare 공식 기준: [Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Explicit rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [Testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

현재 절차에는 이 선행 attestation을 실행할 안전한 경로가 **없다**. DB push 전에 apex에 올릴 수 있는 `coming_soon` anchor는 `/login`, 가입·복구 API, 고객 설문을 차단하고 연구 접수도 닫혀 있는데, guarded ship은 네 action의 `verified-v1`을 먼저 요구한다. 따라서 상태값을 수동으로 초록색으로 바꾸거나 `supabase-ship-safe.ps1`의 검사를 제거하지 않는다. 운영 데이터·메일을 만들지 않는 인증 전용 apex surface를 별도 보안 검토해 추가하거나, DB-only ship과 최종 web promotion gate를 exact-SHA evidence로 안전하게 분리하는 후속 설계가 승인되기 전까지 이 항목은 의도된 release hard-stop이다.

#### 0-A. Hosted Supabase Auth exact attestation

`supabase/config.toml`은 로컬 기준일 뿐 hosted 프로젝트의 현재 설정 증거가 아니다. 승인된 secret runner가 현재 shell에 주입한 `SUPABASE_ACCESS_TOKEN`으로 아래 read-only 검사를 실행한다. 토큰 값을 명령 인수, 문서, 로그에 넣지 않는다.

```powershell
corepack pnpm supabase:auth-config:preflight -- `
  --expected-project-ref <protected-production-ref>
```

이 검사는 공식 Management API의 `GET /v1/projects/{ref}/config/auth`만 호출하고 다음을 exact하게 확인한다.

- 공개 GoTrue 가입 차단: `disable_signup=true`
- 익명 로그인·전화 공급자·수동 identity linking 차단
- 이메일 공급자는 활성, 자동 확인은 비활성
- **일반 사용자** 비밀번호는 정확히 8자 이상이며 소문자·대문자·숫자·특수문자를 모두 요구
- 비밀번호 변경 재인증 보호 활성
- canonical site URL과 쉼표 구분 redirect allow-list가 checked-in exact 목록과 일치
- JWT 3,600초, refresh rotation 활성, reuse interval 10초, 이메일 OTP 6자리·3,600초가 exact
- 이메일 발송은 시간당 2회, token refresh는 IP당 5분 150회, sign-in/sign-up과 token verification은 각각 IP당 5분 30회로 exact
- hosted에서 활성인 모든 `external_*_enabled` OAuth provider 집합이 화면에 허용한 checked-in provider 집합과 exact

필드 이름과 rate-limit 시간 창은 Supabase의 [Management API](https://supabase.com/docs/reference/api/getting-started)와 [CLI Auth config reference](https://supabase.com/docs/guides/local-development/cli/config)의 현재 공식 스키마에 맞춘다. config-only PASS는 실제 recovery/OAuth round-trip 성공을 뜻하지 않는다.

Supabase의 공개 project key는 비밀이 아니므로 `disable_signup=false`이면 공격자가 웹 `/api/auth/signup`을 거치지 않고 GoTrue `/signup`을 직접 호출할 수 있다. 그러면 앱 서버의 Turnstile, 영속 rate limit, 중립 응답, 커스텀 확인 메일 보상 흐름과 일반 사용자 8자 정책을 우회한다. 따라서 앱 화면에서 직접 SDK 호출을 제거한 것만으로 통과 처리하지 않는다. Supabase도 8자 미만을 권장하지 않으며 가장 강한 문자 조합과 CAPTCHA 보호를 제공한다: [Password security](https://supabase.com/docs/guides/auth/password-security), [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha).

이 검사는 Supabase-native CAPTCHA 설정을 앱 서버 Turnstile의 대체 증거로 간주하지 않는다. 공개 signup 자체를 닫아 우회 경로를 제거하는 계약이다. Native CAPTCHA를 켜면 sign-in·sign-up·password reset 클라이언트 모두 토큰 전달 호환성을 별도로 검증해야 한다.

관리자 정책은 위 일반 사용자 정책과 다르다. 공개 signup은 기본 일반 profile을 만들 뿐 `is_admin`을 부여하지 않으며, 관리자 생성 API는 현재 12자+소문자·대문자·숫자·특수문자를 검사한다. 따라서 공개 signup 결함을 “관리자 생성 12자 정책 직접 우회”라고 보고하지 않는다. 반대로 공통 recovery 화면과 로그인 후 web/mobile `updateUser`는 8자 정책이어서, 기존 관리자는 12자보다 짧은 비밀번호로 낮출 수 있다. Hosted Auth의 전역 최소 길이를 8로 맞춘 사실은 이 role-aware 수명주기를 증명하지 못한다.

현재 `scripts/release-targets.json`의 `productionAdminPasswordLifecycle.status`는 의도적으로 `blocked-role-aware-provider-gap`이다. 다음 중 선택한 설계가 실제 non-bypassable 경계, 회귀 테스트, 기존 관리자 credential rotation, 운영 증거를 모두 갖추기 전에는 `verified-v1`로 바꾸지 않는다.

- 모든 사용자에게 provider 전역 12자 정책을 적용하고 가입·복구·web/mobile 변경 UX도 12자로 통일
- 관리자만의 생성·복구·변경 경로를 일반 GoTrue update에서 분리하고 직접 호출로 우회할 수 없게 강제하며 관리자 MFA까지 검증

`supabase:ship:safe`는 초기 preflight와 migration push 직전에 hosted Auth 설정을 다시 읽도록 배선되어 있다. 그러나 현재 role-aware 관리자 blocker와 기존 DB fence/backup blocker가 남아 있으므로 운영 실행은 계속 fail-closed다. 이번 코드 검토에서는 운영 API를 호출하거나 설정을 변경하지 않았다.

#### 0-B. Hosted public email·redirect/token·OAuth evidence gap

guarded ship은 `productionSupabasePublicEmailBoundary`, `productionSupabaseRedirectTokenPolicy`, `productionOAuthProviderContract`가 모두 `verified-v1`인지를 요구한다. read-only Auth preflight는 이제 signup/password뿐 아니라 canonical URL, exact redirect allow-list, JWT/refresh/OTP/rate-limit과 hosted OAuth enable 집합을 `scripts/release-targets.json`에 결합해 boolean만 출력한다. 이 로컬 계약은 14개 테스트를 통과했지만, 회전된 PAT로 실제 hosted 설정을 읽은 증거는 아직 없고 다음 black-box 경계도 남아 있다.

- 공개 recovery·resend·magic-link·OTP가 앱 CAPTCHA·limiter·중립 응답·전달 경계를 우회하지 않는지
- canonical site URL, exact redirect allow-list, JWT/refresh/OTP 정책과 Auth rate limit의 실제 hosted snapshot
- 화면의 OAuth flags·hosted provider 활성 상태·실제 redirect round-trip의 정확한 일치. config boolean만으로 provider credential과 callback 성공을 증명하지 않는다.

따라서 운영자가 `scripts/release-targets.json`의 status만 바꾸는 것은 증거가 아니며 금지한다. read-only 결과와 승인된 public-email/OAuth black-box probe가 exact SHA·Supabase ref·환경 snapshot에 함께 묶이기 전까지 세 status를 현재 blocked/not-attested 상태로 유지하고, ship의 hard-stop을 정상으로 취급한다.

#### 0-C. PR candidate와 post-merge release SHA 분리

PR HEAD는 merge 전 후보일 뿐 운영 artifact가 아니다. 이 저장소는 merge commit·squash·rebase를 모두 허용하므로 일반 병합은 새 SHA를 만든다. 이 release에서는 provenance를 단순하게 유지하기 위해 GitHub의 **Create a merge commit** 방식만 사용하고 force-push·squash·rebase merge를 사용하지 않는다.

1. 병합 전 `$CandidateSha = gh pr view 38 --json headRefOid --jq .headRefOid`를 고정하고 CI·독립 승인·비운영 빌드를 이 SHA에 묶는다.
2. GO 1~4의 코드·환경 identity, 13~21의 사업/보안/공급자 선행 승인, 그리고 GO 5~12의 disposable 리허설·production read-only inventory가 모두 candidate SHA에 묶여야 한다. 실제 production DB 변경은 하지 않되, post-merge 단계에서 처음 발견할 blocker가 남아 있으면 병합하지 않는다. 현재 Turnstile/Auth attester, secret 회전, backup/restore, fence, 모바일 서명 같은 blocker가 하나라도 있으면 이 단계에 도달하지 않는다.
3. 병합 직전 PR head가 바뀌는 TOCTOU를 막기 위해 `gh pr merge 38 --merge --match-head-commit $CandidateSha`만 사용한다.
4. 병합 후 원격을 다시 fetch하고 GitHub의 `mergeCommit.oid`, `origin/main`, 로컬 checkout이 모두 같은 40자 `$ReleaseSha`인지 확인한다. `$CandidateSha`가 `$ReleaseSha`의 ancestor가 아니면 중단한다.
5. clean `$ReleaseSha`에서 secret gate, 전체 test/lint/typecheck/build, migration fingerprints, EAS release build와 staged Vercel identity를 전부 다시 실행한다. 이후 이 문서의 `$ReviewedSha`는 `$ReleaseSha`만 뜻한다.

병합 전 PR check나 Preview, 또는 `$CandidateSha`의 EAS 결과를 post-merge 운영 증거로 재사용하지 않는다. post-merge gate가 실패하면 운영 배포하지 않고 새 PR로 수정한다.

### 1. exact-SHA rollback anchor staged 배포

#### 1-A. trusted deployment producer 선행조건

현재 저장소에는 CI workflow만 있고 배포 workflow가 없다. `main` branch protection/ruleset과 GitHub `Production` environment 승인·branch policy도 강제되지 않으며, private repository에서 필요한 보호 기능은 현재 요금제 API가 403으로 거부한다. 이 상태에서 같은 저장소에 Vercel token이나 production environment secret을 넣지 않는다. CODEOWNERS는 보호 규칙이 실제로 켜지기 전에는 승인 강제가 아니라 소유권 선언일 뿐이다.

운영 proof는 별도의 보호된 `release-control` 저장소 또는 동등한 외부 승인 시스템이 생산해야 한다. controller는 앱 저장소나 PR artifact/cache를 credential-bearing job에서 실행하지 않고, create 전에 독립 승인된 exact SHA만 받아 다음을 모두 fail-closed로 확인한다.

1. 입력은 exact 40자 release SHA와 독립 code/release approval receipt이고 GitHub repository ID와 `main` HEAD가 고정된 allowlist와 일치한다. create 직전과 promote 직전에 모두 다시 조회한다.
2. 앱 저장소가 스스로 주장한 check 이름만 신뢰하지 않는다. 보호된 workflow ID·workflow definition digest·producer identity를 고정하고, release-control의 비밀 없는 독립 gate가 full history, exact SHA, Windows reviewed-launcher contract와 정책을 다시 검사한다. 코드 실행이 필요한 quality 결과는 독립 승인된 no-secret producer의 attestation으로 받는다. `pull_request_target`, PR artifact를 소비하는 privileged `workflow_run`, issue/comment deploy는 사용하지 않는다.
3. project 단위 controller concurrency는 `cancel-in-progress=false`로 직렬화한다. Vercel create-deployment API에 외부에서 고정한 team/project/GitHub repository ID와 `gitSource={type,repoId,ref,sha}`를 전달하고 응답의 네 필드를 모두 exact 비교한다. custom-domain 자동 할당은 꺼진 상태에서 Production target을 staged로 만들고 apex alias의 예상 이전 deployment ID가 움직이지 않았음을 확인한다.
4. Vercel API에서 같은 deployment ID의 project/team, `gitSource.sha`, target, `READY`, immutable URL을 확인하고 alias API가 deployment ID를 결합한다. runtime health와 canary는 SHA·Supabase ref·기능 상태를 별도로 결합하며 health가 deployment ID를 반환한다고 가정하지 않는다.
5. promote 직전에 `main`, 독립 승인 receipt, staged deployment identity와 apex alias의 예상 이전 deployment ID를 다시 읽는다. out-of-band alias 변경이 있으면 controller lock과 무관하게 중단한다. 그 뒤 같은 deployment ID만 promote하고, alias API의 deployment ID와 `hanbang.ai` health의 SHA가 각각 기대값과 일치할 때만 Vercel promotion proof를 발행한다.

staged receipt와 promoted Vercel-only receipt는 모두 `releaseEligible=false`다. promoted receipt의 `productionProof`는 Vercel promotion 범위만 뜻하며 DB fence·backup/restore·mobile 등 전체 gate의 결과를 대신하지 않는다. 별도의 release aggregator만 모든 receipt를 결합해 전역 출시 자격을 판단한다. receipt에는 allowlist된 ID·SHA·run ID·boolean·digest와 외부 서명/attestation만 기록한다. Vercel 원문 응답, header, 환경 변수 값은 evidence에 넣지 않는다.

공식 근거: [GitHub pull_request_target 보안](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Vercel create deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment), [Vercel staged promotion](https://vercel.com/docs/deployments/promoting-a-deployment).

#### 1-B. controller-only 실행 계약 — 로컬 CLI 실행 금지

이 절 이하의 Vercel 환경 변경·staged create·promote는 보호된 controller와 서명 receipt가 구현되기 전에는 실행하지 않는다. ignored/untracked `.vercel/project.json`, 로컬 credential, 사람의 `inspect` 판독은 공급자 설정 진단에도 보조 자료일 뿐이며 `sourceAttestationVerified`, `productionProof`, `releaseEligible`로 승격하지 않는다. 과거 로컬 `vercel deploy/promote` 명령은 승인 경로에서 제거했다. 실제 장애 중 break-glass가 필요하면 별도의 incident commander 승인, 사전 rollback 대상, 이중 통제, 사후 credential 회전이 있어야 하며 그 실행도 정상 출시 proof가 아니다.

현재 `main`의 과거 Vercel deployment는 `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`을 해석하지 않아 Instant Rollback 시 로그인·앱·일반 API가 다시 열릴 수 있다. 따라서 trusted controller는 DB 변경 전에 launch gate를 포함한 exact SHA를 Production target으로 staged하되, 검증 전에는 `hanbang.ai`에 연결하지 않는다.

controller는 승인된 환경 snapshot을 아래 안전 상태로 만들고 변수 이름·target·최종 수정 시각과 redacted digest만 기록한다. 사람이 로컬 CLI로 값을 바꾸지 않으며 값은 출력하지 않는다.

- `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`
- `MAINTENANCE_MODE=false`
- `RESEARCH_COHORT_APPLICATIONS_ENABLED=false`
- `ACCOUNT_DELETION_CRON_ENABLED=false`
- 새 런타임에는 `OPENAI_API_KEY`와 고정된 Luna/Terra model 설정만 두고 `ANTHROPIC_API_KEY`는 Production 환경에서 제거
- 검토된 production Supabase ref와 회전·검증된 비밀만 사용

`ANTHROPIC_API_KEY` 제거는 현재 코드에 Anthropic runtime consumer가 없고 OpenAI staged canary가 성공한다는 사실을 먼저 확인한 뒤 수행한다. 과거 Claude 가격표와 감사 row 호환 코드는 credential consumer가 아니다. 새 deployment의 환경 inventory에서 이름이 사라졌고 구 Anthropic key가 공급자에서 폐기됐다는 증거를 모두 남긴다. 과거 production deployment에 의존해 되돌리는 rollback은 금지하고, 회전된 OpenAI 환경을 가진 exact-SHA rollback anchor만 사용한다.

controller는 외부 allowlist의 repository/team/project ID와 exact `$ReviewedSha`를 Vercel API에 전달해 immutable anchor를 만들고, 응답의 deployment ID·Production target·SHA·READY를 strict schema로 검증한다. 이어서 custom domain이 아니라 immutable anchor URL에서 health와 `coming_soon` canary를 실행해 다음을 확인한다.

```text
deployment = $ReviewedSha 전체 40자리
supabaseProjectRef = protected production ref
maintenance = false
researchCohortApplicationsEnabled = false
accountDeletionCronEnabled = false
공개 allowlist 정상, 로그인·앱·일반 API 차단
```

```powershell
node ./scripts/live-smoke-test.mjs --base-url=$AnchorUrl --launch-mode=coming_soon --research-intake=closed --account-deletion-cron=closed --expected-sha=$ReviewedSha --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>
```

SHA, Supabase ref, 환경 계약, deployment ID 중 하나라도 다르면 staged deployment를 promote하지 않는다. 모두 통과하고 독립 승인이 있으면 controller가 create 직전과 같은 `main` SHA를 다시 확인한 뒤 같은 deployment ID만 승격하고, 승격 뒤 alias API와 `hanbang.ai` canary를 다시 실행한다.

승격 전후 deployment ID가 같고 domain alias가 그 ID를 가리키는지 기록한다. 이 ID만 DB 변경 전 rollback anchor로 승인한다. 과거 gate 없는 deployment는 계속 rollback 대상에서 제외한다.

### 2. exact-SHA maintenance staged 배포

승인된 maintenance 시작 직전에 trusted controller가 Production 환경 snapshot을 아래 값으로 갱신하고 이름·target·수정 시각·redacted digest를 기록한다. rollback anchor와 같은 `$ReviewedSha`에서 새 Production-target deployment를 만들되 custom domain 연결을 건너뛴다. 로컬 CLI로 환경이나 alias를 변경하지 않는다.

- `MAINTENANCE_MODE=true`
- `MAINTENANCE_STARTED_AT_UTC=<현재 UTC ISO-8601>`
- 검토된 production Supabase URL
- 32자 이상이면서 공백·예시값·저엔트로피·다른 신뢰 경계 비밀 재사용이 없는 전용 `RATE_LIMIT_KEY_SECRET`
- 다른 비밀과 재사용하지 않은 32자 이상 `RESEARCH_EMAIL_VERIFICATION_SECRET`
- 실제 발송 도메인이 확인된 `RESEND_API_KEY`
- 확인 메일 링크를 재작성하지 않도록 비활성화한 Resend click tracking 설정
- 이번 핵심 출시에서는 `RESEARCH_COHORT_APPLICATIONS_ENABLED=false`; 실제 연구 접수 공개는 선정·통지·삭제 운영 승인과 전용 E2E를 갖춘 별도 exact-SHA staged release에서만 수행
- 이번 핵심 출시에서는 `ACCOUNT_DELETION_CRON_ENABLED=false`; fresh/upgrade migration, encrypted backup, isolated restore drill, queue health와 삭제 canary를 갖춘 별도 exact-SHA staged release에서만 활성화

controller는 create 직전 `main` HEAD와 exact SHA를 다시 확인하고 외부 allowlist의 team/project/repository ID로 maintenance deployment를 staged한다. strict provider response 검증이 실패하면 URL이나 receipt를 생산하지 않는다.

먼저 `$MaintenanceUrl`에서 다음을 확인한다.

```text
GET $MaintenanceUrl/api/health/maintenance
maintenance = true
supabaseProjectRef = protected production ref
deployment = $ReviewedSha 전체 40자리
rateLimitKeySecretConfigured = true
researchCohortApplicationsEnabled = false
accountDeletionCronEnabled = false
```

페이지와 일반 API는 503이어야 한다. app association 세 경로와 health endpoint만 직접 응답한다. health endpoint가 404이거나 SHA·Supabase ref·flag 중 하나라도 다르거나 provider API의 deployment ID 결합이 다르면 promote하지 않는다. 모두 통과하고 독립 승인이 있으면 controller가 `main` HEAD를 다시 확인하고 같은 maintenance ID만 승격한다.

승격 뒤 `https://hanbang.ai/api/health/maintenance`와 503 경계를 다시 검사하고 domain alias가 같은 maintenance deployment ID를 가리키는지 기록한다. 실패하면 DB를 건드리지 말고 trusted controller가 사전에 canary한 anchor deployment ID만 다시 promote한 뒤 공개 경계를 재검증한다.

계정 삭제 migration 전에는 `ACCOUNT_DELETION_CRON_ENABLED=false`만 확인하고 바로 진행하지 않는다. maintenance의 authoritative 시작 시각부터 기존 worker lease 600초와 serverless 최대 실행 120초 중 더 긴 600초가 모두 지나야 하며, 그 뒤 `account_deletion_jobs.status='processing'`가 0인지 확인한다. safe-ship은 이 조건을 최초 maintenance 확인, 최종 preflight, 실제 push 직전 원격 재조회에서 반복한다. 하나라도 남아 있으면 과거 worker가 공유 `chat-image` prefix 삭제를 계속할 수 있으므로 DB를 변경하지 않고 해당 job을 별도 조사한다.

같은 preflight에서 `unattributed_chat_image_objects=0`과 `orphaned_chat_image_objects=0`도 필수다. `chat-image`는 커플 공유 prefix라서 `owner_id`가 없거나 UUID 형식이 아닌 객체뿐 아니라, UUID 형식은 맞지만 대응하는 `auth.users`가 이미 없는 객체도 임의로 삭제할 수 없다. 이런 객체가 있으면 provenance와 Auth 삭제 이력을 복구하거나 승인된 보존·삭제 결정을 기록할 때까지 출시와 모든 계정 삭제 완료를 중단한다. 파트너 객체를 prefix 단위로 지우는 우회는 금지한다. 새 `chat-image` INSERT/UPDATE는 실제 Auth 주체를 `FOR KEY SHARE`로 확인하므로 service-role이 존재하지 않는 UUID를 붙이는 쓰기도 거부한다.

[Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data)는 Storage 객체를 소유한 Auth 사용자의 삭제를 오류로 거부한다고 명시한다. migration의 `auth.users` DELETE trigger도 같은 규칙을 직접 SQL 삭제에 적용한다. 삭제 job이 없는 정상 운영 삭제는 소유 Storage가 전혀 없고 전역 chat provenance가 깨끗할 때만 기존처럼 허용한다. 계정 삭제 job이 있으면 기존 cleanup-ready proof까지 추가로 요구한다.

### 3. 직접 쓰기 fence와 drain

웹 503만으로는 fence가 아니다. 배포된 모바일은 Supabase에 직접 쓸 수 있다. Data API, Auth가 만드는 DB 쓰기, Storage upload/update/delete를 모두 차단하고 다음을 자동 probe한다.

- 배포된 legacy anon key 요청 거부
- 배포된 publishable key 요청 거부
- 새 로그인·토큰 갱신·DB INSERT/RPC·Storage upload 거부
- release 전용 DB 연결만 허용
- 활성 사용자 transaction 0

저장소의 `supabase:fence`는 `database-readonly-realtime-cron-v1` 계약의 스냅샷·활성화·검증·복구 경계를 구현한다. 단, 이것은 로컬 계약 구현일 뿐 운영 검증 완료가 아니다.

```powershell
corepack pnpm supabase:fence:test
corepack pnpm supabase:fence -- -Action Plan -ExpectedProjectRef <20-char-non-production-ref>
```

현재 lifecycle은 project별 exclusive lock을 모든 non-Plan journal 접근보다 먼저 잡고 linked-ref read lock을 유지한다. snapshot schema v2는 clean HEAD/tree, 5분 capture freshness, sanitized management/DB baseline, 모든 기존 client backend의 cutoff·종료 개수와 no-query-text 상태를 묶는다. 각 원격 mutation 전 pending journal을 같은 디렉터리의 unique temp에 file-flush한 뒤 no-clobber create 또는 atomic replace하고, 첫 network mutation 직전 management/DB baseline을 반복 재조회한다. journal publish는 Windows에서 write-through rename을 요청하고 Linux/macOS에서 새 directory 계층의 parent와 containing directory를 fsync하도록 구현한다. 이는 코드 경로와 오프라인 fault injection의 증거이며 실제 파일시스템·가상화·전원 손실 환경의 crash-consistency 시험을 대신하지 않는다.

다음 여섯 경계는 아직 코드만으로 닫히지 않았으므로 운영 blocker다. (1) Supabase Management API와 PostgreSQL baseline 사이에는 provider ETag나 transaction형 change-freeze가 없어 마지막 재조회와 첫 mutation 사이의 cross-system TOCTOU가 남는다. (2) fence의 DB query는 URL의 `ExpectedProjectRef`에 직접 고정됐지만 실제 migration preflight와 push는 여전히 `supabase-ship-safe.ps1`의 repository `--linked` 연결을 사용한다. 두 경로가 같은 불변 project·database·role을 사용한다는 증거가 없으므로 fence PASS를 migration 연결의 PASS로 승격하지 않는다. 비밀번호 없는 명시적 URL과 child-only credential만으로는 충분하지 않다. release allowlist/fuse, exact command grammar, reviewed native binary SHA-256, Git exact-HEAD 전체 migration inventory, 같은 DB connection 안의 provider-attested project/role fingerprint를 하나의 ship 경계에 묶어야 한다. 독립 runner 초안은 이 모든 조건을 만족하지 않아 채택하지 않았다. (3) 현재 지속 read-only 설정은 알려진 service role 네 개에만 적용되므로 fence 활성 뒤 다른 writable LOGIN/internal role이 새로 연결하는 경로를 DB-wide default와 release 예외 또는 provider-attested 전체 role inventory로 닫아야 한다. (4) staged restore는 여러 provider에 걸친 원자적 reopen이 아니므로 maintenance·black-box probe·실패 시 재격리의 실제 연습이 필요하다. (5) lifecycle lock과 journal은 한 컴퓨터의 local state에만 있으므로 다른 PC나 CI runner와의 동시 실행을 막지 못한다. project별 provider-side single-generation CAS/lease와 모든 원격 mutation 직전 ownership 재검증이 필요하다. (6) migration-start CAS 자체와 exact-target ship을 같은 lease·connection·process에 묶는 coordinator가 아직 없으며, 현재의 Mark action은 오인 방지를 위해 제거했다. fresh live fence와 black-box denial 검증, migration-start CAS, exact-target push, post evidence가 하나의 shared ownership 구간이어야 한다. 이 여섯 항목과 disposable rehearsal이 끝나기 전에는 `productionDatabaseWriteFence`를 변경하지 않는다.

offline evidence v2 초안은 경로·digest·체인 검사를 구현했지만, untrusted input identity를 expected 값으로 되복사하는 self-pin과 restored baseline을 active genesis baseline에 묶지 않은 비교가 적대적 검토에서 재현됐다. 운영 consumer가 없는 상태에서 `ok`·`allRequiredChecksPassed`·`chainVerified`라는 성공 표면이 오인될 위험이 더 크므로 초안·테스트·명령을 출시 변경에서 제거했다. trusted producer가 별도 서명된 expected manifest를 제공하고 active baseline digest를 전체 계보에 보존하는 새 설계가 독립 검토되기 전에는 자동 post-migration evidence가 운영 blocker다.

`scripts/release-targets.json`의 `productionDatabaseWriteFence`는 현재 `not_configured`이고 `approvedNonProductionSupabaseProjectRefs`도 비어 있다. 사용자가 명시적으로 승인한 폐기 가능한 Supabase 프로젝트 ref를 allowlist에 넣기 전에는 원격 fence·migration·recovery export가 모두 중단된다. 그 프로젝트에서 Management API network status, 역할별 read-only, 기존 pooled session 종료 경계, `ALTER SYSTEM`, cron drain, release writer와 Data API/Auth/Storage black-box 거부, 실패 복구를 모두 연습하고 증거를 독립 검토하기 전에는 운영 fuse를 바꾸지 않는다.

현재 구현은 production에서 operator가 작성한 `post-migration-release-evidence-v1`을 운영 증거로 받지 않으며, `supabase:ship:safe`와 `supabase:baseline:core`도 활성 snapshot·자동 probe producer가 연결될 때까지 무조건 중단한다. 따라서 아래 lifecycle은 **아직 실행 명령이 아니라 disposable 검증에서 완성해야 할 계약**이다.

```text
provider-coordinated capture/activate/verify → migration-start CAS
→ exact-target guarded baseline/ship → signed automated black-box evidence
→ verified recovery authorization → exact restore-state verification
```

### 4. backup·restore 증거

```powershell
corepack pnpm exec supabase backups list `
  --project-ref <production-ref> --output-format json
```

backup은 `COMPLETED`, 올바른 project, 승인된 recovery window여야 한다. PITR이면 latest recovery point가 drain 뒤인지 확인한다. daily physical backup만 있으면 임의 시각의 최신 복구 지점을 보장할 수 없으므로 maintenance 창과 맞지 않는 오래된 backup을 승인하지 않는다.

현재 `supabase:ship:safe` 구현은 **maintenance 시작 뒤 완료되고 30분 이내인 최신 physical backup ID만** 허용한다. PITR recovery timestamp를 입력받거나 검증하지 않는다. PITR을 켰다는 사실만으로 이 gate를 통과 처리하지 말고, recovery-window 검증을 스크립트에 구현해 별도 환경에서 restore까지 연습한 뒤에만 PITR 경로를 사용한다.

복구 훈련은 운영 원본을 덮어쓰지 않고 별도 프로젝트에서 수행한다.

- DB schema/data/Auth user가 기대한 시점과 일치
- extension, RLS, function ACL, cron 재구성 확인
- Storage bucket/object는 별도 inventory/export와 복구 확인
- 측정 RPO·RTO 기록

Phase-A 안전 도구는 아래처럼 로컬 보안 경계를 검증한다.

```powershell
corepack pnpm supabase:recovery:test
```

`supabase:recovery:safe`의 Phase-A 설계와 계약 테스트는 pinned CLI/native tool, 최소 child 환경, 위험 플래그 차단, age 암호화, DB dump·Storage byte manifest, self-consistency와 cleanup 경계를 모델링한다. 그러나 실제 `export` 명령은 exact-target producer, filter-free worktree attestation과 signed lifecycle이 없어 credential·Git 경계 전에 `RECOVERY_EXPORT_NOT_ENABLED`로 중단한다. `verify-archive`는 trusted `--expected-project-ref`를 필수로 받고 public/private manifest를 모두 그 값에 결합한다. 외부 archive pathname은 regular-file identity를 secure workspace에 복사하면서 해시하고 같은 open handle의 exact stdin digest와 사후 rehash를 비교한다. 현재 authenticity producer가 없으므로 검증을 마쳐도 `ok=false`, `producerAuthenticityVerified=false`, `restoreEligible=false`, `releaseEligible=false`를 반환한다.

`backupPolicy.rehearsalStatus`는 격리 target 사용 승인(`approved-v1`)을 production `backupPolicy.status`와 분리한다. status가 `not_configured`인 채 restore allowlist만 채우는 것, production/source/restore ref의 중복, 숫자·객체를 ref 문자열로 강제 변환하는 입력을 strict policy validator가 거부한다. 현재는 exact source/target/artifact, provider recovery point, RPO/RTO, signer와 immutable anchor를 묶는 trusted rehearsal producer가 없으므로 `rehearsalStatus=verified-v1`, production `status=verified-v1`, authenticity `status=verified-v1` 선언을 모두 거부한다. 필드를 수동으로 채워도 운영 복구 준비로 승격되지 않는다.

cron 복구는 launcher off·running 0에서 다섯 job을 inactive로 재생하고, DB/Storage/post-deploy/parity/RTO가 같은 restore-attempt·artifact·source·target SHA-256 chain에 묶이는 [Recovery artifact contract](./SUPABASE_RECOVERY_ARTIFACT_CONTRACT.md)를 따른다. 다만 현재 chain은 실제 cron activation·post-activation contract·restored-service canary와 provider recovery-point 기반 RPO까지 완성하지 못했다. export/diff/query도 mutable `--linked`를 사용하므로 fence의 명시적 project-ref DB query와 같은 대상·role이라는 증거가 없다. `restore-verify`는 DB/Storage restore나 cron activation을 실행하지 않고 `RESTORE_EXECUTION_NOT_ENABLED`, modeled evidence를 합성해도 `RESTORE_COMPLETION_ATTESTATION_NOT_ENABLED`로 중단한다. 운영 export 역시 live fence snapshot·provider lease·자동 black-box evidence와 암호학적으로 결합되기 전까지 hard-stop한다. 현재 머신에는 `age`가 없고 운영 tool path/hash·recipient·restore allowlist도 비어 있다. 따라서 `backupPolicy.rehearsalStatus`와 `backupPolicy.status`를 모두 `not_configured`로 유지한다.

공식 기준: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

### 5. migration — 현재 production 실행 금지

core baseline history 누락이면서 exact catalog gate가 통과한 경우에만 먼저 전용 reconcile을 수행한다.

```powershell
corepack pnpm supabase:baseline:core -- -ExpectedProjectRef <production-ref>
```

그 뒤 dry-run이 검토한 pending suffix와 정확히 같을 때만 guarded ship을 실행한다.

```powershell
corepack pnpm supabase:ship:safe -- `
  -ExpectedProjectRef <production-ref> `
  -BackupRef <verified-backup-id> `
  -MaintenanceModeActive `
  -TrafficDrained `
  -MaintenanceAuthorizedUntilUtc <UTC-within-30m>
```

현재 ship과 baseline reconcile은 production/non-production 모두 credential prompt 전에 hard-stop한다. write-fence는 repo-local clean filter의 arbitrary process 실행과 과거 snapshot의 cross-version HEAD 역설이 재현됐으므로 **모든 remote action을 companion file·credential·journal·Git·remote boundary 전에 중단**한다. 이 컴퓨터의 canonical journal root에는 JSON snapshot과 lifecycle lock이 각각 0개였다. Help, write-fence `Plan`, credential-free isolated contract test만 허용하며 운영 dispatcher는 없다. MarkMigrationStarted/Verified action도 제거했다. 모델이 읽는 release-target policy와 status SQL은 launcher의 LF-stable SHA-256에 고정하고 검증한 같은 UTF-8 내용을 process 안에서 사용한다. 운영 entrypoint는 dot-source를 거부한다. filter-free worktree attestation, process 내부 system-module bootstrap, provider lease, signed cross-version recovery receipt와 disposable rehearsal이 독립 검토되기 전에는 hard-stop을 삭제하거나 fuse만 바꾸지 않는다. 실패 후 수동 SQL로 이어서 적용하지 않는다.

### 6. exact-SHA normal staged 배포와 fence 해제

자동 evidence producer가 post-deploy DB contract, migration dry-run 0개, Data API/Auth/Storage write denial, release writer, anon denial을 같은 fence ID와 SHA에 묶어야 한다. 현재는 이를 수용하는 trusted coordinator와 signed receipt가 없으므로 normal deployment를 custom domain에 연결하지 않는다.

trusted controller가 Vercel Production 환경 snapshot을 `MAINTENANCE_MODE=false`와 승인된 `NEXT_PUBLIC_LAUNCH_MODE=<coming_soon-or-full>`로 갱신한다. `MAINTENANCE_STARTED_AT_UTC`는 빈 문자열로 덮지 말고 Production 환경에서 **삭제**해 normal health가 `null`을 반환하게 한다. 이미 만들어 둔 immutable `$MaintenanceUrl`은 자신의 환경 snapshot을 유지하지만, 새 maintenance 배포가 필요하면 현재 UTC를 다시 넣어 새 deployment를 만든다. `full` 공개에서는 다른 경계와 재사용하지 않은 32자 이상 `DEMO_SESSION_SECRET`이 Production snapshot에 있어야 하며 demo login smoke를 생략하지 않는다. 연구 접수·계정 삭제 cron은 각각의 별도 운영 gate가 통과하지 않았다면 계속 `false`다. controller는 변수 이름·target·삭제 시각·redacted digest를 기록하고 create 직전 재확인한 같은 `$ReviewedSha`로 normal 후보를 staged해 provider identity를 확인한다. 로컬 CLI는 이 작업을 수행하지 않는다.

`$NormalUrl`의 health가 `$ReviewedSha`, protected Supabase ref, `maintenance=false`, 승인된 연구 접수·삭제 cron 상태를 반환해야 한다. 선택한 launch mode에 맞춰 아래 둘 중 정확히 하나의 live smoke를 staged URL에서 실행하고, 아직 fence가 활성인 동안 쓰기 거부가 유지되는지도 확인한다.

```powershell
# coming_soon을 유지하는 경우
node ./scripts/live-smoke-test.mjs --base-url=$NormalUrl --launch-mode=coming_soon --research-intake=closed --account-deletion-cron=closed --expected-sha=$ReviewedSha --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>

# 별도 사업·운영 승인을 받아 full을 공개하는 경우
node ./scripts/live-smoke-test.mjs --base-url=$NormalUrl --launch-mode=full --research-intake=<closed-or-open> --account-deletion-cron=<closed-or-open> --expected-sha=$ReviewedSha --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>
```

staged deployment ID·SHA·환경 계약 중 하나라도 다르면 fence를 해제하지 않는다.

signed post-migration evidence와 exact restore 전제의 독립 확인 뒤에만 Storage retirement를 별도 공식 API 단계로 실행한다. 이때도 DB write fence는 유지한다. 공개 key를 재활성화해야 한다면 기존 모바일·오래 열린 세션이 즉시 접근할 수 있으므로 fence가 활성인 상태에서만 수행하고, `$NormalUrl`에서는 거부 경계와 read-only identity만 먼저 확인한다. controller는 promote 직전 `main` HEAD·승인·fence receipt를 다시 확인하고 같은 normal deployment ID만 production domain에 승격한다. alias API의 deployment ID와 `hanbang.ai` health의 SHA·Supabase ref가 각각 정확히 일치하기 전에는 fence를 해제하지 않는다.

승격 뒤에도 write fence를 유지한 채 `hanbang.ai`의 domain alias가 같은 normal ID를 가리키는지와 health identity를 먼저 확인한다. 그 확인이 통과한 뒤에만 fence를 해제하고, legacy/publishable key의 정상·거부 probe와 canary를 처음부터 다시 실행한다. 실패하면 **먼저 write fence를 복구한 뒤** 같은 exact SHA의 `$MaintenanceUrl`을 promote한다. 새 임시 deployment를 즉석에서 만들거나 과거 gate 없는 deployment로 돌리지 않는다.

### 7. canary

출시 전 `coming_soon` 배포는 exact SHA를 지정한 전용 canary를 먼저 통과해야 한다. 이 검사는 공개 allowlist, 로그인·앱 리다이렉트, UTM 정리, 일반 API 503, signed-app association 200, health deployment SHA를 함께 확인한다.

```powershell
node ./scripts/live-smoke-test.mjs --base-url=https://hanbang.ai --launch-mode=coming_soon --research-intake=closed --account-deletion-cron=closed --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>
```

`full` 공개 후에도 같은 identity binding을 생략하지 않는다. 실제 배포된 연구 접수와 계정 삭제 cron 상태를 명시한다.

```powershell
node ./scripts/live-smoke-test.mjs --base-url=https://hanbang.ai --launch-mode=full --research-intake=<closed-or-open> --account-deletion-cron=<closed-or-open> --expected-sha=<40-char-sha> --expected-supabase-project-ref=<20-char-production-ref> --apple-team-id=<signed-team-id> --play-signing-sha256=<play-app-signing-sha256>
```

원격 `full`과 `coming_soon`은 모두 exact 40-character SHA와 exact 20-character Supabase project ref가 없으면 실패해야 한다. `--allow-unbound-local` 예외는 `localhost`, `127.0.0.1`, `::1` 개발 환경에서만 허용되며 Vercel preview, production, LAN 주소에는 사용할 수 없다.

Apple/Play 서명 식별자가 없어 association 경로가 503이면 실패가 정상이며 운영 공개를 진행하지 않는다.
이 자동 canary는 개인정보 행을 만들지 않는다. 실제 `/api/preregister`·Turnstile·Resend 전달·2시간 서명 fragment 링크·주소창 fragment 즉시 제거·사람의 명시적 버튼 클릭 전 GET 무변경·same-origin POST·token-free 결과 URL·`email_verified_at` 전이·재발송·테스트 행 삭제는 운영자가 소유한 전용 이메일, 테스트 행 보유·삭제 승인, DB 확인·정리 증거를 같은 SHA에 별도로 남겨야 한다. Vercel/CDN 요청 로그에 capability가 없고 Resend가 링크를 tracking URL로 재작성하지 않았다는 증거도 함께 남긴다. 그 증거가 없으면 사용자 연구 접수도 GO로 판정하지 않는다.

최소 10분 동안 다음을 반복 확인한다.

- `/wedding`, 로그인, WeddingCode, 커플 재연결
- Amora Luna 일반 응답과 Terra 승격, replay/idempotency, 비용 원장
- 예산·일정 저장과 권한 없는 DB/Storage 접근 거부. 이번 release에서 hard-disabled인 새 업체 예약·문의·결과·공개 후기 쓰기는 503/no-write이고 과거 기록 조회만 가능한지 확인한다. 실제 업체 write 재개는 전달·상태 왕복·연락처 철회·운영 책임이 승인된 별도 제품 gate 뒤에만 한다.
- 계정 삭제 queue/cron, 5xx, console error, latency, OpenAI 비용
- 최신 모바일과 마지막 배포 모바일의 핵심 여정

데이터 손실·권한 우회·비밀 노출·결제/삭제 오작동·사이트 전체 장애 같은 critical은 한 번만 관측돼도 즉시 maintenance와 write fence를 다시 켜고 아래 rollback matrix를 따른다. 네트워크 순간 오류나 latency처럼 변동성이 큰 high 신호만 사전에 정한 횟수·시간창 기준으로 재확인한다.

## rollback matrix

| 시점 | 조치 | 금지 |
|---|---|---|
| DB push 전 | fence를 원상복구하고 사전에 canary한 launch-gate rollback anchor로 되돌린 뒤 공개 경계를 재확인 | 과거 gate 없는 deployment로 Instant Rollback, migration history 변경 |
| baseline history만 reconcile 후 | catalog는 바뀌지 않았으므로 원인을 조사하고 release 중단. history를 임의 삭제하지 않음 | `migration repair`로 숨기기 |
| DB push 중/직후, 앱 미검증 | maintenance와 fence 유지, 현재 DB·Storage 증거 보존, 승인된 recovery point로 restore 또는 새 프로젝트 복구 | Vercel 롤백만 하고 서비스 재개 |
| 새 웹 공개 후 | 새 DB의 중앙 account-deletion completion과 expand schema에 호환되고 launch gate를 포함한다고 canary한 anchor에만 rollback. 그 외에는 maintenance 호환 hotfix를 새로 배포 | 과거 gate 없는 deployment로 Instant Rollback, 환경변수도 자동 복구됐다고 가정 |
| 모바일 rollout 후 | Store rollout 중지/단계 배포 중단. 서버에서 최소 지원 버전을 올리는 결정은 별도 승인 | 이미 설치된 binary를 원격 삭제할 수 있다고 가정 |

Vercel Instant Rollback은 코드 deployment를 바꾸지만 DB나 이후 변경된 환경 변수를 되돌리지 않는다. 현재 gate 없는 과거 production deployment는 명시적으로 **rollback 금지**다. 공식 기준: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback), [Vercel CLI rollback](https://vercel.com/docs/cli/rollback)

EAS production binary는 `production` update channel에 고정한다. 다만 실제 OTA publish·rollback rehearsal 전에는 이를 검증된 복구 경로로 간주하지 않는다. signed build와 store submit을 분리하고, build artifact·signing certificate·store rollout 상태를 release evidence에 남긴다.

## 복구 실행 전 최종 승인

in-place physical/PITR restore는 운영 DB를 선택한 과거 시점으로 되돌리고 downtime과 데이터 손실을 만들 수 있는 파괴적 작업이다. 다음을 한 화면에 모아 책임자가 승인한 뒤에만 실행한다.

- 장애 시작·마지막 정상 쓰기·migration 시작 UTC
- 선택한 recovery target과 예상 RPO
- DB/Storage에서 잃게 될 쓰기 범위
- 현재 DB와 Storage forensic export 위치
- 예상 RTO와 사용자 공지
- restore 뒤 사용할 Vercel deployment와 환경 변수 snapshot

restore 완료는 서비스 완료가 아니다. exact DB contract, Storage inventory, 인증, 사용자 여정, canary를 다시 통과해야 한다.

## release evidence 템플릿

```text
PR / candidate SHA / merge method / merge commit / post-merge release SHA:
Candidate exact-SHA CI / test / lint / typecheck / production build / dependency audit:
Post-merge exact-SHA CI / test / lint / typecheck / production build / dependency audit:
Release-control repository / protected environment / exact-SHA push CI run IDs:
Signed staged/promoted receipt digest / attester / controller run ID:
Vercel CLI or API version / allowlisted team / project / GitHub repository ID:
Vercel automation-bypass consumer inventory / new-secret rollout / old-secret denial / usage review:
Live smoke expected SHA / expected Supabase project ref:
Launch-gate anchor staged URL / deployment ID / env snapshot / promoted UTC / canary:
Maintenance staged URL / deployment ID / env snapshot / promoted UTC / canary:
Normal staged URL / deployment ID / env snapshot / promoted UTC / canary:
Kakao rotation / restriction / old-key denial / usage review / history decision:
OpenAI old-key revocation / denial / usage review / Production new-key target / Luna+Terra exact-SHA canary:
Resend domain / click-tracking disabled evidence / delivery canary:
Hosted Auth config attestation / general password policy / admin 12-char lifecycle:
Public Auth email boundary approved mode / attester / black-box evidence:
Canonical site URL / redirect allow-list / JWT-refresh-OTP-rate-limit attestation:
Visible OAuth flags / hosted providers / redirect round-trip or disabled evidence:
Turnstile credential target / apex hostname / four actions / negative-action-hostname / replay-expiry evidence:
Demo session secret configured for full (boolean only) / demo canary:
Supabase ref / Postgres version:
Write-fence method and black-box probe results:
Drain completed UTC:
Backup or PITR recovery target:
Restore rehearsal project / RPO / RTO:
Storage inventory/export:
Baseline reconcile result:
Pending migrations and rewrite/delete inventory approval:
Post-deploy contract:
Web canary:
EAS build IDs / profile / gitCommitHash / iOS build number / Android versionCode:
iOS signing certificate + Team ID / Play App Signing fingerprint evidence:
Store artifact review / phased-rollout owner and percentage / rollback artifact ID:
Latest and previous mobile binary canary:
Research selection owner / criteria / decision deadline / notification SLA:
Rollback owner and decision deadline:
```
