// Metro config — pnpm 모노레포 대응
// Expo Router + NativeWind v4 + workspace 패키지 resolve

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Metro가 워크스페이스 루트의 node_modules도 탐색하도록
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 2. pnpm symlink 대응 — 심볼릭 링크 따라가기
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// 3. SVG 지원 (선택 — 나중에)
// config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer");

// 4. NativeWind 래핑 (CSS → RN 스타일)
module.exports = withNativeWind(config, {
  input: "./global.css",
});
