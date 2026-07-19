import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EAS_CLI_PACKAGE,
  MOBILE_EAS_WORKING_DIRECTORY,
  MOBILE_EAS_COMMAND_INVALID,
  MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED,
  PNPM_REQUIRES_SHELL,
  runMobileEasCommand,
} from "./mobile-eas-release-gate.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

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
const mobileMetroConfig = readText("apps/mobile/metro.config.js");
const rootPackage = readJson("package.json");
const mobilePackage = readJson("apps/mobile/package.json");
const mobileEasGatePath = path.join(root, "scripts/mobile-eas-release-gate.mjs");
const mobileEnvExample = readText("apps/mobile/.env.example");
const mobileAuth = readText("apps/mobile/src/lib/auth.ts");
const mobileProfile = readText("apps/mobile/app/(tabs)/profile.tsx");
const mobileSentry = readText("apps/mobile/src/lib/sentry.ts");
const mobileSentryPrivacy = readText("apps/mobile/src/lib/sentryPrivacy.ts");
const mobileRootLayout = readText("apps/mobile/app/_layout.tsx");
const mobileErrorBoundary = readText("apps/mobile/src/components/ErrorBoundary.tsx");
const mobileCallback = readText("apps/web/src/app/auth/mobile-callback/page.tsx");
const sharedMobileOAuth = readText("packages/shared/src/utils/mobileOAuth.ts");

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
  "@sentry/react-native/expo",
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

expect(easConfig.cli?.appVersionSource === "remote", "EAS uses remote app version source");
expect(easConfig.cli?.version === "21.0.2", "EAS CLI is pinned to 21.0.2");
expect(
  EAS_CLI_PACKAGE === `eas-cli@${easConfig.cli?.version}`,
  "Mobile EAS wrapper and eas.json pin the same CLI version",
);
expect(easConfig.cli?.requireCommit === true, "EAS refuses to build a dirty worktree");
expect(appConfig.ios?.buildNumber === undefined, "iOS build number is owned by EAS remote versioning");
expect(appConfig.android?.versionCode === undefined, "Android version code is owned by EAS remote versioning");
expect(easConfig.build?.development?.environment === "development", "EAS development profile uses development environment");
expect(easConfig.build?.development?.developmentClient === true, "EAS development profile builds a dev client");
expect(easConfig.build?.preview?.environment === "preview", "EAS preview profile uses preview environment");
expect(easConfig.build?.preview?.distribution === "internal", "EAS preview profile is internal distribution");
expect(easConfig.build?.production?.environment === "production", "EAS production profile uses production environment");
expect(easConfig.build?.production?.autoIncrement === true, "EAS production profile auto-increments");
expect(easConfig.build?.production?.android?.buildType === "app-bundle", "EAS production Android build type is app-bundle");
expect(rootPackage.packageManager === "pnpm@11.7.0", "Root packageManager pins pnpm 11.7.0");
expect(
  !mobileMetroConfig.includes('require("metro-cache")'),
  "Mobile Metro config uses Expo's declared default cache"
);
expect(
  mobileMetroConfig.includes('require("@sentry/react-native/metro")')
    && mobileMetroConfig.includes("getSentryExpoConfig(projectRoot, { getDefaultConfig })"),
  "Mobile Metro config injects Sentry debug IDs without dropping Expo defaults",
);

for (const profileName of ["development", "preview", "production"]) {
  const profile = easConfig.build?.[profileName];
  expect(profile?.node === "22.13.0", `EAS ${profileName} profile pins Node 22.13.0`);
  expect(profile?.corepack === undefined, `EAS ${profileName} profile avoids the Corepack/global-pnpm collision`);
  expect(profile?.pnpm === "11.7.0", `EAS ${profileName} profile installs pnpm 11.7.0 exactly once`);
  expect(profile?.channel === profileName, `EAS ${profileName} profile uses the ${profileName} update channel`);
}

expect(
  mobilePackage.dependencies?.["react-native-worklets"] === "0.5.1",
  "Mobile installs the Expo 54 compatible react-native-worklets peer"
);
expect(
  mobilePackage.dependencies?.["expo-application"] === "~7.0.8",
  "Mobile directly installs the Expo 54 compatible expo-application package",
);

expect(existsSync(mobileEasGatePath), "Mobile production EAS commands have a shared release gate");

const pnpmExecutionProbe = PNPM_REQUIRES_SHELL
  ? spawnSync("corepack pnpm --version", { encoding: "utf8", shell: true })
  : spawnSync("corepack", ["pnpm", "--version"], { encoding: "utf8" });
