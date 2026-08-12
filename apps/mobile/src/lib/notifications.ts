// 푸시 알림 설정 및 설치·세션별 토큰 소유권 관리
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Platform } from "react-native";
import { colors } from "@hanbang/design-tokens";
import {
  buildCommunityReplyPushPayload,
  type CommunityReplyNotificationTarget,
} from "@hanbang/shared/community-notification";
import { supabase } from "./supabase";
import { releasePushDeliveryOwnership } from "./pushSessionLifecycle.mjs";
import {
  createCommunityPushNavigationGuard,
  createCommunityPushTargetResolver,
} from "./communityPushNavigation.mjs";

const PUSH_INSTALLATION_ID_KEY = "hanbang.push-installation-id.v1";
const PUSH_BOUND_TOKEN_KEY = "hanbang.push-bound-token.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
let installationIdPromise: Promise<string> | null = null;

const resolveCommunityPushTarget = createCommunityPushTargetResolver({
  configuredSiteUrl: process.env.EXPO_PUBLIC_SITE_URL,
  isDevelopment: __DEV__,
});

const communityPushNavigation = createCommunityPushNavigationGuard({
  getAuthContext: async () => {
    const { data, error } = await supabase.auth.getSession();
    const ownerId = data.session?.user.id;
    const accessToken = data.session?.access_token;
    if (error || !ownerId || !accessToken) return null;
    return { ownerId, accessToken };
  },
  resolveTarget: resolveCommunityPushTarget,
  navigate: ({ postId, commentId }) => {
    router.push({
      pathname: "/community/post/[id]",
      params: { id: postId, commentId },
    });
  },
});

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const allowed = await communityPushNavigation.validate(
      notification.request.content.data,
    );
    return {
      shouldShowAlert: allowed,
      shouldPlaySound: allowed,
      shouldSetBadge: allowed,
      shouldShowBanner: allowed,
      shouldShowList: allowed,
    };
  },
});

function getExpoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? null;
}

function getMobilePlatform(): "ios" | "android" | null {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  return null;
}

async function getCurrentExpoPushToken(
  devicePushToken?: Notifications.DevicePushToken,
) {
  const projectId = getExpoProjectId();
  if (!projectId || !Device.isDevice) return null;
  return (await Notifications.getExpoPushTokenAsync({
    projectId,
    ...(devicePushToken ? { devicePushToken } : {}),
  })).data;
}

async function getOrCreatePushInstallationId(): Promise<string> {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const stored = await SecureStore.getItemAsync(PUSH_INSTALLATION_ID_KEY);
      if (stored && UUID_PATTERN.test(stored)) return stored;

      const created = Crypto.randomUUID();
      await SecureStore.setItemAsync(PUSH_INSTALLATION_ID_KEY, created);
      return created;
    })().catch((error: unknown) => {
      installationIdPromise = null;
      throw error;
    });
  }
  return installationIdPromise;
}

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== "android") return;
  // Android 13 권한 요청보다 먼저 채널을 준비해야 시스템 동작이 예측 가능하다.
  await Notifications.setNotificationChannelAsync("default", {
    name: "기본 알림",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.rose[500],
  });
}

async function bindCurrentPushToken(
  devicePushToken?: Notifications.DevicePushToken,
): Promise<string | null> {
  const platform = getMobilePlatform();
  if (!platform || !Device.isDevice) return null;

  const [token, installationId] = await Promise.all([
    getCurrentExpoPushToken(devicePushToken),
    getOrCreatePushInstallationId(),
  ]);
  if (!token) return null;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    throw new Error(`Push token user lookup failed: ${userError.message}`);
  }
  if (!user) return null;

  const { error } = await supabase.rpc("bind_mobile_push_token", {
    p_installation_id: installationId,
    p_push_token: token,
    p_platform: platform,
  });
  if (error) throw new Error(`Push token persistence failed: ${error.message}`);

  // 로그아웃은 새 토큰을 다시 조회하지 않고, 서버에 실제로 성공한
  // compare-and-revoke 값만 사용한다. 회전 중 mismatch 오판을 막는다.
  await SecureStore.setItemAsync(PUSH_BOUND_TOKEN_KEY, token);
  return token;
}

async function clearCachedNotificationState() {
  if (Platform.OS === "web") return;
  const results = await Promise.allSettled([
    Notifications.dismissAllNotificationsAsync(),
    Notifications.cancelAllScheduledNotificationsAsync(),
    Notifications.clearLastNotificationResponseAsync(),
    Notifications.setBadgeCountAsync(0),
  ]);
  const failures = results.flatMap((result) => (
    result.status === "rejected" ? [result.reason] : []
  ));
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "PUSH_NOTIFICATION_CACHE_CLEAR_FAILED",
    );
  }
}

/**
 * 로그인·JWT 갱신·앱 복귀 경로. 이미 허용된 권한만 갱신하며 OS 권한
 * 팝업을 절대 열지 않는다.
 */
export async function refreshExistingPushRegistration(
  devicePushToken?: Notifications.DevicePushToken,
): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return null;
  await configureAndroidNotificationChannel();
  return bindCurrentPushToken(devicePushToken);
}

