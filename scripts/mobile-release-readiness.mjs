import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const storeReleaseMode = process.argv.includes("--store-ready");

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function listFiles(relativePath, extensions) {
  const absolutePath = path.join(root, relativePath);
  const entries = readdirSync(absolutePath);
  return entries.flatMap((entry) => {
    const entryAbsolutePath = path.join(absolutePath, entry);
    const entryRelativePath = path.join(relativePath, entry);
    const stats = statSync(entryAbsolutePath);
    if (stats.isDirectory()) return listFiles(entryRelativePath, extensions);
    return extensions.some((extension) => entry.endsWith(extension))
      ? [entryRelativePath]
      : [];
  });
}

const results = [];

function pass(label) {
  results.push({ level: "pass", label });
}

function warn(label) {
  results.push({ level: "warn", label });
}

function fail(label) {
  results.push({ level: "fail", label });
}

function expect(condition, label) {
  if (condition) pass(label);
  else fail(label);
}

function expectIncludes(values, expected, label) {
  expect(Array.isArray(values) && values.includes(expected), label);
}

const appConfig = readJson("apps/mobile/app.json").expo;
const easConfig = readJson("apps/mobile/eas.json");
const rootPackage = readJson("package.json");
const mobilePackage = readJson("apps/mobile/package.json");
const mobileEnvExample = readText("apps/mobile/.env.example");
const mobileAuth = readText("apps/mobile/src/lib/auth.ts");
const mobileSupabase = readText("apps/mobile/src/lib/supabase.ts");
const mobileLogin = readText("apps/mobile/app/(auth)/login.tsx");
const mobileProfile = readText("apps/mobile/app/(tabs)/profile.tsx");
const mobileMetroConfig = readText("apps/mobile/metro.config.js");
const mobileCallback = readText("apps/web/src/app/auth/mobile-callback/page.tsx");
const expectedEasCliVersion = "20.5.1";
const repositoryNodeVersion = rootPackage.engines?.node?.match(/^>=\s*(\d+\.\d+\.\d+)$/)?.[1];
const repositoryPnpmVersion = rootPackage.packageManager?.match(/^pnpm@(.+)$/)?.[1];
const competingRootExpoConfigs = [
  "app.json",
  "app.config.json",
  "app.config.js",
  "app.config.ts",
  "eas.json",
];

const expectedAppName = "\uC6E8\uB529\uD55C\uBC29";
expect(
  competingRootExpoConfigs.every((file) => !existsSync(path.join(root, file))),
  "Repository root has no competing Expo or EAS configuration",
);
expect(appConfig.name === expectedAppName, `Expo app name is ${expectedAppName}`);
expect(appConfig.slug === "wedding-hanbang", "Expo slug is wedding-hanbang");
expect(appConfig.scheme === "hanbang", "App scheme is hanbang");
expect(appConfig.userInterfaceStyle === "light", "App is locked to light mode");
expect(appConfig.newArchEnabled === true, "React Native new architecture is enabled");

expect(appConfig.ios?.bundleIdentifier === "ai.hanbang.wedding", "iOS bundle identifier is ai.hanbang.wedding");
expect(appConfig.ios?.usesAppleSignIn === true, "Apple Sign In is enabled on iOS");
expectIncludes(appConfig.ios?.associatedDomains, "applinks:hanbang.ai", "iOS associated domain includes applinks:hanbang.ai");
expect(
  appConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false,
  "iOS export-compliance flag is set"
);

expect(appConfig.android?.package === "ai.hanbang.wedding", "Android package is ai.hanbang.wedding");
expect(
  appConfig.android?.adaptiveIcon?.backgroundColor === "#FBF8F2",
  "Android adaptive icon background uses Pearl Ivory"
);
expect(
  appConfig.splash?.backgroundColor === "#FBF8F2",
  "Splash background uses Pearl Ivory"
);

