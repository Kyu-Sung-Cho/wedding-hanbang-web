# 웹 출시 후보와 모바일 호환성 — 2026-09-29

대상: `codex/web-prelaunch-audit`, 기준 HEAD `4216fddad09f8fbfd4ff75399adc6b9b36f2651f` 이후 작업트리 변경. 기존 변경을 보존한 상태에서 모바일 설정, 변경된 웹 API 18개, 모바일 소비처와 WebView 브리지를 확인했다. 이 문서는 앱 배포·DB 적용·전체 출시 승인서가 아니다.

실제 운영 DB·웹 기준과 출시 준비 조건은 [웹 출시 후보 준비](WEB_RELEASE_PREPARATION_2026-09-29.md)를 함께 본다. 이 문서는 모바일 소스 호환성에 한정하며 그 문서의 운영 조회 결과를 자체 실행한 증거로 취급하지 않는다.

**판정:** 이번 서버·웹은 기존 앱과 완전히 호환되지 않는다. 구버전 초기화 요청은 409로 안전 차단한다. 구 native WebView에서는 개인 가격 API의 조회와 변경을 모두 전송 전에 차단하고 기존 오류 영역에 앱 업데이트 확인 및 웹브라우저 `hanbang.ai` 이용 대안을 표시한다. 공개 가격 목록은 유지한다. 새 모바일 소스의 로컬 회귀는 통과했지만, 설치 가능한 최신 앱·실제 배포 버전·OTA 수신 상태는 **미확인**이다. 현재 저장소의 모바일 production build/submit gate도 닫혀 있다.

표기: **E** 이번 작업에서 소스·명령·테스트로 확인, **S** 읽은 공식 문서의 계약, **I** E/S에 따른 배포 영향 추론. 과거 문서에 기록된 운영 관측은 해당 날짜의 기록이며 현재 원격 상태로 재인증하지 않았다.

## 1. 소스 설정과 실제 배포 상태의 구분

| 항목 | 확인 결과 | 근거·한계 |
|---|---|---|
| 앱 식별자 | Expo `@hanbang/wedding-hanbang`, iOS/Android `ai.hanbang.wedding` | E: `apps/mobile/app.json` |
| 표시 버전 | 소스 `expo.version = 1.0.0` | E: 설정값이다. 현재 사용자가 설치한 버전을 뜻하지 않는다. |
| 빌드 번호 | `appVersionSource: remote`, production `autoIncrement: true`; 로컬 `versionCode`/`buildNumber` 없음 | E: `apps/mobile/eas.json`, `app.json`. 현재 원격 번호나 다음 번호를 추정하지 않는다. |
| OTA runtime | `runtimeVersion.policy = appVersion`; 이 소스의 앱 버전은 `1.0.0` | E: `app.json`. 같은 문자열만으로 모든 과거 binary와 현재 JS의 네이티브 의존성 호환을 보장하지 않는다. |
| OTA 연결 | EAS project `3a978bf3-21b8-4731-abc2-956dc8a27859`, update URL `https://u.expo.dev/3a978bf3-21b8-4731-abc2-956dc8a27859` | E: 소스에 연결값 존재. 실제 channel→branch 매핑과 배포 update ID·수신 상태는 미확인. |
| EAS 프로필 | development/preview/production 채널·환경 각각 분리. preview 내부 APK, production Android AAB | E: `eas.json`. 프로필 존재와 해당 프로필의 최근 성공 빌드는 별개다. |
| 빌드 재현 조건 | EAS CLI `21.0.2`, Node `22.13.0`, pnpm `11.7.0`, `requireCommit: true` | E: `eas.json`, `scripts/mobile-eas-release-gate.mjs`. 모바일 배포 시 검증된 후보 commit을 고정해야 하며 로컬 commit만으로 배포 승인이 되지 않는다. |
| 앱 내 버전 표시 | `Application.nativeApplicationVersion`, `nativeBuildVersion` 우선 | E: `apps/mobile/app/(tabs)/profile.tsx`. 실제 기기값은 이번 작업에서 읽지 않았다. |
| OTA 서명 설정 | 이 작업트리 `app.json`에 `codeSigningCertificate`/`codeSigningMetadata` 없음 | E: 현재 소스만의 관측. 이미 배포된 binary의 서명 설정·키 보관 상태를 단정하지 않는다. |
| 앱 배포 게이트 | production build/submit은 `MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED`; wrapper의 `update` 명령은 `MOBILE_EAS_COMMAND_INVALID` | E: provider를 대역 함수로 바꾼 로컬 호출에서 모두 거절, 실제 provider 호출 0. gate 우회 또는 raw EAS 명령을 실행하지 않았다. |

