const { getDefaultConfig } = require("expo/metro-config");
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

module.exports = config;
