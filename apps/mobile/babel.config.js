module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // Reanimated 4 (SDK 54) — plugin 은 선택. 필요해지면 아래 주석 해제
    // plugins: ["react-native-worklets/plugin"],
  };
};
