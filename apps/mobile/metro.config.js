// Metro config — pnpm monorepo (shamefully-hoist) 대응
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 워크스페이스 루트 감시 (packages/* 변경 감지)
config.watchFolders = [workspaceRoot];

// 모듈 검색 경로: 앱 로컬 → 루트
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm .pnpm 심볼릭 문제 방지: 심볼릭 따라가지 않기
config.resolver.unstable_enableSymlinks = false;

// .pnpm 폴더를 블록 리스트에 추가 (Metro가 .pnpm 내부로 resolve 시도 방지)
const { FileStore } = require("metro-cache");
config.cacheStores = [
  new FileStore({ root: path.join(projectRoot, ".metro-cache") }),
];

module.exports = config;
