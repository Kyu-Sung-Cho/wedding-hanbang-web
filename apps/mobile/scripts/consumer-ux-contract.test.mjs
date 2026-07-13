import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(mobileRoot, relativePath), "utf8");
}

test("root bundle includes only Paperlogy weights referenced by runtime aliases", () => {
  const source = readSource("app/_layout.tsx");

  for (const weight of ["3Light", "4Regular", "5Medium", "6SemiBold", "7Bold"]) {
    assert.match(source, new RegExp(`Paperlogy-${weight}\\.ttf`));
  }
  for (const unusedWeight of ["1Thin", "2ExtraLight", "8ExtraBold", "9Black"]) {
    assert.doesNotMatch(source, new RegExp(`Paperlogy-${unusedWeight}\\.ttf`));
  }
});

test("dashboard partner activity affordance opens the schedule", () => {
  const source = readSource("app/(tabs)/dashboard.tsx");
  const banner = source.match(/\{data\?\.partnerActivity && \([\s\S]*?\n\s*\)\}/)?.[0] ?? "";

  assert.match(banner, /<Pressable/);
  assert.match(banner, /onPress=\{\(\) => router\.push\("\/schedule"\)\}/);
  assert.match(banner, /accessibilityRole="button"/);
  assert.match(banner, /<ChevronRight/);
});

test("profile app version is read-only and uses native binary metadata", () => {
  const profile = readSource("app/(tabs)/profile.tsx");
  const appUi = readSource("src/components/ui/AppUI.tsx");
  const versionRow = profile.match(/<MenuItem\s+icon=\{Info\}[\s\S]*?\/>/)?.[0] ?? "";

  assert.doesNotMatch(versionRow, /onPress=/);
  assert.match(versionRow, /hideChevron/);
  assert.match(profile, /Application\.nativeApplicationVersion/);
  assert.match(profile, /Application\.nativeBuildVersion/);
  assert.doesNotMatch(profile, /Constants\.expoConfig/);
  assert.match(appUi, /right === undefined \? <ChevronRight/);
});

test("profile reads only its private activity counters through a narrow RPC", () => {
  const profile = readSource("app/(tabs)/profile.tsx");

  assert.match(profile, /\.rpc\(\s*"get_my_community_activity_stats"\s*\)/);
  assert.match(profile, /activityStatsError \|\| bookmarkError/);
  assert.match(profile, /활동 통계를 불러오지 못했어요/);
  assert.match(profile, /0건으로 표시하지 않고 이전 값을 숨겼어요/);
  assert.match(profile, /활동 통계 다시 불러오기/);
  assert.doesNotMatch(
    profile,
    /\.from\("community_profiles"\)[\s\S]{0,160}post_count, comment_count/,
  );
});

test("image-only library pickers do not request broad media-library permissions", () => {
  const picker = readSource("src/components/ImagePickerButton.tsx");
  const postWriter = readSource("app/community/post/write.tsx");

  for (const source of [picker, postWriter]) {
    assert.match(source, /launchImageLibraryAsync/);
    assert.doesNotMatch(source, /requestMediaLibraryPermissionsAsync/);
    assert.doesNotMatch(source, /launchCameraAsync/);
  }
});

for (const [name, relativePath, retryMessage] of [
  ["budget", "app/budget/index.tsx", "예산 정보를 불러오지 못했어요"],
  ["schedule", "app/schedule/index.tsx", "체크리스트와 일정을 불러오지 못했어요"],
]) {
  test(`${name} distinguishes query failures from empty data`, () => {
    const source = readSource(relativePath);

    assert.match(source, /error: authError/);
    assert.match(source, /error: profileError/);
    assert.match(source, /error: journeyError/);
    assert.match(source, /setLoadError\(true\)/);
    assert.match(source, /loadError && !hasLoadedData/);
    assert.match(source, new RegExp(retryMessage));
    assert.match(source, /loadError && hasLoadedData/);
    assert.match(source, /최신 .*불러오지 못했어요/);
  });
}