expect(
  pnpmExecutionProbe.status === 0 && /^11\.7\.0\s*$/.test(pnpmExecutionProbe.stdout),
  "Mobile EAS gate can execute the pinned pnpm command on this operating system",
);

let productionProviderCalled = false;
let productionBlockCode = null;
try {
  runMobileEasCommand(
    [
      "build",
      "--platform",
      "ios",
      "--profile",
      "production",
      "--non-interactive",
      "--freeze-credentials",
    ],
    {
      runProvider() {
        productionProviderCalled = true;
        return 0;
      },
    },
  );
} catch (error) {
  productionBlockCode = error?.code ?? null;
}
expect(
  productionBlockCode === MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED
    && productionProviderCalled === false,
  "Mobile production EAS build is blocked before the provider runs",
);

const previewArgs = [
  "build",
  "--platform",
  "all",
  "--profile",
  "preview",
  "--non-interactive",
  "--freeze-credentials",
];
let previewInvocation = null;
const previewStatus = runMobileEasCommand(previewArgs, {
  runProvider(invocation) {
    previewInvocation = invocation;
    return 0;
  },
});
expect(
  previewStatus === 0
    && previewInvocation?.command === "corepack"
    && previewInvocation?.cwd === MOBILE_EAS_WORKING_DIRECTORY
    && JSON.stringify(previewInvocation?.args) === JSON.stringify([
      "pnpm",
      "dlx",
      EAS_CLI_PACKAGE,
      ...previewArgs,
    ]),
  "Mobile preview/internal EAS build reaches the pinned provider with frozen credentials",
);

const productionCli = spawnSync(
  process.execPath,
  [
    mobileEasGatePath,
    "build",
    "--platform",
    "ios",
    "--profile",
    "production",
    "--non-interactive",
    "--freeze-credentials",
  ],
  { encoding: "utf8" },
);
expect(
  productionCli.status !== 0
    && `${productionCli.stdout}${productionCli.stderr}`.includes(
      MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED,
    ),
  "Mobile production EAS CLI exits fail-closed before provider execution",
);

let equalsSyntaxProviderCalled = false;
let equalsSyntaxBlockCode = null;
try {
  runMobileEasCommand(
    [
      "build",
      "--platform=ios",
      "--profile=production",
      "--non-interactive",
      "--freeze-credentials",
    ],
    {
      runProvider() {
        equalsSyntaxProviderCalled = true;
        return 0;
      },
    },
  );
} catch (error) {
  equalsSyntaxBlockCode = error?.code ?? null;
}
expect(
  equalsSyntaxBlockCode === MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED
    && equalsSyntaxProviderCalled === false,
  "Mobile production EAS gate cannot be bypassed with equals-style CLI options",
);

const ambiguousCommands = [
  ["build", "--platform", "ios", "--non-interactive", "--freeze-credentials"],
  [
    "build",
    "--platform",
    "ios",
    "--profile",
    "preview",
    "--profile",
    "development",
    "--non-interactive",
    "--freeze-credentials",
  ],
  [
    "build",
    "--platform",
    "ios",
    "--profile",
    "preview",
    "--non-interactive",
    "--freeze-credentials",
    "--refresh-ad-hoc-provisioning-profile",
  ],
  [
    "build",
    "--platform",
    "ios",
    "--profile",
    "preview",
    "--non-interactive",
    "--freeze-credentials",
    "--auto-submit-with-profile",
    "production",
  ],
  ["submit", "--platform", "ios", "--profile", "preview"],
];
let ambiguousCommandsFailClosed = true;
for (const args of ambiguousCommands) {
  let providerCalled = false;
  let blockCode = null;
  try {
    runMobileEasCommand(args, {
      runProvider() {
        providerCalled = true;
        return 0;
      },
    });
  } catch (error) {
    blockCode = error?.code ?? null;
  }
  ambiguousCommandsFailClosed = ambiguousCommandsFailClosed
    && blockCode === MOBILE_EAS_COMMAND_INVALID
    && providerCalled === false;
}
expect(
  ambiguousCommandsFailClosed,
  "Mobile EAS gate rejects missing, ambiguous, submit, or extra provider arguments before execution",
);

expect(
  mobilePackage.scripts?.["eas:init"] === "pnpm dlx eas-cli@21.0.2 init",
  "Mobile EAS initialization remains directly available with the pinned CLI",
);

