import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { initSentry } from "@/lib/sentry";
import { disposeAuthListener, initAuthListener } from "@/lib/authListener";
import { supabase } from "@/lib/supabase";
import { colors } from "@hanbang/design-tokens";
import ErrorBoundary from "@/components/ErrorBoundary";
import OfflineBanner from "@/components/OfflineBanner";

const paperlogyFonts = {
  Paperlogy_100Thin: require("../assets/fonts/paperlogy/Paperlogy-1Thin.ttf"),
  Paperlogy_200ExtraLight: require("../assets/fonts/paperlogy/Paperlogy-2ExtraLight.ttf"),
  Paperlogy_300Light: require("../assets/fonts/paperlogy/Paperlogy-3Light.ttf"),
  Paperlogy_400Regular: require("../assets/fonts/paperlogy/Paperlogy-4Regular.ttf"),
  Paperlogy_500Medium: require("../assets/fonts/paperlogy/Paperlogy-5Medium.ttf"),
  Paperlogy_600SemiBold: require("../assets/fonts/paperlogy/Paperlogy-6SemiBold.ttf"),
  Paperlogy_700Bold: require("../assets/fonts/paperlogy/Paperlogy-7Bold.ttf"),
  Paperlogy_800ExtraBold: require("../assets/fonts/paperlogy/Paperlogy-8ExtraBold.ttf"),
  Paperlogy_900Black: require("../assets/fonts/paperlogy/Paperlogy-9Black.ttf"),
};

const NotoSerifKR_300Light = paperlogyFonts.Paperlogy_300Light;
const NotoSerifKR_400Regular = paperlogyFonts.Paperlogy_400Regular;
const NotoSerifKR_500Medium = paperlogyFonts.Paperlogy_500Medium;
const NotoSansKR_300Light = paperlogyFonts.Paperlogy_300Light;
const NotoSansKR_400Regular = paperlogyFonts.Paperlogy_400Regular;
const NotoSansKR_500Medium = paperlogyFonts.Paperlogy_500Medium;
const NotoSansKR_600SemiBold = paperlogyFonts.Paperlogy_600SemiBold;
const NotoSansKR_700Bold = paperlogyFonts.Paperlogy_700Bold;
const CormorantGaramond_300Light = paperlogyFonts.Paperlogy_300Light;
const CormorantGaramond_400Regular = paperlogyFonts.Paperlogy_400Regular;
const CormorantGaramond_600SemiBold = paperlogyFonts.Paperlogy_600SemiBold;

type ComponentWithDefaultStyle = {
  defaultProps?: {
    style?: unknown;
  };
};

function installDefaultFont(component: ComponentWithDefaultStyle) {
  component.defaultProps = component.defaultProps ?? {};
  component.defaultProps.style = [
    component.defaultProps.style,
    { fontFamily: "NotoSansKR_400Regular" },
  ];
}

installDefaultFont(Text as ComponentWithDefaultStyle);
installDefaultFont(TextInput as ComponentWithDefaultStyle);

// 폰트 import

// Sentry 초기화
initSentry();

// 스플래시 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    // Paperlogy mapped through legacy aliases for existing screens.
    NotoSerifKR_300Light,
    NotoSerifKR_400Regular,
    NotoSerifKR_500Medium,
    // Body/UI aliases.
    NotoSansKR_300Light,
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_600SemiBold,
    NotoSansKR_700Bold,
    // Numeric/display aliases.
    CormorantGaramond_300Light,
    CormorantGaramond_400Regular,
    CormorantGaramond_600SemiBold,
  });

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

  // 딥링크는 index를 거치지 않을 수 있으므로, 루트 네비게이터에서 비공개 화면을 막는다.
  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSignedIn(Boolean(data.session));
        setAuthReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setSignedIn(false);
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSignedIn(Boolean(session));
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // 알림 종류별 동의·토큰 폐기 계약이 연결되기 전에는 시작 시 권한을 묻지 않는다.
  // 운영자가 명시적으로 플래그를 켠 빌드에서만 등록한다.
  useEffect(() => {
    const pushEnabled = process.env.EXPO_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true";
    if (fontsLoaded && !__DEV__ && signedIn && pushEnabled) {
      import("@/lib/notifications").then(({ registerForPushNotifications }) => {
        registerForPushNotifications().catch(() => {});
      });
    }
  }, [fontsLoaded, signedIn]);

  if ((!fontsLoaded && !fontError) || !authReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.rose[500]} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <OfflineBanner />
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
            </Stack.Protected>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
              <Stack.Screen name="schedule" options={{ headerShown: false }} />
              <Stack.Screen name="budget" options={{ headerShown: false }} />
              <Stack.Screen name="bookings" options={{ headerShown: false }} />
              <Stack.Screen name="settings" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Screen name="vendors" options={{ headerShown: false }} />
            <Stack.Screen name="market-prices" options={{ headerShown: false }} />
            <Stack.Screen name="etiquette" options={{ headerShown: false }} />
            <Stack.Screen name="webview" options={{ headerShown: false }} />
            <Stack.Screen name="community" options={{ headerShown: false }} />
          </Stack>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
