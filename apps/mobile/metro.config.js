const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

const defaultWatchFolders = config.watchFolders ?? [];
config.watchFolders = Array.from(new Set([...defaultWatchFolders, workspaceRoot]));

const defaultNodeModulesPaths = config.resolver.nodeModulesPaths ?? [];
config.resolver.nodeModulesPaths = Array.from(
  new Set([
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
    ...defaultNodeModulesPaths,
  ])
);

config.cacheStores = [
  new FileStore({ root: path.join(projectRoot, ".metro-cache") }),
];

module.exports = config;
