# Session Handoff - 2026-07-01 Mobile Expo QA

이 문서는 다른 컴퓨터에서 오늘 모바일 앱 작업을 바로 이어가기 위한 기록입니다.

## 현재 작업 범위

- 저장소: `wedding-hanbang-web`
- 작업 브랜치: `codex/community-weddingcode-foundation`
- 작업 대상: `@hanbang/mobile`
- 목적: Expo Go 실기기 확인 중 발견한 모바일 반응성, 커뮤니티 로딩, 아모라 스크롤, iOS 인증/개발 서버 문제 개선

## 오늘 해결한 문제

### 1. Expo Go 개발 서버 실행 안정화

파일:

- `apps/mobile/scripts/start-expo-dev.mjs`

변경:

- Windows에서 `expo.cmd`와 `shell: true` 조합으로 dev server 실행이 흔들릴 수 있는 부분을 줄였습니다.
- `@expo/cli/build/bin/cli`를 Node로 직접 실행하도록 바꿔 Expo dev server 시작을 안정화했습니다.

결과:

- Expo status endpoint가 정상 응답했습니다.
- iOS bundle 요청도 `status=200`으로 생성됐습니다.

### 2. Supabase Auth auto-refresh 오류 완화

파일:

- `apps/mobile/src/lib/authListener.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/src/lib/supabase.ts`

문제:

- Expo Go iOS에서 다음 오류가 콘솔에 뜰 수 있었습니다.

```text
Auto refresh tick failed with error...
getValueWithKeyAsync...
User interaction is not allowed.
```

변경:

- AppState 기반으로 Supabase auth auto-refresh를 앱 활성 상태에서만 시작하고, 백그라운드에서는 멈추게 했습니다.
- iOS SecureStore의 일시적 읽기 오류에는 메모리 세션 캐시를 fallback으로 사용하도록 했습니다.
- `_layout.tsx`에서 auth listener cleanup을 연결했습니다.

결과:

- 로그인 후 Expo Go에서 보이던 transient auth refresh 오류를 줄였습니다.

### 3. 체크리스트 체크/해제 즉시 반응

파일:

- `apps/mobile/app/schedule/index.tsx`

문제:

- 체크리스트 항목을 눌러도 실제 체크 표시와 취소선 반응이 늦게 보였습니다.
- 기존에는 `progress`만 먼저 바꾸고, 화면 렌더링에 쓰이는 `categories.items.done`은 서버 재조회 이후에 맞춰지는 구조였습니다.

변경:

- `applyChecklistState` helper를 추가했습니다.
- 체크/해제 시 `categories`와 `progress`를 동시에 optimistic update 합니다.
- 서버 저장 실패 시 이전 상태로 rollback합니다.
- 불필요한 전체 `loadData()` 재호출을 제거했습니다.
- 체크리스트 헤더와 항목의 최소 터치 높이를 키워 손가락 터치 안정성을 개선했습니다.

결과:

- 체크/해제 UI가 누르는 즉시 반응합니다.

### 4. 커뮤니티 목록 첫 로딩 개선

파일:

- `apps/mobile/app/(tabs)/community.tsx`
- `apps/mobile/src/lib/communityPostCache.ts`

문제:

- 커뮤니티 탭 진입 시 목록이 오래 비어 있거나 스켈레톤 상태가 길었습니다.
- 모바일 목록이 매번 웹 API `/api/community/posts`를 기다렸고, 해당 API는 count, 투표 상태, poll summary 등 목록 첫 화면에 과한 후처리를 포함했습니다.

변경:

- 모바일 목록은 우선 Supabase에서 필요한 필드만 직접 조회합니다.
- 실패 시 기존 웹 API로 fallback합니다.
- 초기 limit을 12개로 줄였습니다.
- 카테고리별 피드와 동기방 데이터를 메모리 캐시합니다.
- 동기방 membership과 rooms 조회를 병렬화했습니다.
- 목록에서 글을 누를 때 상세 화면용 post cache에 글 데이터를 저장합니다.
- 긴 닉네임이 카드 메타 줄을 깨지 않도록 `numberOfLines`와 폭 제한을 넣었습니다.

결과:

- 커뮤니티 탭 재진입과 카테고리 전환 체감 속도가 좋아졌습니다.
- 목록에서 상세로 들어갈 때 본문을 즉시 보여줄 수 있는 기반이 생겼습니다.