const productionEasScripts = {
  "eas:build:ios": [
    "build", "--platform", "ios", "--profile", "production",
    "--non-interactive", "--freeze-credentials",
  ],
  "eas:build:android": [
    "build", "--platform", "android", "--profile", "production",
    "--non-interactive", "--freeze-credentials",
  ],
  "eas:build:all": [
    "build", "--platform", "all", "--profile", "production",
    "--non-interactive", "--freeze-credentials",
  ],
  "eas:submit:ios": ["submit", "--platform", "ios", "--profile", "production"],
  "eas:submit:android": ["submit", "--platform", "android", "--profile", "production"],
};

for (const [scriptName, args] of Object.entries(productionEasScripts)) {
  expect(
    mobilePackage.scripts?.[scriptName]
      === `node ../../scripts/mobile-eas-release-gate.mjs ${args.join(" ")}`,
    `Mobile package script ${scriptName} uses the exact shared production release gate`,
  );

  let providerCalled = false;
  let blockCode = null;
  try {
    runMobileEasCommand(args, {
      runProvider() {
        providerCalled = true;
        return 0;
      },
    });
  } catch (error) {
    blockCode = error?.code ?? null;
  }
  expect(
    blockCode === MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED
      && providerCalled === false,
    `Mobile package script ${scriptName} is blocked before provider execution`,
  );
}

expect(Boolean(rootPackage.scripts?.["mobile:release-check"]), "Root mobile:release-check script exists");
expect(Boolean(mobilePackage.scripts?.["release:check"]), "Mobile release:check script exists");

for (const envName of [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SITE_URL=https://hanbang.ai",
  "EXPO_PUBLIC_SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
]) {
  expect(mobileEnvExample.includes(envName), `.env.example documents ${envName}`);
}

expect(
  mobileSentry.includes("sendDefaultPii: false")
    && mobileSentry.includes("attachScreenshot: false")
    && mobileSentry.includes("attachViewHierarchy: false")
    && mobileSentry.includes("enableCaptureFailedRequests: false"),
  "Mobile Sentry disables default PII and privacy-sensitive attachments",
);
expect(
  mobileSentry.includes("beforeBreadcrumb: sanitizeSentryBreadcrumb")
    && mobileSentry.includes("beforeSend: sanitizeSentryEvent")
    && mobileSentry.includes("beforeSendTransaction: sanitizeSentryTransaction"),
  "Mobile Sentry applies breadcrumb, error, and transaction privacy scrubbers",
);
expect(
  mobileSentryPrivacy.includes("span.data = {}")
    && mobileSentryPrivacy.includes("event.request = undefined")
    && mobileSentryPrivacy.includes("event.user = undefined"),
  "Mobile Sentry scrubbers remove private span, request, and user payloads",
);
expect(
  mobileSentry.includes("tracesSampleRate: __DEV__ ? 1.0 : 0.03"),
  "Mobile Sentry production tracing starts at a conservative three percent",
);
expect(
  mobileRootLayout.includes("registerSentryNavigationContainer(navigationContainerRef)")
    && mobileRootLayout.includes("export default Sentry.wrap(RootLayout)"),
  "Mobile root registers navigation tracing and uses the Sentry root wrapper",
);
expect(
  mobileErrorBoundary.includes("Sentry.captureException(error)")
    && mobileErrorBoundary.includes("scope.setContext(\"react\""),
  "Mobile error boundary reports caught React crashes with component context",
);

expect(
  mobileAuth.includes('const redirectTo = `${SITE_URL}/auth/mobile-callback`;'),
  "Mobile OAuth redirects through /auth/mobile-callback"
);
expect(
  mobileAuth.includes('Linking.createURL("auth/callback")'),
  "Mobile OAuth waits for auth/callback deep link"
);
expect(
  mobileCallback.includes("buildMobileOAuthAppCallbackUrl(callbackUrl)")
    && sharedMobileOAuth.includes('const DEFAULT_APP_CALLBACK_URL = "hanbang://auth/callback"')
    && sharedMobileOAuth.includes("new URLSearchParams({ code })")
    && sharedMobileOAuth.includes('appCallback.hash = ""'),
  "Web mobile callback returns only a PKCE code to hanbang://auth/callback"
);
expect(
  mobileAuth.includes("exchangeCodeForSession(code)")
    && sharedMobileOAuth.includes('fragment.has("access_token")')
    && sharedMobileOAuth.includes('fragment.has("refresh_token")'),
  "Mobile OAuth exchanges PKCE and rejects session tokens in callback URLs"
);
expect(
  mobileProfile.includes("Application.nativeApplicationVersion")
    && mobileProfile.includes("Application.nativeBuildVersion")
    && !mobileProfile.includes("Constants.expoConfig?.ios?.buildNumber")
    && !mobileProfile.includes("Constants.expoConfig?.android?.versionCode"),
  "Mobile profile displays the native remote-managed app and build versions",
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