test("vendor favorites never fail as a silent empty set", () => {
  const source = readSource("app/vendors/index.tsx");

  assert.match(source, /setFavoriteError\(true\)/);
  assert.match(source, /favoriteError && !loading && !error/);
  assert.match(source, /저장된 즐겨찾기를 불러오지 못했어요/);
  assert.match(source, /Alert\.alert\("즐겨찾기를 저장하지 못했어요"/);
});

test("vendor detail distinguishes missing, failed products, and failed slots", () => {
  const source = readSource("app/vendors/[id].tsx");

  assert.match(source, /setVendorError\(error\?\.code === "PGRST116" \? "not_found" : "load"\)/);
  assert.match(source, /업체 정보를 불러오지 못했어요/);
  assert.match(source, /저장된 정보가 삭제된 것은 아니에요/);
  assert.match(source, /setProductsError\(true\)/);
  assert.match(source, /상품 정보를 불러오지 못했어요/);
  assert.match(source, /setSlotsError\(true\)/);
  assert.match(source, /상담 요청 시간을 불러오지 못했어요/);
});

test("vendor availability uses the aggregate server boundary instead of partial RLS rows", () => {
  const source = readSource("app/vendors/[id].tsx");
  const availabilityLoader = source.match(
    /const loadAvailableSlots = useCallback[\s\S]*?\n {2}\}, \[id, selectedProduct\]\);/
  )?.[0] ?? "";

  assert.match(availabilityLoader, /\/availability\?/);
  assert.match(availabilityLoader, /availableHours/);
  assert.doesNotMatch(availabilityLoader, /\.from\("vendor_bookings"\)/);
});

test("vendor booking submission stays visibly hard disabled until a real vendor channel exists", () => {
  const vendor = readSource("app/vendors/[id].tsx");
  const bookings = readSource("app/bookings/index.tsx");
  const dashboard = readSource("app/(tabs)/dashboard.tsx");

  assert.match(vendor, /const BOOKING_REQUESTS_ENABLED = false/);
  assert.match(vendor, /disabled=\{!BOOKING_REQUESTS_ENABLED\}/);
  assert.match(vendor, /visible=\{BOOKING_REQUESTS_ENABLED && bookingVisible\}/);
  assert.match(vendor, /현재 상담 요청은 업체에 전송되지 않습니다/);
  assert.match(vendor, /과거 상담 요청 내역 보기/);

  assert.match(bookings, /과거·예시 요청 기록/);
  assert.match(bookings, /신규 상담 요청은 현재 받지 않아요/);
  assert.match(bookings, /const BOOKING_OUTCOMES_ENABLED = false/);
  assert.match(bookings, /BOOKING_OUTCOMES_ENABLED && completed/);
  assert.match(bookings, /결과 저장과 공개 후기도 현재 지원하지 않아요/);
  assert.doesNotMatch(bookings, /업체 상세에서 상담 날짜와 상품을 선택하면 예약이 여기에 모여요/);
  assert.doesNotMatch(bookings, /업체 탐색하기/);
  assert.match(dashboard, /const BOOKING_OUTCOMES_ENABLED = false/);
  assert.match(dashboard, /BOOKING_OUTCOMES_ENABLED && \(data\?\.bookingOutcomeTasks\?\.length \?\? 0\) > 0/);
});

test("vendor discovery labels registration data without promising verification or availability", () => {
  const vendors = readSource("app/vendors/index.tsx");
  const detail = readSource("app/vendors/[id].tsx");
  const profile = readSource("app/(tabs)/profile.tsx");

  assert.match(vendors, /품질, 최신 가격, 예약 가능 여부를 보증하지 않아요/);
  assert.match(vendors, /정보 많은 순/);
  assert.match(vendors, /등록 평점순/);
  assert.doesNotMatch(vendors, /추천순|인기순/);
  assert.doesNotMatch(vendors, /검증된 업체를 불러오고 있어요|>검증됨<|>검증</);
  assert.match(detail, /최신 가격, 예약 가능 여부를 보증하지 않아요/);
  assert.doesNotMatch(detail, /예약 확정 전 포함/);
  assert.match(profile, /label="문의 안내"/);
  assert.doesNotMatch(profile, /label="고객센터"/);
});

test("mobile onboarding copy distinguishes examples from real activity", () => {
  const guide = readSource("src/components/AppGuide.tsx");
  const login = readSource("app/(auth)/login.tsx");
  const dashboard = readSource("app/(tabs)/dashboard.tsx");

  assert.match(guide, /화면 예시 · 실제 사용자 데이터가 아닙니다/);
  assert.match(guide, /예시 사용자/);
  assert.doesNotMatch(guide, /멤버 248명/);
  assert.doesNotMatch(guide, /제주신부/);
  assert.doesNotMatch(guide, /결혼 준비의 모든 것/);
  assert.doesNotMatch(login, /동의하는 것으로 간주됩니다/);
  assert.match(login, /회원가입 전 이용약관과 개인정보처리방침/);
  assert.doesNotMatch(dashboard, /설레는 마음, 완벽한 준비/);
  assert.doesNotMatch(dashboard, /다음 업체 추천이 더 정확해져요/);
});

