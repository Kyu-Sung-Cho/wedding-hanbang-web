import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("root does not probe a third-party host for connectivity", () => {
  const root = readSource("app/_layout.tsx");

  assert.doesNotMatch(root, /OfflineBanner/);
});

test("the mobile bundle physically omits push permission, token, and default-on preference seams", () => {
  const root = readSource("app/_layout.tsx");
  const settings = readSource("app/settings/index.tsx");
  const appConfig = readSource("app.json");
  const packageJson = readSource("package.json");

  for (const source of [root, settings]) {
    assert.doesNotMatch(source, /pushNotifications|registerForPushNotifications|EXPO_PUBLIC_PUSH_NOTIFICATIONS_ENABLED/);
  }
  assert.doesNotMatch(settings, /NOTIF_PUSH_KEY|NOTIF_COMMUNITY_KEY|NOTIF_PARTNER_KEY/);
  assert.doesNotMatch(settings, /pushEnabled|communityNotifEnabled|partnerNotifEnabled/);
  assert.doesNotMatch(appConfig, /expo-notifications/);
  assert.doesNotMatch(packageJson, /expo-notifications|expo-device/);
  assert.equal(existsSync(resolve(mobileRoot, "src/lib/notifications.ts")), false);
});

test("login does not advertise disabled social providers", () => {
  const source = readSource("app/(auth)/login.tsx");

  assert.doesNotMatch(source, /카카오 로그인 준비 중|Apple 로그인 준비 중/);
  assert.doesNotMatch(source, /handleSocialLogin/);
  assert.doesNotMatch(source, /signInWithOAuth/);
});