const androidUniversalLink = appConfig.android?.intentFilters?.some((filter) =>
  filter.action === "VIEW" &&
  filter.autoVerify === true &&
  filter.category?.includes("BROWSABLE") &&
  filter.category?.includes("DEFAULT") &&
  !filter.data?.some((entry) =>
    entry.scheme === "https" &&
    entry.host === "hanbang.ai" &&
    (entry.pathPrefix === "/app" || entry.pathPrefix === "/app/")
  ) &&
  filter.data?.some((entry) =>
    entry.scheme === "https" &&
    entry.host === "hanbang.ai" &&
    entry.path === "/app"
  ) && [
    "/app/community/post/",
    "/app/vendors/",
  ].every((pathPrefix) =>
    filter.data?.some((entry) =>
      entry.scheme === "https" &&
      entry.host === "hanbang.ai" &&
      entry.pathPrefix === pathPrefix
    )
  )
);
expect(
  androidUniversalLink,
  "Android universal-link intent filter targets only the approved share routes"
);

const nativeIntent = readText("apps/mobile/app/+native-intent.tsx");
expect(
  nativeIntent.includes("rewriteMobileAppLink(path)"),
  "Expo native intent rewrites the public /app namespace"
);

const pluginNames = appConfig.plugins?.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin) ?? [];
for (const pluginName of [
  "expo-router",
  "expo-font",
  "expo-secure-store",
  "expo-apple-authentication",
  "expo-splash-screen",
  "expo-notifications",
]) {
  expectIncludes(pluginNames, pluginName, `${pluginName} plugin is configured`);
}

const notificationPlugin = appConfig.plugins?.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === "expo-notifications"
);
expect(
  Array.isArray(notificationPlugin) && notificationPlugin[1]?.color === "#36534E",
  "Notification accent uses Eucalyptus Ink"
);

const easProjectId = appConfig.extra?.eas?.projectId;
if (typeof easProjectId === "string" && easProjectId.trim().length > 0) {
  pass("EAS projectId is populated");
} else {
  warn("EAS projectId is empty; run eas:init after logging into the hanbang Expo account");
}

expect(easConfig.cli?.version === expectedEasCliVersion, "EAS CLI version is pinned");
expect(easConfig.cli?.requireCommit === true, "EAS requires a clean commit before remote builds");
expect(easConfig.cli?.appVersionSource === "remote", "EAS manages build versions remotely");
expect(easConfig.build?.development?.environment === "development", "EAS development profile uses development environment");
expect(easConfig.build?.development?.developmentClient === true, "EAS development profile builds a dev client");
expect(easConfig.build?.preview?.environment === "preview", "EAS preview profile uses preview environment");
expect(easConfig.build?.preview?.distribution === "internal", "EAS preview profile is internal distribution");
expect(easConfig.build?.production?.environment === "production", "EAS production profile uses production environment");
for (const profileName of ["development", "preview", "production"]) {
  expect(
    repositoryNodeVersion !== undefined
      && easConfig.build?.[profileName]?.node === repositoryNodeVersion,
    `EAS ${profileName} uses the repository Node version`
  );
  expect(
    repositoryPnpmVersion !== undefined
      && easConfig.build?.[profileName]?.pnpm === repositoryPnpmVersion,
    `EAS ${profileName} uses the repository pnpm version`
  );
}
expect(easConfig.build?.production?.channel === "production", "EAS production binary uses the production update channel");
expect(easConfig.build?.production?.autoIncrement === true, "EAS production profile auto-increments");
expect(easConfig.build?.production?.android?.buildType === "app-bundle", "EAS production Android build type is app-bundle");
expect(mobilePackage.dependencies?.["expo-application"] === "~7.0.8", "Mobile declares expo-application directly");
expect(mobileProfile.includes('from "expo-application"'), "Mobile profile reads native application metadata");
expect(mobileProfile.includes("Application.nativeApplicationVersion"), "Mobile profile displays the native app version");
expect(mobileProfile.includes("Application.nativeBuildVersion"), "Mobile profile displays the native build version");
expect(!mobileMetroConfig.includes('require("metro-cache")'), "Metro config uses Expo's declared default cache");

for (const scriptName of [
  "eas:init",
  "eas:build:ios",
  "eas:build:android",
  "eas:build:all",
  "eas:submit:ios",
  "eas:submit:android",
]) {
  expect(
    mobilePackage.scripts?.[scriptName]?.includes(`eas-cli@${expectedEasCliVersion}`),
    `Mobile package script ${scriptName} pins EAS CLI`
  );
}

expect(Boolean(rootPackage.scripts?.["mobile:release-check"]), "Root mobile:release-check script exists");
expect(Boolean(mobilePackage.scripts?.["release:check"]), "Mobile release:check script exists");

