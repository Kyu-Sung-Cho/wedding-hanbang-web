// 푸시 알림 설정 및 토큰 관리
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "./supabase";

// 알림 표시 방법 설정
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * 푸시 알림 권한 요청 + Expo Push Token 발급 + Supabase에 저장
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // 실기기만 지원 (시뮬레이터 X)
  if (!Device.isDevice) {
    console.warn("[Push] 실기기에서만 푸시 알림이 작동합니다.");
    return null;
  }

  // 권한 확인
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("[Push] 알림 권한이 거부되었습니다.");
    return null;
  }

  // Android: 채널 생성
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "기본 알림",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: colors.rose[500],
    });
  }

  // Expo Push Token 발급 (EAS Build에서만 작동, Expo Go에서는 스킵)
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Supabase profiles에 push token 저장
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ push_token: token })
        .eq("id", user.id);
    }

    return token;
  } catch {
    // Expo Go에서는 projectId가 없어서 실패 — 정상 (EAS Build 후 작동)
    return null;
  }
}

/**
 * 로컬 알림 스케줄 (앱 내부에서 직접 알림)
 */
export async function scheduleLocalNotification(title: string, body: string, seconds = 1) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}