test("planning guidance avoids unsupported fixed savings and price ranges", () => {
  const checklists = readSource("src/constants/checklists.ts");
  const onboarding = readSource("app/onboarding/index.tsx");
  const budget = readSource("app/budget/index.tsx");

  assert.match(checklists, /노선·시기·수요와 변경 조건에 따라 달라집니다/);
  assert.match(checklists, /총액·설치비·보증·반품 조건을 함께 비교하세요/);
  assert.doesNotMatch(checklists, /항공권은 빨리 예약할수록 저렴합니다/);
  assert.doesNotMatch(checklists, /수백만원을 아낄 수 있습니다/);
  assert.match(onboarding, /예산을 어떻게 운영하고 싶나요\?/);
  assert.match(budget, /견적서에서 금액 확인/);
  assert.match(budget, /예약 조건에서 금액 확인/);
  assert.doesNotMatch(
    budget,
    /\+(?:5|10|20|30|50|100)~(?:20|30|50|80|100|150|200|300)만원/,
  );
});

test("Amora makes long generation honest, cancellable, and retryable", () => {
  const chat = readSource("app/(tabs)/chat.tsx");
  const timeout = readSource("src/lib/chatRequestTimeout.ts");

  assert.match(timeout, /MOBILE_CHAT_DELAY_NOTICE_MS = 9_000/);
  assert.match(timeout, /MOBILE_CHAT_TIMEOUT_MS = 120_000/);
  assert.match(timeout, /class MobileChatCancelledError/);
  assert.match(timeout, /code = "request_cancelled"/);
  assert.match(timeout, /externalSignal\.addEventListener\("abort"/);
  assert.match(timeout, /externalSignal\?\.removeEventListener\("abort"/);
  assert.match(timeout, /clearTimeout\(timeout\)/);

  assert.match(chat, /여러 정보를 확인하느라 평소보다 오래 걸리고 있어요\. 최대 2분까지만 기다릴게요/);
  assert.match(chat, /accessibilityLabel="아모라 답변 생성 중단"/);
  assert.match(chat, /accessibilityHint="작성 중인 답변만 중단하고 저장된 질문은 유지합니다"/);
  assert.match(chat, /activeRequest\.abort\(\)/);
  assert.match(chat, /질문은 저장되어 있어 언제든 다시 시도할 수 있어요/);
  assert.match(chat, /retry: "ai"/);
  assert.match(chat, /setPendingAiRequest\(null\)/);
  assert.doesNotMatch(chat, /wasCancelled[\s\S]{0,500}setPendingAiRequest\(null\)/);
});

test("settings reconciles replacement-couple requests before showing failure", () => {
  const source = readSource("app/settings/index.tsx");
  const unlockStart = source.indexOf("async function unlockLegacyInvite()");
  const recoveryStart = source.indexOf("async function recoverLegacyRelinkState()", unlockStart);
  const unlock = source.slice(unlockStart, recoveryStart);
  const recoveryEnd = source.indexOf("function confirmLegacyRelink()", recoveryStart);
  const recovery = source.slice(recoveryStart, recoveryEnd);

  assert.ok(unlockStart >= 0);
  assert.ok(recoveryStart > unlockStart);
  assert.match(unlock, /loadSettings\(\{ requireInviteState: true \}\)/);
  assert.match(unlock, /setInitialData\(null\);\s*setRelinkRecoveryRequired\(true\);/);
  assert.match(unlock, /observedFreshCouple/);
  assert.match(unlock, /observedOriginalCouple/);
  assert.match(unlock, /refreshedInviteState\.requiresRelinkConfirmation/);
  assert.match(unlock, /if \(observedFreshCouple\)/);
  assert.match(unlock, /else if \(observedOriginalCouple && requestError/);
  assert.doesNotMatch(unlock, /catch \(error\) \{\s*Alert\.alert/);

  assert.match(recovery, /if \(observedOriginalCouple\)/);
  assert.match(recovery, /setRelinkRecoveryRequired\(false\)/);
  assert.match(recovery, /이전 일정과 예산을 계속 수정할 수 있어요/);
});