/**
 * 사용자가 가치 설명을 본 뒤 명시적으로 선택하는 opt-in 경로에서만 호출한다.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    if (__DEV__) console.warn("[Push] 실기기에서만 푸시 알림이 작동합니다.");
    return null;
  }

  await configureAndroidNotificationChannel();
  const { status: existing } = await Notifications.getPermissionsAsync();
  const finalStatus = existing === "granted"
    ? existing
    : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== "granted") return null;

  return bindCurrentPushToken();
}

/** OS 토큰 회전을 즉시 Expo 토큰으로 교환해 같은 설치 바인딩을 갱신한다. */
export function subscribeToPushTokenChanges() {
  if (!Device.isDevice) return null;
  return Notifications.addPushTokenListener((devicePushToken) => {
    void refreshExistingPushRegistration(devicePushToken).catch((error: unknown) => {
      if (__DEV__) console.warn("[Push] 토큰 회전 반영 실패:", error);
    });
  });
}

async function handleCommunityPushResponse(
  response: Notifications.NotificationResponse,
) {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return;
  }
  const handled = await communityPushNavigation.handleTap(
    response.notification.request.content.data,
  );
  if (handled) {
    await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }
}

export async function retryLastCommunityPushResponse() {
  if (Platform.OS === "web") return;
  const response = await Notifications.getLastNotificationResponseAsync();
  if (response) await handleCommunityPushResponse(response);
}

/**
 * Foreground/background/cold-start notification entry point. Every tap is
 * owner-resolved before navigation; no notification is marked read first.
 */
export function initCommunityPushNotificationNavigation() {
  if (Platform.OS === "web") return () => undefined;

  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      void communityPushNavigation
        .validate(notification.request.content.data)
        .then((allowed) => {
          if (allowed) return;
          return Notifications.dismissNotificationAsync(
            notification.request.identifier,
          );
        })
        .catch(() => undefined);
    },
  );
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      void handleCommunityPushResponse(response);
    });

  void retryLastCommunityPushResponse().catch(() => undefined);

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

export function invalidateCommunityPushNavigationForAuthChange() {
  communityPushNavigation.invalidateForAuthChange();
}

/**
 * 로그아웃 전에 서버 바인딩 또는 기기 토큰 중 적어도 하나의 해제를 확인한다.
 * 둘 다 실패하면 계정 전환을 중단한다.
 */
export async function releasePushNotificationsForCurrentSession(expectedOwnerId?: string) {
  invalidateCommunityPushNavigationForAuthChange();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (expectedOwnerId && user?.id !== expectedOwnerId) {
    throw new Error("PUSH_RELEASE_OWNER_CHANGED");
  }
  const [currentToken, installationId] = await Promise.all([
    SecureStore.getItemAsync(PUSH_BOUND_TOKEN_KEY),
    SecureStore.getItemAsync(PUSH_INSTALLATION_ID_KEY),
  ]);

  const result = await releasePushDeliveryOwnership({
    releaseServerToken: async () => {
      const { data: { user: releaseUser }, error: releaseUserError } =
        await supabase.auth.getUser();
      if (userError || releaseUserError) {
        throw new Error(
          `Push token user lookup failed: ${(releaseUserError ?? userError)?.message ?? "unknown"}`,
        );
      }
      if (!releaseUser) throw new Error("Push token release requires a current user");
      if (expectedOwnerId && releaseUser.id !== expectedOwnerId) {
        throw new Error("PUSH_RELEASE_OWNER_CHANGED");
      }

      if (currentToken && installationId && UUID_PATTERN.test(installationId)) {
        const { error } = await supabase.rpc("release_mobile_push_token", {
          p_installation_id: installationId,
          p_push_token: currentToken,
        });
        if (error) throw new Error(`Push token release failed: ${error.message}`);
        return;
      }

      // 업그레이드 직후 로컬 캐시가 아직 없는 이전 앱 바인딩도 uid-wide가
      // 아닌 현재 JWT session_id 범위에서 안전하게 해제한다.
      const { error } = await supabase.rpc("release_mobile_push_token");
      if (error) throw new Error(`Push token release failed: ${error.message}`);
    },
    unregisterDeviceToken: () => Notifications.unregisterForNotificationsAsync(),
    clearCachedNotifications: clearCachedNotificationState,
  });

  await SecureStore.deleteItemAsync(PUSH_BOUND_TOKEN_KEY).catch(() => undefined);
  return result;
}

/** 외부 세션 종료 시 기기 전달·잠금화면 캐시·이전 바인딩 캐시를 지운다. */
export async function unregisterPushNotificationsForSignedOutDevice() {
  invalidateCommunityPushNavigationForAuthChange();
  const results = await Promise.allSettled([
    Notifications.unregisterForNotificationsAsync(),
    clearCachedNotificationState(),
    SecureStore.deleteItemAsync(PUSH_BOUND_TOKEN_KEY),
  ]);
  if (__DEV__) {
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[Push] signed-out notification cleanup failed:", result.reason);
      }
    }
  }
}

/** 잠금 화면에는 글 제목·본문·결혼 정보를 넣지 않는 최소 payload만 쓴다. */
export async function scheduleCommunityReplyNotification(
  target: CommunityReplyNotificationTarget,
  seconds = 1,
) {
  const payload = buildCommunityReplyPushPayload(target);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}
