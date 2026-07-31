const { getDefaultConfig } = require("expo/metro-config");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;

const config = getSentryExpoConfig(projectRoot, { getDefaultConfig });

module.exports = config;
