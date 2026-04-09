import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { initSentry } from "@/lib/sentry";

// Sentry 초기화 (DSN 있을 때만 활성화)
initSentry();

// 스플래시 자동 숨김 방지 — 폰트 로드 완료 후 수동 해제
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Phase 0에서는 시스템 폰트로 먼저 돌리고, 폰트 패키지는 Phase 1에 붙입니다.
  // (expo-google-fonts/noto-serif-kr 등은 용량 큼 — 나중에 추가)
  const [loaded, error] = useFonts({
    // Phase 1 에 추가: NotoSerifKR_500Medium, NotoSansKR_400Regular 등
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#C4967E" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#FAFAF8" },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