### 5. 커뮤니티 글 상세 버퍼링 개선

파일:

- `apps/mobile/app/community/post/[id].tsx`
- `apps/mobile/src/lib/communityPostCache.ts`

문제:

- 커뮤니티 글을 열 때 버퍼링이 길었습니다.
- 기존 상세 화면은 게시글 API를 기다린 뒤 댓글 API, 투표/북마크 상태를 순차적으로 확인했습니다.

변경:

- 목록에서 넘긴 post cache가 있으면 상세 화면 본문을 즉시 렌더링합니다.
- 상세 본문은 Supabase 직접 조회로 경량화하고, 실패 시 기존 웹 API로 fallback합니다.
- 댓글, 투표 상태, 북마크 상태는 본문 표시 후 병렬 또는 별도 로딩으로 처리합니다.
- 댓글 목록도 짧은 TTL 캐시를 사용합니다.
- 댓글 작성 후 전체 상세 재로딩 대신 댓글만 새로고침하고 댓글 수를 optimistic update 합니다.
- 댓글 입력바에 iPhone 하단 safe area 보정을 넣었습니다.

결과:

- 목록에서 글을 열 때 본문이 먼저 뜨고, 댓글은 뒤에서 따라붙는 구조가 됐습니다.

### 6. 아모라 채팅 초기 스크롤 이상 수정

파일:

- `apps/mobile/app/(tabs)/chat.tsx`

문제:

- 아모라에 들어가면 대화가 맨 위에서 시작해서 아래까지 쭉 내려가는 것처럼 보였습니다.
- 기존에는 `onContentSizeChange`와 메시지 길이 변화마다 `scrollToEnd({ animated: true })`가 반복 호출됐습니다.

변경:

- 초기 대화 이력 로딩 시에는 애니메이션 없이 즉시 맨 아래로 이동합니다.
- 새 메시지 송수신 때만 animated scroll을 사용합니다.
- 초기 로딩 화면을 추가해 빈 화면처럼 보이는 상태를 줄였습니다.
- `keyboardShouldPersistTaps="handled"`를 추가했습니다.

결과:

- 아모라 진입 시 위에서 아래로 주르륵 내려가는 느낌을 줄였습니다.

## 새로 추가된 공통 캐시

파일:

- `apps/mobile/src/lib/communityPostCache.ts`

역할:

- 커뮤니티 목록에서 상세로 넘어갈 때 post 데이터를 잠깐 보관합니다.
- 상세 화면에서 댓글 데이터를 짧게 보관합니다.
- 최종 데이터 저장소가 아니라 모바일 체감 속도를 위한 in-memory cache입니다.

TTL:

- post cache: 2분
- comment cache: 30초

## 검증 완료

반복 실행한 주요 검증:

```bash
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile lint
```

결과:

- mobile typecheck 통과
- mobile lint 통과
- Expo iOS bundle 요청 통과

최근 번들 확인:

```text
status=200
bytes=18671793
```

## 실기기에서 다시 확인할 것

Expo Go에서 `Reload JS` 후 아래 순서로 확인하세요.

1. 로그인 유지 확인
2. 체크리스트 항목 체크/해제 즉시 반응 확인
3. 커뮤니티 탭 진입 속도 확인
4. 커뮤니티 카테고리 전환 속도 확인
5. 커뮤니티 글 상세 진입 시 본문이 먼저 뜨는지 확인
6. 댓글 로딩과 댓글 작성 후 재로딩 체감 확인
7. 아모라 진입 시 대화가 위에서 아래로 길게 스크롤되지 않는지 확인
8. 아모라 새 메시지 전송 시에는 자연스럽게 하단으로 이동하는지 확인
9. iPhone 하단 홈 인디케이터 근처 댓글 입력바가 너무 붙지 않는지 확인

## 남은 리스크

- Supabase 직접 조회와 웹 API fallback이 같은 visibility 규칙을 유지하도록 계속 주의해야 합니다.
- 현재 캐시는 앱 메모리 캐시이므로 앱을 재시작하면 사라집니다. 이것은 의도된 동작입니다.
- 실제 네트워크가 느릴 때 상세 본문은 빨라졌지만 댓글/투표/북마크는 여전히 후속 로딩입니다.
- 디자인은 코드 기준으로 리스크를 줄였지만, 최종 판단은 실제 iPhone 화면 녹화와 손 터치 QA가 필요합니다.

