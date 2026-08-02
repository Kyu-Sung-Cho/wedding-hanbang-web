// 푸시 알림 설정 및 토큰 관리
import * as Notifications from "expo-notifications";
import { safeErrorDiagnostic } from "@/lib/safeErrorDiagnostic";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "./supabase";

export interface MobilePushPreferences {
  pushEnabled: boolean;
  communityEnabled: boolean;
  partnerEnabled: boolean;
  consentedAt: string | null;
  tokenAttached: boolean;
}

type PushPreferencePatch = Partial<Pick<
  MobilePushPreferences,
  "pushEnabled" | "communityEnabled" | "partnerEnabled"
>>;

function parsePushPreferences(value: unknown): MobilePushPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.pushEnabled !== "boolean"
    || typeof row.communityEnabled !== "boolean"
    || typeof row.partnerEnabled !== "boolean"
    || (row.consentedAt !== null && typeof row.consentedAt !== "string")
    || typeof row.tokenAttached !== "boolean"
  ) return null;
  return {
    pushEnabled: row.pushEnabled,
    communityEnabled: row.communityEnabled,
    partnerEnabled: row.partnerEnabled,
    consentedAt: row.consentedAt as string | null,
    tokenAttached: row.tokenAttached,
  };
}

async function readActorPushPreferences(): Promise<{
  userId: string;
  preferences: MobilePushPreferences;
} | null> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (!user) return null;

  const { data, error } = await supabase.rpc(
    "get_my_mobile_push_preferences",
    { p_expected_user_id: user.id },
  );
  if (error) throw new Error("PUSH_PREFERENCES_LOOKUP_FAILED");
  const preferences = parsePushPreferences(data);
  if (!preferences) throw new Error("PUSH_PREFERENCES_RESPONSE_INVALID");

  const { data: { user: afterUser }, error: afterUserError } = await supabase.auth.getUser();
  if (afterUserError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (afterUser?.id !== user.id) throw new Error("PUSH_ACTOR_CHANGED");

  return {
    userId: user.id,
    preferences,
  };
}

export async function getMobilePushPreferences(): Promise<MobilePushPreferences | null> {
  return (await readActorPushPreferences())?.preferences ?? null;
}

export async function updateMobilePushPreferences(
  patch: PushPreferencePatch,
): Promise<MobilePushPreferences> {
  if (
    typeof patch.pushEnabled !== "boolean"
    && typeof patch.communityEnabled !== "boolean"
    && typeof patch.partnerEnabled !== "boolean"
  ) throw new Error("PUSH_PREFERENCE_CHANGE_REQUIRED");

  const before = await readActorPushPreferences();
  if (!before) throw new Error("PUSH_AUTH_REQUIRED");
  const { data, error } = await supabase.rpc("set_my_mobile_push_preferences_v2", {
    p_expected_user_id: before.userId,
    p_push_enabled: patch.pushEnabled ?? null,
    p_community_enabled: patch.communityEnabled ?? null,
    p_partner_enabled: patch.partnerEnabled ?? null,
  });
  if (error) throw new Error("PUSH_PREFERENCES_UPDATE_FAILED");
  const parsed = parsePushPreferences(data);
  if (!parsed) throw new Error("PUSH_PREFERENCES_RESPONSE_INVALID");

  const { data: { user: afterUser }, error: afterUserError } = await supabase.auth.getUser();
  if (afterUserError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (afterUser?.id !== before.userId) throw new Error("PUSH_ACTOR_CHANGED");
  return parsed;
}

export async function detachPushTokenForCurrentUser(): Promise<boolean> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (!user) return true;
  const { data, error } = await supabase.rpc("detach_my_mobile_push_token_v2", {
    p_expected_user_id: user.id,
  });
  if (error || data !== true) throw new Error("PUSH_TOKEN_DETACH_FAILED");

  const { data: { user: afterUser }, error: afterUserError } = await supabase.auth.getUser();
  if (afterUserError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (afterUser?.id !== user.id) throw new Error("PUSH_ACTOR_CHANGED");
  return true;
}

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
  const actor = await readActorPushPreferences();
  if (
    !actor
    || !actor.preferences.pushEnabled
    || !actor.preferences.consentedAt
  ) return null;

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
  let token: string;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    // 오프라인/Expo Go에서는 다음 앱 활성화 또는 로그인 때 다시 시도한다.
    if (__DEV__) console.warn("[Push] 토큰 발급 실패:", safeErrorDiagnostic(error));
    return null;
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || user?.id !== actor.userId) return null;

  const { data: attached, error } = await supabase.rpc(
    "attach_my_mobile_push_token_v2",
    { p_expected_user_id: actor.userId, p_token: token },
  );
  if (error || attached !== true) throw new Error("PUSH_TOKEN_ATTACH_FAILED");

  const { data: { user: afterUser }, error: afterUserError } = await supabase.auth.getUser();
  if (afterUserError) throw new Error("PUSH_AUTH_LOOKUP_FAILED");
  if (afterUser?.id !== actor.userId) throw new Error("PUSH_ACTOR_CHANGED");

  return token;
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