for (const envName of [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SITE_URL=https://hanbang.ai",
  "EXPO_PUBLIC_SENTRY_DSN",
]) {
  expect(mobileEnvExample.includes(envName), `.env.example documents ${envName}`);
}

const mobileOAuthHardDisabled =
  /export async function signInWithOAuth[\s\S]*?\{\s*void provider;\s*throw new Error\(/.test(mobileAuth) &&
    [
      "expo-web-browser",
      "expo-linking",
      "maybeCompleteAuthSession",
      "supabase.auth.signInWithOAuth(",
      "openAuthSessionAsync",
      "Linking.createURL(",
      ".auth.setSession(",
      "access_token",
      "refresh_token",
    ].every((forbidden) => !mobileAuth.includes(forbidden));
const mobileSocialEntryPointsDisabled =
  /onPress=\{\(\) => handleSocialLogin\("kakao"\)\}\s+disabled(?:\s|>)/.test(mobileLogin) &&
    /onPress=\{\(\) => handleSocialLogin\("apple"\)\}\s+disabled(?:\s|>)/.test(mobileLogin);

if (storeReleaseMode) {
  expect(
    false,
    mobileOAuthHardDisabled || mobileSocialEntryPointsDisabled
      ? "Store release requires implemented and device-verified social login entry points"
      : "Store release remains blocked until signed association endpoints, store builds, and physical-device evidence are machine-verified"
  );
} else {
  expect(mobileOAuthHardDisabled, "Mobile OAuth implementation remains hard-disabled");
  expect(mobileSocialEntryPointsDisabled, "Mobile social-login entry points remain disabled");
  warn("Static mobile checks do not certify store release while social login is hard-disabled");
}
expect(
  mobileSupabase.includes('flowType: "pkce"') &&
    mobileSupabase.includes("detectSessionInUrl: false") &&
    !mobileSupabase.includes('flowType: "implicit"'),
  "Mobile auth client rejects implicit URL sessions and is pinned to PKCE"
);
expect(
  mobileCallback.includes("window.history.replaceState(null, \"\", window.location.pathname)") &&
    [
      "window.location.hash",
      "window.location.search",
      "URLSearchParams",
      "access_token",
      "refresh_token",
      "hanbang://",
      "window.location.href",
      "NEXT_PUBLIC_EXPO_AUTH_CALLBACK_URL",
      ".auth.setSession(",
    ].every((forbidden) => !mobileCallback.includes(forbidden)),
  "Web mobile callback strips the URL and never forwards bearer tokens"
);

const legacyPalette = [
  "#1A1A1F",
  "#0D0D0F",
  "#C4967E",
  "#9A6B62",
  "#FDFCFA",
  "#FAF8F5",
  "#F5F2ED",
  "#FAFAF8",
  "#878680",
  "#C9A96E",
];
for (const legacyColor of legacyPalette) {
  expect(
    !mobileCallback.includes(legacyColor),
    `Mobile callback does not use legacy color ${legacyColor}`
  );
}

const mobileSourceFiles = [
  ...listFiles("apps/mobile/app", [".ts", ".tsx"]),
  ...listFiles("apps/mobile/src", [".ts", ".tsx"]),
];
const nonZeroLetterSpacing = [];
for (const sourceFile of mobileSourceFiles) {
  const source = readText(sourceFile);
  const matches = source.matchAll(/letterSpacing:\s*([^,\n}]+)/g);
  for (const match of matches) {
    const value = match[1]?.trim();
    if (value !== "0") {
      nonZeroLetterSpacing.push(`${sourceFile} -> ${value}`);
    }
  }
}
expect(
  nonZeroLetterSpacing.length === 0,
  nonZeroLetterSpacing.length === 0
    ? "Mobile source keeps Paperlogy letter spacing at 0"
    : `Mobile source has non-zero letterSpacing: ${nonZeroLetterSpacing.join("; ")}`
);

const counts = results.reduce(
  (acc, result) => {
    acc[result.level] += 1;
    return acc;
  },
  { pass: 0, warn: 0, fail: 0 }
);

for (const result of results) {
  const prefix = result.level === "pass" ? "PASS" : result.level === "warn" ? "WARN" : "FAIL";
  console.log(`[mobile-release-readiness] ${prefix} ${result.label}`);
}

console.log(
  `\n[mobile-release-readiness] summary: ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failures`
);

if (counts.fail > 0) {
  process.exit(1);
}