S: Expo는 OTA와 binary의 native runtime이 호환되어야 한다고 명시한다. `appVersion` 정책에서는 native runtime이 바뀌었을 때 앱 버전을 올리지 않으면 같은 runtime 값에 비호환 업데이트가 배포될 수 있다. 이번 브리지 변경이 JS여도 과거 binary와 **현재 전체 앱 번들**의 호환성을 따로 확인해야 한다. [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/), [Expo update deployment](https://docs.expo.dev/eas-update/deployment/).

S: EAS Update 서명은 인증서·서명 메타데이터 및 해당 설정을 포함하는 binary의 검증과 연결된다. 이번 작업에서는 키·인증서·배포 서명을 만들거나 계정 설정을 바꾸지 않았다. [Expo update code signing](https://docs.expo.dev/eas-update/code-signing/).

### 과거 증거가 증명하는 범위

- E(문서 읽기): `docs/evidence/AMORA_WEB_ANDROID_RELEASE_2026-07-15.md`는 `bd879a74668d24695b101307224f4d44b08abc7a`의 Android production AAB, EAS build ID `e6cc6b8f-a377-4aba-8e83-5a9c509cd229`, 앱 `1.0.0`/`versionCode 2`의 성공 기록이다. 문서 자체가 superseded historical receipt라고 명시한다. **Play 제출·공개·현재 설치 수를 증명하지 않는다.**
- E(문서 읽기): `docs/MOBILE_APP_STORE_RELEASE_CHECKLIST_2026-06-30.md`의 2026-07-19 갱신본은 2026-07-17 당시 remote version baseline Android `4`/iOS `1`을 기록한다. 이는 현재 원격 빌드 번호가 아니며, 거기서 예측한 다음 번호도 현재 사실로 사용하지 않는다.
- E(문서 읽기): `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`는 그 후보의 모바일을 `NOT RELEASED`로 기록한다. 이후 배포가 없었다는 증거는 아니다.
- **미확인:** 현재 EAS 최신 signed build/commit, Google Play 각 track의 배포 버전·비율, TestFlight/App Store 공개 여부, 설치된 binary의 runtime, 활성 OTA branch/update ID, 해당 소스가 실사용자에게 전달됐는지. 계정 로그인 변경이나 원격 배포 조회를 실행하지 않았다.

따라서 "구앱이 이미 공개됐다"와 "아무도 구앱을 쓰지 않는다"를 모두 주장하지 않는다.

## 2. 이번 API 변경의 구버전 영향

E: 기준 HEAD와 작업트리에서 변경된 `apps/web/src/app/api/**/route.ts` 18개를 대조하고, 아래 신규 소유자 필드·헤더의 모든 소비처를 검색했다. 아래 표는 이번 diff의 범위이며 저장소의 모든 과거 API 계약에 대한 일괄 호환 인증은 아니다.

| API | 이번 계약·응답 변경 | 구버전/배포 영향 |
|---|---|---|
| `POST /api/couple/reset` | `expectedUserId`, `expectedCoupleId` 자체 필드 필수. 후자는 명시적 `null` 허용. 현재 인증 UID 및 커플을 checked RPC에서 검증 | Cookie/Bearer 모두 적용. `confirmText`만 보내는 예전 앱·웹 탭은 409, RPC 0. 누락에는 새로고침/앱 업데이트 안내, 필드가 있으나 불일치하면 기존 계정·커플 변경 안내. legacy RPC fallback 없음. |
| `DELETE /api/auth/delete` | Cookie는 body `expectedOwnerId` 필수. Bearer는 생략 시 기존 호환, 명시 시 UID 일치 필수 | 이번 HEAD의 예전 native Bearer 요청 형식은 유지된다. 구 웹 탭 Cookie 요청은 409. 접수 flag가 닫힌 경우 기존 503 게이트가 앞서 적용된다. |
| `/api/favorites` GET/POST/DELETE | GET `ownerUserId` 추가. Cookie mutation에 `X-Price-Expected-Owner` 필수; Bearer 생략 호환·명시값 검증 | 예전 응답 소비자는 기존 `vendorIds`를 그대로 받는다. 구 웹 탭 mutation은 409. 새 웹→구 native bridge 문제는 HTTP 서버에 도달하기 전에 발생하므로 아래 별도 대책이 필요하다. |
| `/api/price/combos` GET/POST | GET `ownerUserId` 추가, mutation owner 헤더 정책은 위와 동일 | 기존 `{combos}` 응답 필드 유지. 구 Cookie 저장 409. Bearer의 헤더 생략 호환은 owner 헤더를 제거해도 된다는 허가가 아니다. |
| `/api/price/alerts` GET/POST/DELETE | GET `ownerUserId` 추가, mutation owner 헤더 정책은 위와 동일 | 형식 호환과 계정 경계를 분리했다. 공개 상세의 알림 토글은 현재 소스에서 비활성 상태이며 이번 작업으로 활성화하지 않는다. |
| `GET /api/auth/me` | 일시 auth/profile/journey 조회 실패 503, 커플 범위 변경 409. 정상 필드 유지 | 조회 장애를 로그아웃·온보딩 초기값으로 오인하지 않는다. 구 클라이언트의 일반 오류 처리와 재시도 경험은 실제 배포 binary에서 별도 확인 필요. |
| `/api/amora/memory`, `/api/auth/delete/support-proof`, `/api/chat/image-urls` | 일시 인증 장애 503 구분 | 이번 diff에 새로운 필수 owner 입력 없음. 정상 요청 shape 유지. |
| `/api/chat/messages`, `/api/chat` | 일시 인증 장애 503 및 민감 내용 공유 경계 강화. 과거 shared 민감 메시지의 shared 응답 재시도는 409 `SAFETY_PRIVATE_MESSAGE_REQUIRED` | 새로운 필수 owner 입력 없음. 구 앱에 공유 응답을 재생하는 fallback을 제공하지 않는다. 명시적인 새 개인 메시지 필요 안내가 서버 오류 응답에 포함된다. |
| `/api/community/cohort/auto-assign` | 가입/프로필/여정 조회 실패를 503 `lookup_failed`로 구분 | 기존 요청 body 유지. 조회 실패를 미가입으로 보고 재배정하지 않는다. |
| `/api/community/comments` | 작성자 삭제 부모 자리표시자 복원, 차단·운영 숨김은 제외 | 새 필수 입력 없음. 기존 `is_deleted`/`replies` 응답 구조 사용. |
| `/api/messages`, `/api/messages/threads` | private no-store, 조회 오류 처리, 신뢰 가능한 GET에서만 읽음 변경, HEAD 무변경 | 새 필수 입력 없음. Bearer 요청은 기존 trusted mutation 조건 유지. |
| `/api/price/vendor-options` | 페이지 끝까지 조회·상한 초과/오류 503 | 성공 shape 유지. 잘린 옵션을 빈 성공으로 캐시하지 않는다. |
| `/api/vendors/[id]/photos` | 조회·변경 실패 503, private no-store | 새 필수 입력 없음. 실패를 좋아요 변경 성공으로 표시하지 않는다. |
| `/api/health` | Cookie 없는 공개 client와 5초 timeout | 모바일 소유자 계약 변화 없음. 건강 응답은 앱 배포 버전 확인을 대체하지 않는다. |

E: 새 native `apps/mobile/app/settings/index.tsx`는 확인 시점의 user/couple snapshot을 보내고 응답 후에도 같은 계정·커플인지 검사한다. `apps/mobile/src/lib/api.ts`의 Bearer UID 검사도 별도로 유지한다. 새 웹 설정도 같은 확인 필드를 보낸다. `/api/auth/delete`의 새 native 소비자는 `expectedOwnerId`를 보낸다.

## 3. 재현한 WebView 불일치와 수정

E: 기준 HEAD의 `apps/mobile/src/lib/mobileWebApiBridge.mjs`를 메모리로 읽어 현재 요청과 대조했다. 기존 `content-type`만 가진 요청은 통과했고, `X-Price-Expected-Owner`를 추가한 요청은 parser가 `null`을 반환했다. 당시 `webview.tsx`는 `null`이면 응답 없이 끝내므로 새 웹 helper가 15초 후 timeout에 도달한다. 실제 설치된 구앱에서의 발생 증거는 없으며 **코드 조합의 재현**이다.

수정:

1. 새 native는 `__HANBANG_MOBILE_API_OWNER_SCOPE_V1__` 지원 표시를 현재 문서 nonce와 같은 값으로 top document에 불변 주입한다. 토큰은 주입하지 않는다.
2. 웹 helper는 nonce와 같은 지원 표시가 없으면 개인 API GET·POST·DELETE를 **postMessage/fetch 호출 0**으로 즉시 거절한다. 헤더 제거·Cookie fallback·다른 계정 재전송은 없다.
3. PriceExplorer, PriceWishlist, VendorDetailActions는 기존 오류 영역에 "앱을 최신 버전으로 업데이트할 수 있는지 확인"과 "그전에는 웹브라우저에서 hanbang.ai 이용"을 표시한다. 설치 가능한 업데이트가 존재한다고 단정하지 않는다.
4. 일반 브라우저는 기존 fetch, 지원되는 새 native는 기존 nonce·owner 헤더·계정 epoch 경로를 사용한다. 공개 카탈로그는 bridge 대상이 아니므로 유지한다.

**호환성 제한:** 지원 표시가 없는 앱은 최신 웹에서 찜·저장 조합의 조회·복원·저장이 모두 비활성화된다. 초기 조회까지 차단한 이유는 예전 native에 계정 변경 때 문서·요청을 폐기하는 경계도 없기 때문이다. 서버의 headerless Bearer 호환만 믿고 새 웹의 보호를 약화하지 않는다. 이 제한의 해소는 새 코드가 실제 설치/수신됐다는 증거가 있어야 판정할 수 있다.

## 4. 안전한 배포 순서와 확인 조건

1. **수정본 고정:** 웹·모바일·DB 계약과 최종 검증을 같은 릴리스 소스에 묶는다. 작업트리 테스트 성공을 signed build 또는 배포 성공으로 바꾸어 쓰지 않는다.
2. **현재 앱 관측:** 기존 계정으로 확인 가능한 범위에서 EAS build ID/commit/platform/runtime/channel, Play/App Store track·배포 상태, OTA update ID를 읽어야 한다. 이번 문서는 이 칸을 미확인으로 남긴다. 구앱 사용자가 없다는 가정으로 생략하지 않는다.
3. **DB 확장 먼저:** `reset_expected_couple_membership(uuid,uuid)`를 추가하는 241번째 SQL은 기존 `reset_current_couple_membership()`을 유지한다. 실제 적용은 별도 DB gate·대상 identity·backup/rollback 증거와 단일 트랜잭션 조건을 충족한 뒤 진행한다. 새 웹이 먼저 실행되고 RPC가 없으면 초기화는 503으로 멈춘다. unchecked RPC로 대체하지 않는다.
4. **모바일 전달 경로 확인:** 새 native bridge/계정 epoch/확인 snapshot을 포함하는 signed binary 또는 호환성이 입증된 OTA 후보를 준비한다. 현재 production EAS gate가 닫혀 있으므로 단순히 명령을 우회해 업데이트하지 않는다. OTA를 고를 경우 실제 설치 binary의 native 의존성·runtime·channel·서명 정책·rollback을 먼저 입증해야 한다. 같은 `1.0.0` 값만으로 OTA 가능 판정을 하지 않는다.
5. **웹/API 전환:** 가능하면 호환 모바일이 전달된 뒤 새 웹/API를 전환한다. 안전상 웹을 먼저 전환해야 한다면 구앱 개인 가격 기능 차단과 초기화 409가 남는다는 운영 제한을 명시하고, 사용 가능한 웹 대안을 알린다. 구 웹 탭도 다시 로드하기 전 Cookie mutation이 409가 될 수 있다.
6. **배포 후 대조:** 실제 배포 commit/RPC signature·ACL과 설치된 앱 build/runtime/update를 함께 확인한다. 일반 브라우저·새 native·업데이트 미적용 앱을 나누어 공개 가격 읽기, 개인 조회, 저장, A→B/로그아웃, 초기화 stale snapshot 거절을 확인한다. 실사용자 데이터로 파괴적 초기화 시험을 하지 않는다.

이 문서에서는 DB 적용, EAS cloud build/submit/update, 계정 로그인 변경, signing key 생성, 새 프로젝트 생성, 실제 사용자 시험을 실행하지 않았다. 실제 mobile release와 운영 DB 승인은 각 gate에서 별도 증명해야 한다.

## 5. 로컬 검증

- E: capability 미지원/다른 문서 상태가 요청을 전송하는 RED 2건을 먼저 확인했다.
- E: 웹 helper 및 실제 가격 컴포넌트 4파일 **59개 통과**. 일반 브라우저 fetch, 지원되는 native owner 헤더 전달, 구native GET 및 5종 mutation 전송 0, 업데이트·브라우저 대안 표시, 공개 카탈로그 유지 포함.
- E: native bridge/실제 WebView TSX 2파일 **29개 통과**. nonce 결합·top-frame 주입·반복 주입·불변 property, 계정 A→B/A→null/A→B→A·늦은 응답·세션 경합 포함.
- E: production build/submit/update wrapper의 로컬 대역 probe에서 원격 provider 호출 **0**으로 거절됨을 확인했다.
- E: 웹 `tsc --noEmit --incremental false`, 모바일 typecheck 및 이번 변경 파일의 웹·모바일 ESLint가 모두 exit 0이다. `git diff --check`도 통과했다.
- E: 세 가격 컴포넌트에서 구 native의 초기 GET 거절이 기존 오류 영역으로 전달됨을 실제 컴포넌트 회귀로 확인했다. native는 브라우저 auth 구독을 기다리지 않고, 각 조회 catch가 loading을 error로 바꾼다. capability 실패는 타이머·응답 listener·postMessage를 만들기 전에 끝나므로 15초 timeout을 기다리지 않는다.

검증 산출물: `C:/Users/kcho1/.codex/visualizations/web-five-pass-20260928/release-mobile-compat-{web,native,web-typecheck,native-typecheck,web-lint,native-lint}.log`.

**남은 확인:** 실제 구/신 native binary·OTA 수신, 기기 WebView에서 capability 주입 시점, 실제 EAS/스토어 버전, production mobile gate와 DB runtime gate의 운영 증거. 이번 DOM/TSX 대역 테스트는 이를 대체하지 않는다.
