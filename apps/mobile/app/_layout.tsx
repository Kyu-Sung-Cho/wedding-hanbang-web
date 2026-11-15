import { Stack, useNavigationContainerRef } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { initSentry, registerSentryNavigationContainer, Sentry } from "@/lib/sentry";
import { disposeAuthListener, initAuthListener } from "@/lib/authListener";
import { colors } from "@hanbang/design-tokens";
import ErrorBoundary from "@/components/ErrorBoundary";
import ConsentGate from "@/components/ConsentGate";
import OfflineBanner from "@/components/OfflineBanner";
import { appFonts } from "@/lib/appFonts";
import { AppFontProvider } from "@/components/ui/AppText";

// Sentry 초기화
initSentry();

// 스플래시 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const navigationContainerRef = useNavigationContainerRef();
  const [fontsLoaded, fontError] = useFonts(appFonts);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // 세션 만료 감지 리스너
  useEffect(() => {
    initAuthListener();
    return disposeAuthListener;
  }, []);

  useEffect(() => {
    let active = true;
    let dispose: () => void = () => undefined;
    void import("@/lib/notifications")
      .then(({ initCommunityPushNotificationNavigation }) => {
        if (!active) return;
        dispose = initCommunityPushNotificationNavigation();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      dispose();
    };
  }, []);

  useEffect(() => {
    registerSentryNavigationContainer(navigationContainerRef);
  }, [navigationContainerRef]);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.rose[500]} />
      </View>
    );
  }

  return (
    <AppFontProvider loaded={fontsLoaded}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <OfflineBanner />
          <StatusBar style="dark" />
          <ConsentGate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
            <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
            {/* 초대 링크(`hanbang://invite#WH-...`)가 착지하는 자리. 코드만 꺼내
                기억하고 곧바로 루트나 로그인으로 넘기므로 화면이 남지 않게 fade로 둔다. */}
            <Stack.Screen name="invite" options={{ headerShown: false, animation: "fade" }} />
            <Stack.Screen name="schedule" options={{ headerShown: false }} />
            <Stack.Screen name="checklist" options={{ headerShown: false }} />
            <Stack.Screen name="budget" options={{ headerShown: false }} />
            <Stack.Screen name="amora-preparation" options={{ headerShown: false }} />
            <Stack.Screen name="vendors" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="market-prices" options={{ headerShown: false }} />
            <Stack.Screen name="quote-check" options={{ headerShown: false }} />
            <Stack.Screen name="wedding-code" options={{ headerShown: false }} />
            <Stack.Screen name="webview" options={{ headerShown: false }} />
            {/* 2026-11-13: 커뮤니티와 내 정보는 하단 탭이 아니다(탭은 라운지·아모라 둘). 라운지에서 여는
                화면이고 스스로 뒤로 가기를 가진다. */}
            <Stack.Screen name="community" options={{ headerShown: false }} />
            <Stack.Screen name="profile" options={{ headerShown: false }} />
          </Stack>
          </ConsentGate>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
    </AppFontProvider>
  );
}

export default Sentry.wrap(RootLayout);
