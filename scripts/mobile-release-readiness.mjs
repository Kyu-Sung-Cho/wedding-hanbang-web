import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
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
const mobileCallback = readText("apps/web/src/app/auth/mobile-callback/page.tsx");

const expectedAppName = "\uC6E8\uB529\uD55C\uBC29";
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
  filter.data?.some((entry) =>
    entry.scheme === "https" &&
    entry.host === "hanbang.ai" &&
    entry.pathPrefix === "/app"
  )
);
expect(androidUniversalLink, "Android universal-link intent filter targets https://hanbang.ai/app");

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

expect(easConfig.cli?.appVersionSource === "local", "EAS uses local app version source");
expect(easConfig.build?.development?.developmentClient === true, "EAS development profile builds a dev client");
expect(easConfig.build?.preview?.distribution === "internal", "EAS preview profile is internal distribution");
expect(easConfig.build?.production?.autoIncrement === true, "EAS production profile auto-increments");
expect(easConfig.build?.production?.android?.buildType === "app-bundle", "EAS production Android build type is app-bundle");

for (const scriptName of [
  "eas:init",
  "eas:build:ios",
  "eas:build:android",
  "eas:build:all",
  "eas:submit:ios",
  "eas:submit:android",
]) {
  expect(Boolean(mobilePackage.scripts?.[scriptName]), `Mobile package script ${scriptName} exists`);
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

expect(
  mobileAuth.includes('const redirectTo = `${SITE_URL}/auth/mobile-callback`;'),
  "Mobile OAuth redirects through /auth/mobile-callback"
);
expect(
  mobileAuth.includes('Linking.createURL("auth/callback")'),
  "Mobile OAuth waits for auth/callback deep link"
);
expect(
  mobileCallback.includes("hanbang://auth/callback#"),
  "Web mobile callback returns to hanbang://auth/callback"
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