test("dashboard derives progress from the shared canonical checklist contract", () => {
  const source = readSource("app/(tabs)/dashboard.tsx");

  assert.match(source, /calculateJourneyProgressPercent/);
  assert.doesNotMatch(source, /function calcProgress\(/);
});

test("dashboard never turns template timing into a personal deadline or urgency", () => {
  const source = readSource("app/(tabs)/dashboard.tsx");

  assert.doesNotMatch(source, /ddayDeadline|calcUrgentTasks|urgentTasks/);
  assert.doesNotMatch(source, /권장 확인 시기|집중 관리|완료 권장/);
  assert.match(source, /직접 시작한 준비/);
  assert.match(source, /체크리스트.*개 남음/);
});

test("dashboard distinguishes auth, profile, and journey query failures from empty data", () => {
  const source = readSource("app/(tabs)/dashboard.tsx");

  assert.match(source, /error: authError/);
  assert.match(source, /if \(authError\) throw authError/);
  assert.match(source, /error: profileError/);
  assert.match(source, /if \(profileError\) throw profileError/);
  assert.match(source, /error: journeyError/);
  assert.match(source, /if \(journeyError\) throw journeyError/);
  assert.match(source, /마지막으로 확인한 정보/);
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

test("profile never renders query failures as an empty guest profile", () => {
  const profile = readSource("app/(tabs)/profile.tsx");

  assert.match(profile, /error: authError/);
  assert.match(profile, /error: profileError/);
  assert.match(profile, /error: journeyError/);
  assert.match(profile, /error: partnerError/);
  assert.match(profile, /if \(loadIssue && !profile\)/);
  assert.match(profile, /<ErrorRetry/);
  assert.doesNotMatch(profile, /profile\?\.name \?\? "게스트"/);
});

test("profile identifies each critical load failure and preserves its last confirmed identity", () => {
  const profile = readSource("app/(tabs)/profile.tsx");

  for (const source of ["auth", "profile", "journey", "partner"]) {
    assert.match(
      profile,
      new RegExp(`new ProfileLoadError\\("${source}"`),
      `${source} failures must remain distinguishable`,
    );
  }
  assert.match(profile, /const \[loadIssue, setLoadIssue\] = useState<ProfileLoadSource \| null>/);
  assert.match(profile, /setLoading\(true\);[\s\S]{0,120}try \{/);
  assert.match(profile, /setProfile\(nextProfile\);[\s\S]{0,120}setLoadIssue\(null\)/);
  assert.match(profile, /if \(loading && !profile\)/);
  assert.match(profile, /if \(loadIssue && !profile\)/);
  assert.match(profile, /loadIssue && profile/);
  assert.match(profile, /마지막으로 확인한 내 정보를 표시하고 있어요/);
  assert.match(profile, /내 정보 다시 불러오기/);
});

test("settings never renders required query failures as empty account or couple fields", () => {
  const settings = readSource("app/settings/index.tsx");

  for (const source of ["auth", "profile", "journey", "partner", "invite"]) {
    assert.match(
      settings,
      new RegExp(`new SettingsLoadError\\("${source}"`),
      `${source} failures must remain distinguishable`,
    );
  }
  assert.match(settings, /error: partnerError/);
  assert.match(settings, /if \(partnerError\) throw new SettingsLoadError\("partner"/);
  assert.match(settings, /nextInviteState = await readCoupleInviteState\(\)/);
  assert.match(settings, /if \(loadIssue && !data\)/);
  assert.match(settings, /<ErrorRetry/);
  assert.doesNotMatch(settings, /void loadSettings\(\)\.catch\(\(\) =>/);
});

test("settings preserves the last confirmed profile, journey, partner, and invite state on refresh failure", () => {
  const settings = readSource("app/settings/index.tsx");
  const loadStart = settings.indexOf("const loadSettings = useCallback");
  const effectStart = settings.indexOf("useEffect(() =>", loadStart);
  const load = settings.slice(loadStart, effectStart);

  assert.ok(loadStart >= 0);
  assert.ok(effectStart > loadStart);
  assert.match(load, /let nextPartnerName: string \| null = null/);
  assert.match(load, /let nextInviteState: CoupleInviteState \| null = null/);
  assert.match(load, /setPartnerName\(nextPartnerName\)/);
  assert.match(load, /setInviteCode\(nextInviteState\?\.inviteCode \?\? null\)/);

  const inviteRead = load.indexOf("nextInviteState = await readCoupleInviteState()");
  const partnerCommit = load.indexOf("setPartnerName(nextPartnerName)");
  const inviteCommit = load.indexOf("setInviteCode(nextInviteState?.inviteCode ?? null)");
  assert.ok(inviteRead >= 0);
  assert.ok(partnerCommit > inviteRead);
  assert.ok(inviteCommit > inviteRead);

  assert.match(settings, /if \(loading && !data\)/);
  assert.match(settings, /loadIssue && data/);
  assert.match(settings, /마지막으로 확인한 설정을 표시하고 있어요/);
  assert.match(settings, /설정 정보 다시 불러오기/);
});

test("settings keeps stale values read-only until every required source is confirmed again", () => {
  const settings = readSource("app/settings/index.tsx");
  const saveStart = settings.indexOf("async function handleSave()");
  const passwordStart = settings.indexOf("async function handlePasswordChange()", saveStart);
  const save = settings.slice(saveStart, passwordStart);

  assert.match(settings, /const settingsReadOnly = Boolean\(loadIssue\) \|\| loading/);
  assert.match(save, /if \(!data \|\| settingsReadOnly\) return/);
  assert.ok(
    (settings.match(/editable=\{!settingsReadOnly\}/g) ?? []).length >= 5,
    "all profile and journey fields must be read-only while stale",
  );
  assert.match(settings, /disabled=\{saving \|\| settingsReadOnly/);
  assert.match(settings, /disabled=\{!inviteCode \|\| settingsReadOnly\}/);
  assert.match(settings, /disabled=\{relinking \|\| settingsReadOnly\}/);
  assert.match(settings, /수정과 저장은 최신 상태를 확인한 뒤 다시 사용할 수 있어요/);
});

test("retired mobile media publishing has no dormant picker permission seam", () => {
  const retiredWriter = readSource("app/community/post/write.tsx");

  assert.equal(existsSync(resolve(mobileRoot, "src/components/ImagePickerButton.tsx")), false);
  assert.match(retiredWriter, /<Redirect href="\/\(tabs\)\/community"/);
  assert.doesNotMatch(
    retiredWriter,
    /ImagePicker|launchImageLibraryAsync|requestMediaLibraryPermissionsAsync|launchCameraAsync|upload|supabase/,
  );
});

for (const [name, relativePath, retryMessage] of [
  ["budget", "app/budget/index.tsx", "금액 기록을 불러오지 못했어요"],
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

test("schedule event saves use the atomic API instead of replacing a stale event array", () => {
  const source = readSource("app/schedule/index.tsx");
  const saveStart = source.indexOf("async function saveEvent()");
  const deleteStart = source.indexOf("async function deleteEvent()", saveStart);
  const saveEvent = source.slice(saveStart, deleteStart);

  assert.ok(saveStart >= 0);
  assert.ok(deleteStart > saveStart);
  assert.match(saveEvent, /mutateScheduleEvent\(\{/);
  assert.match(saveEvent, /operation: "add"/);
  assert.match(saveEvent, /operation: "update"/);
  assert.match(saveEvent, /expectedUpdatedAt: editingEventUpdatedAt/);
  assert.match(saveEvent, /normalizeScheduleEvents\(result\.progress\.__events\)/);
  assert.match(saveEvent, /}, apiFetch\)/);
  assert.doesNotMatch(saveEvent, /from\("wedding_journeys"\)/);
  assert.doesNotMatch(saveEvent, /progress_patch/);
});

test("schedule event deletion uses the atomic API instead of replacing a stale event array", () => {
  const source = readSource("app/schedule/index.tsx");
  const deleteStart = source.indexOf("async function deleteEvent()");
  const expandStart = source.indexOf("function handleExpandToggle", deleteStart);
  const deleteEvent = source.slice(deleteStart, expandStart);

  assert.ok(deleteStart >= 0);
  assert.ok(expandStart > deleteStart);
  assert.match(deleteEvent, /events\.find\(\(event\) => event\.id === editingEventId\)/);
  assert.match(deleteEvent, /operation: "delete"/);
  assert.match(deleteEvent, /eventId: existingEvent\.id/);
  assert.match(deleteEvent, /expectedUpdatedAt: editingEventUpdatedAt/);
  assert.match(deleteEvent, /normalizeScheduleEvents\(result\.progress\.__events\)/);
  assert.match(deleteEvent, /}, apiFetch\)/);
  assert.doesNotMatch(deleteEvent, /from\("wedding_journeys"\)/);
  assert.doesNotMatch(deleteEvent, /progress_patch/);
});

test("schedule event edit and delete selections use stable ids across sorted views", () => {
  const source = readSource("app/schedule/index.tsx");
  const normalizeStart = source.indexOf("function normalizeScheduleEvents");
  const screenStart = source.indexOf("export default function ScheduleScreen", normalizeStart);
  const normalizeEvents = source.slice(normalizeStart, screenStart);

  assert.ok(normalizeStart >= 0);
  assert.ok(screenStart > normalizeStart);
  assert.match(normalizeEvents, /evt_legacy_/);
  assert.doesNotMatch(normalizeEvents, /createEventId\(/);
  assert.doesNotMatch(source, /\beditingIdx\b/);
  assert.match(
    source,
    /const \[editingEventId, setEditingEventId\] = useState<string \| null>\(null\)/,
  );
  assert.match(source, /function openEditEventModal\(eventId: string\)/);
  assert.match(source, /events\.find\(\(event\) => event\.id === eventId\)/);
  assert.match(source, /events\.find\(\(event\) => event\.id === editingEventId\)/);
  assert.match(source, /eventId: existingEvent\.id/);
  assert.ok((source.match(/key=\{evt\.id\}/g) ?? []).length >= 2);
  assert.ok((source.match(/openEditEventModal\(evt\.id\)/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /findIndex\([\s\S]{0,180}e\.date === evt\.date/);
});

test("schedule event writes reject duplicate identities instead of changing multiple events", () => {
  const source = readSource("app/schedule/index.tsx");
  const normalizeStart = source.indexOf("function normalizeScheduleEvents");
  const screenStart = source.indexOf("export default function ScheduleScreen", normalizeStart);
  const normalizeEvents = source.slice(normalizeStart, screenStart);

  assert.match(normalizeEvents, /const eventIds = new Set<string>\(\)/);
  assert.match(normalizeEvents, /if \(eventIds\.has\(id\)\) \{\s*throw new Error/);
  assert.match(normalizeEvents, /eventIds\.add\(id\)/);
});

test("legacy synthetic event ids remain readable but cannot be mistaken for atomic identities", () => {
  const source = readSource("app/schedule/index.tsx");

  assert.match(source, /evt\.id\.startsWith\("evt_legacy_"\)/);
  assert.match(source, /이전 형식으로 저장된 일정/);
  assert.match(source, /새 일정으로 다시 등록/);
});

test("schedule conflicts replace stale mobile events with the validated server state", () => {
  const source = readSource("app/schedule/index.tsx");

  assert.match(source, /ScheduleEventConflictError/);
  assert.ok((source.match(/error instanceof ScheduleEventConflictError/g) ?? []).length >= 2);
  assert.ok(
    (source.match(/setEvents\(normalizeScheduleEvents\(error\.progress\.__events\)\)/g) ?? []).length >= 2,
  );
  assert.ok((source.match(/다른 기기에서 먼저 변경/g) ?? []).length >= 2);
});

test("schedule edits keep the version selected when the modal opened", () => {
  const source = readSource("app/schedule/index.tsx");

  assert.match(
    source,
    /const \[editingEventUpdatedAt, setEditingEventUpdatedAt\] = useState<string \| null>\(null\)/,
  );
  assert.match(source, /setEditingEventUpdatedAt\(evt\.updatedAt\)/);
  assert.ok((source.match(/expectedUpdatedAt: editingEventUpdatedAt/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /expectedUpdatedAt: existingEvent\.updatedAt/);
});

test("schedule recommends only explicitly started work and keeps templates optional", () => {
  const source = readSource("app/schedule/index.tsx");

  assert.doesNotMatch(source, /template\.ddayDeadline/);
  assert.doesNotMatch(source, /template\.ddayStart/);
  for (const unsafeCopy of [
    "마감 지남",
    "곧 마감",
    "일 지났어요",
    "오늘까지 권장",
    "일 남음",
    "개 지연",
    "마감이 가까운 항목",
    "이번 주 할 일을 자동 정렬",
    "이번 주에 급한 준비",
  ]) {
    assert.doesNotMatch(source, new RegExp(unsafeCopy));
  }
  assert.match(source, /getStartedScheduleActions\(categories, journeyProgress\)/);
  assert.match(source, /날짜만으로 체크리스트에 마감이나 긴급 상태를 만들지 않아요/);
  assert.match(source, /선택 가능한 참고 항목/);
  assert.match(source, /모두 할 필요 없어요/);
  assert.match(source, /일정 미설정/);
});

test("vendor catalog and booking screens are physically retired", () => {
  const vendors = readSource("app/vendors/index.tsx");
  const vendor = readSource("app/vendors/[id].tsx");
  const bookings = readSource("app/bookings/index.tsx");
  const dashboard = readSource("app/(tabs)/dashboard.tsx");

  assert.match(vendors, /PublicBetaUnavailable feature="vendor"/);
  assert.match(vendor, /PublicBetaUnavailable feature="vendor"/);
  assert.match(bookings, /PublicBetaUnavailable feature="booking"/);
  for (const retiredScreen of [vendors, vendor, bookings]) {
    assert.doesNotMatch(retiredScreen, /supabase|apiFetch|vendor_bookings|BOOKING_REQUESTS_ENABLED|actual_amount|만족도/);
  }
  assert.doesNotMatch(bookings, /vendor_bookings|supabase|BOOKING_OUTCOMES_ENABLED|actual_amount|만족도/);
  assert.doesNotMatch(dashboard, /vendor_bookings|BOOKING_OUTCOMES_ENABLED|bookingOutcomeTasks|실결제 입력 필요/);
});

test("active navigation physically omits retired vendor surfaces", () => {
  const dashboard = readSource("app/(tabs)/dashboard.tsx");
  const profile = readSource("app/(tabs)/profile.tsx");

  assert.doesNotMatch(dashboard, /PUBLIC_BETA_CAPABILITIES|\/vendors|업체 탐색/);
  assert.doesNotMatch(profile, /PUBLIC_BETA_CAPABILITIES|\/vendors|업체 탐색/);
  assert.match(dashboard, /title: "커뮤니티"/);
});

test("mobile does not offer account deletion until its durable worker is operational", () => {
  const settings = readSource("app/settings/index.tsx");

  assert.match(settings, /계정 삭제 기능 점검 중/);
  assert.doesNotMatch(settings, /handleDeleteAccount|\/api\/auth\/delete|계정 삭제 요청/);
});

test("mobile hides the unverified etiquette WebView and closes direct app routes", () => {
  const profile = readSource("app/(tabs)/profile.tsx");
  const etiquette = readSource("app/etiquette/index.tsx");

  assert.doesNotMatch(profile, /PUBLIC_BETA_CAPABILITIES|\/etiquette|BookOpen/);
  assert.match(etiquette, /<Redirect href="\/\(tabs\)\/profile"/);
  assert.doesNotMatch(etiquette, /\/webview\?|hanbang\.ai\/etiquette/);
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

test("mobile app guide never presents invented progress, money, or unavailable rooms", () => {
  const guide = readSource("src/components/AppGuide.tsx");

  assert.doesNotMatch(guide, /D-127|35% 완료|2026\. 9\. 15/);
  assert.doesNotMatch(guide, /3,000만원|1,240만원|380만원|520만원|41%/);
  assert.doesNotMatch(guide, /동기방 화면 예시|가격 비교 보기/);
  assert.match(guide, /직접 등록한 일정/);
  assert.match(guide, /직접 입력한 금액/);
});

test("mobile onboarding keeps an undecided budget empty", () => {
  const onboarding = readSource("app/onboarding/index.tsx");

  assert.match(onboarding, /아직 정하지 않았다면 비워두세요/);
  assert.match(onboarding, /totalBudget:\s*budget \? manwonInputToWon\(budget\) : 0/);
  assert.doesNotMatch(onboarding, /totalBudget:\s*20_?000_?000/);
});

test("mobile onboarding validates supplied dates and budgets and prevents parallel submission", () => {
  const onboarding = readSource("app/onboarding/index.tsx");

  assert.match(onboarding, /function validateWeddingDetails\(/);
  assert.match(onboarding, /날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요/);
  assert.match(onboarding, /예산은 만원 단위의 숫자로 입력해 주세요/);
  assert.match(onboarding, /if \(submitting \|\| submittingRef\.current\) return/);
  assert.match(onboarding, /disabled=\{submitting\}/);
  assert.match(onboarding, /void handleSubmit\(\)/);
});

test("planning guidance avoids unsupported fixed savings and price ranges", () => {
  const checklists = readSource("src/constants/checklists.ts");
  const onboarding = readSource("app/onboarding/index.tsx");
  const budget = readSource("app/budget/index.tsx");

  assert.match(checklists, /신혼여행은 선택입니다/);
  assert.match(checklists, /여권·비자·보험의 최신 공식 안내를 직접 확인하세요/);
  assert.match(checklists, /총액·설치비·보증·반품 조건을 함께 비교하세요/);
  assert.doesNotMatch(checklists, /항공권은 빨리 예약할수록 저렴합니다/);
  assert.doesNotMatch(checklists, /수백만원을 아낄 수 있습니다/);
  assert.match(onboarding, /예산을 어떻게 운영하고 싶나요\?/);
  assert.match(budget, /서명한 계약서 원본의 최종 총액/);
  assert.match(budget, /계약서나 업체 안내 원본에 적힌 예정액/);
  assert.doesNotMatch(
    budget,
    /\+(?:5|10|20|30|50|100)~(?:20|30|50|80|100|150|200|300)만원/,
  );
});

test("mobile budget is an opt-in ledger of only user-started records", () => {
  const budget = readSource("app/budget/index.tsx");

  assert.doesNotMatch(budget, /CATEGORY_RATIOS|ratio:\s*0\./);
  assert.match(budget, /function hasManualMoneyRecord/);
  assert.match(budget, /const activeRecords/);
  assert.match(budget, /activeRecords\.map/);
  assert.match(budget, /필요한 항목만 골라 기록하세요/);
  assert.match(budget, /모두 추가할 필요 없어요/);
  assert.match(budget, /항목 추가/);
});

test("mobile budget separates manual financial meanings and never revives legacy writes", () => {
  const budget = readSource("app/budget/index.tsx");
  const saveStart = budget.indexOf("async function saveCategoryEdit()");
  const deleteStart = budget.indexOf("async function deleteRecord", saveStart);
  const saveCategory = budget.slice(saveStart, deleteStart);

  assert.match(saveCategory, /parseEditorAmount\(budgetInput\)/);
  assert.match(saveCategory, /parseEditorAmount\(contractedTotalInput\)/);
  assert.match(saveCategory, /parseEditorAmount\(paidToDateInput\)/);
  assert.match(saveCategory, /parseEditorAmount\(nextPaymentAmountInput\)/);
  assert.match(saveCategory, /removeFields\.push\(field\)/);
  assert.match(saveCategory, /mutateBudgetCategory\(/);
  assert.doesNotMatch(saveCategory, /progress_patch|\.select\("progress"\)/);
  assert.doesNotMatch(budget, /spentInput|payerInput|PAYER_OPTIONS/);
  assert.match(budget, /remove:\s*legacyFields/);
});

test("mobile budget labels records as unverified and makes originals authoritative", () => {
  const budget = readSource("app/budget/index.tsx");

  assert.match(budget, /사용자가 직접 입력한 미검증 기록/);
  assert.match(budget, /서명한 계약서·영수증·계좌내역 원본/);
  assert.match(budget, /계약 금액·납부일·납부 완료 여부는 이 화면이 확인하지 않습니다/);
  assert.doesNotMatch(budget, /budgetRisks|categoryOverruns|getCatStatus|StatusPill/);
  assert.doesNotMatch(budget, /예산 초과|남은 예산|잔여 예산/);
});

test("Amora makes long generation honest and retries only transient failures", () => {
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
  assert.match(chat, /retry: isTerminalLimit \? "none" : "ai"/);
  assert.match(chat, /isTerminalAmoraChatError\(error\)/);
  assert.match(chat, /sendIssue\.retry !== "none"/);
  assert.match(chat, /setPendingAiRequest\(null\)/);
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

  const recoveryRender = source.indexOf("if (relinkRecoveryRequired)");
  const genericLoadFailure = source.indexOf("if (loadIssue && !data)");
  assert.ok(recoveryRender >= 0);
  assert.ok(genericLoadFailure > recoveryRender);
});