## 다음 추천 작업

1. Expo Go 실기기 10분 QA
2. 문제 없으면 이 커밋 기준으로 모바일 UX 안정화 지점 고정
3. 다음 단계로 커뮤니티 글 작성/댓글 작성/좋아요/북마크의 실패 상태 UX 점검
4. 이후 앱스토어 준비 작업으로 EAS Build, TestFlight, privacy manifest, 앱 권한 문구 정리

## 빠른 재개 명령

```bash
git fetch origin
git checkout codex/community-weddingcode-foundation
git pull --ff-only origin codex/community-weddingcode-foundation
corepack pnpm install
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile lint
corepack pnpm --filter @hanbang/mobile dev
```

## Continuation - 2026-07-01 Community Detail Action UX

After restoring this branch on another machine, one extra mobile community detail polish was added.

File:

- `apps/mobile/app/community/post/[id].tsx`

What changed:

- Vote and bookmark taps now ignore repeat taps while the previous write is still syncing.
- Vote failure rolls back the optimistic count/state and shows an inline notice instead of silently reloading.
- Bookmark failure rolls back the optimistic state and shows an inline notice.
- Comment creation now checks `res.ok`; previously a non-2xx API response could be treated as success.
- Comment failure preserves the typed text and shows an inline notice, so the user can retry without losing context.

Verification after this continuation:

```bash
corepack pnpm --filter @hanbang/mobile typecheck
corepack pnpm --filter @hanbang/mobile lint
corepack pnpm qa:local
```

Result:

- Mobile typecheck passed.
- Mobile lint passed.
- `qa:local` passed.
- Web tests still pass: 31 files / 265 tests.

Recommended next check:

- Run the Expo Go real-device QA list above and specifically test failed/slow network behavior on vote, bookmark, and comment submit.

## Continuation - 2026-07-01 Expo SDK 54 Health

After production smoke QA, `expo-doctor` was run for the mobile app and found three native-build risks:

- Expo SDK 54 package mismatches, including `expo-apple-authentication`, `expo-device`, and `expo-notifications` installed at incompatible major versions.
- Duplicate native module dependencies caused by those mismatches.
- Metro config overriding Expo's default `watchFolders` and forcing `resolver.unstable_enableSymlinks = false`.

What changed:

- `apps/mobile/package.json` and `pnpm-lock.yaml` now pin Expo/RN native packages to the SDK 54 expected versions.
- `apps/mobile/metro.config.js` now preserves Expo's default monorepo watch folders and resolver paths, then adds the workspace root/cache store.

Verification:

```bash
corepack pnpm dlx expo-doctor
corepack pnpm qa:local
corepack pnpm qa:live
corepack pnpm supabase:security:probe
```

Result:

- `expo-doctor` passed: 18/18 checks.
- `qa:local` passed, including web tests: 31 files / 265 tests, web production build, mobile typecheck/lint, shared typecheck, design-token typecheck.
- `qa:live` passed: 5/5 production smoke checks on `https://hanbang.ai`.
- Supabase anonymous sensitive-table probe passed.

Remaining operational item:

- Supabase migration application still requires the production DB password in the active PowerShell session, then `corepack pnpm supabase:ship:safe`.

## Continuation - 2026-07-02 Production Dependency Audit

After the Expo SDK 54 health fix landed, a production dependency audit was run:

```bash
corepack pnpm audit --prod
```

It found transitive advisories from Expo/PostHog dependency paths:

- `ws <8.21.0`
- `undici <6.27.0`
- `tar <=7.5.15`
- `dompurify <=3.4.10`
- vulnerable `js-yaml` 3.x/4.x ranges
- `@babel/core <=7.29.0`

What changed:

- Root `pnpm.overrides` now pins those transitive dependencies to patched versions without changing app code.
- `pnpm-lock.yaml` was refreshed.

Verification after the override refresh:

```bash
corepack pnpm audit --prod
corepack pnpm qa:local
corepack pnpm dlx expo-doctor
corepack pnpm qa:live
corepack pnpm supabase:security:probe
```

Result:

- Production audit passed: no known vulnerabilities.
- `qa:local` passed.
- `expo-doctor` passed: 18/18 checks.
- `qa:live` passed: 5/5 production smoke checks on `https://hanbang.ai`.
- Supabase anonymous sensitive-table probe passed.
