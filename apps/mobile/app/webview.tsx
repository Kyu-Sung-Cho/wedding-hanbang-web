// 범용 WebView 화면 — hanbang.ai 페이지를 앱 내에서 표시
import { useState, useRef, useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Share, Linking, Alert } from "react-native";
import { Text } from "@/components/ui/AppText";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, Share2 } from "lucide-react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { colors } from "@hanbang/design-tokens";
import { apiFetchForWebBridge } from "@/lib/api";
import { preparationNavigation } from "@/lib/amoraPreparationSource";
import {
  MOBILE_WEB_API_PROTOCOL,
  MOBILE_WEB_API_NONCE_PROPERTY,
  buildMobileWebApiResponseScript,
  createMobileWebApiAuthRedirectGate,
  createMobileWebApiRequestGate,
  isMobileWebApiBridgeSourceUrl,
  parseMobileWebApiRequest,
  readMobileWebApiResponseBody,
  runMobileWebApiRequestWithTimeout,
} from "@/lib/mobileWebApiBridge.mjs";
import {
  normalizeMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";
import { holdsUnsavedWork } from "@/lib/webviewUnsavedWork.mjs";
import { checklistCategoryFromSearch, checklistRoute } from "@/lib/checklistCategoryParam";

const SITE_ORIGIN = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const MAX_BRIDGE_CONTENT_TYPE_LENGTH = 256;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function canOpenExternally(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    if (pathname === "/price" || pathname.startsWith("/price/")) return "업체 공시가";
    // 예절 안내는 편마다 하위 경로가 있다(/wedding/manners/cost-saving). 아래 map은
    // **마지막 조각**으로 찾기 때문에 편 안으로 들어가면 못 잡는다 — prefix로 본다.
    if (/^\/(wedding\/)?manners(\/|$)/.test(pathname)) return "결혼 예절 안내";
    // 웨딩코드도 하위 경로가 있다(`/wedding-code/taste`, `/wedding-code/c/<코드>`).
    // 같은 이유로 prefix 로 본다 — 아래 map 은 마지막 조각만 보기 때문이다.
    if (/^\/wedding-code(\/|$)/.test(pathname)) return "웨딩코드";
    const segment = pathname.split("/").filter(Boolean).pop();
    const map: Record<string, string> = {
      vendors: "업체 탐색",
      budget: "예산 관리",
      schedule: "일정 관리",
      chat: "AI 채팅",
      settings: "설정",
      fitting: "AI 드레스 미리 보기",
      "quote-check": "견적 체크",
    };
    return (segment && map[segment]) || "웨딩한방";
  } catch {
    return "웨딩한방";
  }
}

/**
 * 웹의 로그인 필요 화면 → 앱의 같은 화면.
 *
 * 웹뷰에는 앱의 세션이 없다(쿠키를 넘기지 않는다). 그래서 웹 페이지 안의 링크를 따라
 * 로그인 필요 경로로 들어가면, **앱에 이미 로그인한 사용자가 웹 로그인 폼을 만난다.**
 * 실제로 예절 안내 첫 화면의 주 CTA가 `/wedding/checklist`다.
 *
 * 같은 화면이 앱에 네이티브로 있으므로 거기로 넘긴다. 세션 토큰을 웹뷰에 주입하는
 * 방법도 있지만 그건 보안 결정이라 여기서 하지 않는다.
 *
 * 공개 페이지(`/price`, `/start-here`, `/demo`, `/manners`)는 로그인이 필요 없으니
 * 그대로 웹뷰에서 연다 — 막으면 오히려 읽을 것을 못 읽게 된다.
 *
 * 라운지(`/wedding/lounge`)도 로그인 필요 경로다. 2026-09-17 에 예절 안내의 로고와 모바일
 * 목록 「홈」 버튼이 라운지로 가게 바뀌면서(85e45aead) 앱 웹뷰에서 그 버튼이 웹 로그인 화면을
 * 열었다. 라운지는 앱의 첫 탭이라 그리로 보낸다.
 *
 * **이 표는 문서를 새로 여는 이동에서만 쓰인다**(`handleNavigation` =
 * `onShouldStartLoadWithRequest`). `next/link` 의 클라이언트 이동은 `pushState` 라서
 * react-native-webview 가 그 콜백에 보내지 않는다 — iOS 는 history 심이 `onLoadingFinish` 로,
 * 안드로이드는 `doUpdateVisitedHistory` 가 `onLoadingStart` 로 보낸다. 그리고 그때 보이는
 * 주소는 목적지가 아니라 웹 프록시가 돌린 `/login?redirect=…` 다. 그래서 웹은 이런 링크를
 * 앱 웹뷰에서 평범한 `<a href>` 로 그린다(`apps/web/src/components/common/
 * FullPageLinkInsideMobileApp.tsx`). 웹에 새 로그인 필요 링크를 달 때도 그것을 쓴다.
 */
const WEB_TO_NATIVE: Readonly<Record<string, string>> = {
  lounge: "/lounge",
  checklist: "/checklist",
  budget: "/budget",
  schedule: "/schedule",
  settings: "/settings",
  bookings: "/bookings",
  vendors: "/vendors",
  chat: "/chat",
};

/**
 * 웹 경로(+쿼리)를 앱 화면 주소로 바꾼다. 넘길 화면이 없으면 `null` — 웹뷰에서 그대로 연다.
 *
 * 체크리스트는 `?category=` 를 들고 간다. 예절 안내 편 끝의 「체크리스트에서 확인하기」가
 * `/wedding/checklist?category=venue` 인데, 예전에는 경로만 보고 분야를 버려 사용자가 분야를
 * 다시 찾아야 했다. 분야 값은 공유 체크리스트 분야 키만 받는다(`checklistCategoryParam`).
 */
export function nativeRouteForWebPath(pathname: string, search = ""): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const head = parts[0] === "wedding" ? parts[1] : parts[0];
  // `constructor` 같은 객체 원형의 이름이 경로로 새지 않게 자기 칸만 본다.
  if (!head || !Object.prototype.hasOwnProperty.call(WEB_TO_NATIVE, head)) return null;
  const route = WEB_TO_NATIVE[head];
  if (route === "/checklist") return checklistRoute(checklistCategoryFromSearch(search));
  return route;
}

export default function WebViewScreen() {
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const url = firstParam(params.url);
  const safeUrl = normalizeMobileSiteUrl(url, SITE_ORIGIN);
  const webViewRef = useRef<WebView>(null);
  const documentEpochRef = useRef(0);
  const [bridgeNonce] = useState(() => Crypto.randomUUID());
  const [bridgeRequestGate] = useState(() => createMobileWebApiRequestGate());
  const [bridgeAuthRedirectGate] = useState(() => createMobileWebApiAuthRedirectGate());
  const [loading, setLoading] = useState(true);
  // 불러오지 못했을 때. 지금까지는 실패해도 스피너만 꺼져서 플랫폼 기본 에러 화면이 남았다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(titleFromUrl(safeUrl ?? ""));
  const [currentUrl, setCurrentUrl] = useState(safeUrl ?? "");
  const [canGoBack, setCanGoBack] = useState(false);
  const bridgeNonceScript = useMemo(() => {
    const property = JSON.stringify(MOBILE_WEB_API_NONCE_PROPERTY);
    const nonce = JSON.stringify(bridgeNonce);
    return `(()=>{if(window.top!==window.self)return true;const key=${property};const nonce=${nonce};if(window[key]===nonce)return true;if(window[key]!==undefined)return false;Object.defineProperty(window,key,{value:nonce,writable:false,configurable:false,enumerable:false});return true;})();true;`;
  }, [bridgeNonce]);

  const handleShare = useCallback(async () => {
    if (!currentUrl) return;
    try {
      await Share.share({ url: currentUrl, message: currentUrl });
    } catch {
      // 공유 취소
    }
  }, [currentUrl]);

  const handleBack = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
      return;
    }
    router.back();
  }, [canGoBack]);

  // 설정된 동일 origin 링크는 WebView에서, 외부 링크는 브라우저에서 연다.
  //
  // 네이티브 화면으로 넘길 때는 `replace` 가 아니라 `dismissTo` 다. 웹뷰는 루트 Stack 화면이라
  // `replace('/chat…')` 는 웹뷰 자리를 새 key 의 `(tabs)`로 바꿔 [(tabs), (tabs)]가 되고 채팅 화면이
  // 둘 마운트된다. `dismissTo` 는 아래에 있는 기존 화면(`(tabs)`, 체크리스트 등)으로 돌아가고,
  // 없으면 웹뷰 자리를 그 화면으로 바꾼다(예전 `replace` 와 같다). 체크리스트 시트의 아모라 버튼과 같은 방식이다.
  const handleNavigation = useCallback((event: { url: string }) => {
    const nextUrl = normalizeMobileSiteUrl(event.url, SITE_ORIGIN);
    if (nextUrl) {
      const preparation = preparationNavigation(nextUrl);
      if (preparation) {
        if ("invalid" in preparation) Alert.alert("안내를 확인하지 못했어요", "원래 안내에서 질문 버튼을 다시 눌러 주세요.");
        else router.dismissTo(preparation.route as Parameters<typeof router.dismissTo>[0]);
        return false;
      }
      // 로그인 필요한 화면은 웹뷰에서 열지 않는다 — 웹뷰에 세션이 없어 로그인 폼이 뜬다.
      // 쿼리도 함께 넘긴다 — 체크리스트는 `?category=` 로 그 분야를 바로 연다.
      const parsedNext = new URL(nextUrl);
      const native = nativeRouteForWebPath(parsedNext.pathname, parsedNext.search);
      if (native) {
        router.dismissTo(native as Parameters<typeof router.dismissTo>[0]);
        return false;
      }
      setCurrentTitle(titleFromUrl(nextUrl));
      return true;
    }

    if (canOpenExternally(event.url)) {
      Linking.openURL(event.url).catch(() => undefined);
      return false;
    }

    return false;
  }, []);

  const handleNavigationStateChange = useCallback((event: { url: string; canGoBack: boolean }) => {
    const nextUrl = normalizeMobileSiteUrl(event.url, SITE_ORIGIN);
    if (!nextUrl) return;
    setCurrentUrl(nextUrl);
    setCurrentTitle(titleFromUrl(nextUrl));
    setCanGoBack(event.canGoBack);
  }, []);

  const handleLoadStart = useCallback(() => {
    documentEpochRef.current += 1;
    setLoadFailed(false);
    setLoading(true);
  }, []);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    if (!isMobileWebApiBridgeSourceUrl(event.nativeEvent.url, SITE_ORIGIN)) return;
    const request = parseMobileWebApiRequest(
      event.nativeEvent.data,
      bridgeNonce,
      event.nativeEvent.url,
    );
    if (!request) return;
    const requestEpoch = documentEpochRef.current;
    const gateResult = bridgeRequestGate.begin(request.id);
    if (gateResult === "replay") return;

    if (gateResult !== "accepted") {
      if (requestEpoch !== documentEpochRef.current) return;
      const responseScript = buildMobileWebApiResponseScript({
        protocol: MOBILE_WEB_API_PROTOCOL,
        nonce: bridgeNonce,
        id: request.id,
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." }),
      });
      webViewRef.current?.injectJavaScript(responseScript);
      return;
    }

    let status = 503;
    let contentType = "application/json";
    let body = JSON.stringify({ error: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." });
    let redirectToNativeLogin = false;

    try {
      const response = await runMobileWebApiRequestWithTimeout((signal: AbortSignal) => (
        apiFetchForWebBridge(request.path, {
          method: request.method,
          headers: request.headers,
          signal,
          ...(request.body === undefined ? {} : { body: request.body }),
        })
      ));
      status = response.status;
      const responseContentType = response.headers.get("content-type");
      contentType = responseContentType && responseContentType.length <= MAX_BRIDGE_CONTENT_TYPE_LENGTH
        ? responseContentType
        : "application/json";
      const responseBody = await readMobileWebApiResponseBody(response);
      if (response.status === 401) {
        if (responseBody.ok) {
          body = responseBody.body;
        } else {
          contentType = "application/json";
          body = JSON.stringify({ error: "로그인이 필요합니다." });
        }
        redirectToNativeLogin = requestEpoch === documentEpochRef.current
          && bridgeAuthRedirectGate.claim();
      } else if (!responseBody.ok) {
        status = 502;
        contentType = "application/json";
        body = JSON.stringify({ error: "응답이 너무 커서 안전하게 표시할 수 없어요." });
      } else {
        body = responseBody.body;
      }
    } catch {
      // 네트워크·세션 오류는 허용 목록 응답 채널로만 웹 화면에 전달한다.
    } finally {
      bridgeRequestGate.finish(request.id);
    }

    // A response belongs only to the main document that initiated it. A full
    // navigation invalidates pending results before bearer-authenticated data
    // can be injected into a later page.
    if (requestEpoch !== documentEpochRef.current) return;
    const responseScript = buildMobileWebApiResponseScript({
      protocol: MOBILE_WEB_API_PROTOCOL,
      nonce: bridgeNonce,
      id: request.id,
      status,
      contentType,
      body,
    });
    webViewRef.current?.injectJavaScript(responseScript);
    if (redirectToNativeLogin) {
      router.replace("/(auth)/login");
    }
  }, [bridgeAuthRedirectGate, bridgeNonce, bridgeRequestGate]);

  if (!safeUrl) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="이전 화면">
            <ArrowLeft size={24} color={colors.noir[800]} />
          </Pressable>
          <Text style={styles.headerTitle}>오류</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.textTertiary }}>URL이 제공되지 않았습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12} accessibilityLabel="이전 화면">
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{currentTitle}</Text>
        <Pressable onPress={handleShare} hitSlop={12} accessibilityLabel="현재 페이지 공유">
          <Share2 size={20} color={colors.noir[800]} />
        </Pressable>
      </View>

      {/* 로딩 인디케이터 */}
      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color={colors.rose[500]} />
        </View>
      )}

      {/* 불러오지 못했을 때 — 플랫폼 기본 에러 대신 다시 시도할 자리를 준다 */}
      {loadFailed ? (
        <View style={styles.failure}>
          <Text style={styles.failureTitle}>지금은 불러오지 못했어요</Text>
          <Text style={styles.failureBody}>
            연결을 확인한 뒤 다시 시도해 주세요. 앱에 저장된 준비 목록은 그대로 있어요.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => { setLoadFailed(false); webViewRef.current?.reload(); }}
            accessibilityRole="button"
            accessibilityLabel="다시 시도"
          >
            <Text style={styles.retryLabel}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: safeUrl }}
        originWhitelist={[SITE_ORIGIN]}
        style={loadFailed ? styles.hidden : { flex: 1 }}
        onLoadStart={handleLoadStart}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoadFailed(true); setLoading(false); }}
        onHttpError={() => { setLoadFailed(true); setLoading(false); }}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleNavigation}
        // 당겨서 새로고침은 답하던 것을 말없이 지울 수 있다. 그런 화면에서만 끈다.
        pullToRefreshEnabled={!holdsUnsavedWork(currentUrl)}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={bridgeNonceScript}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        injectedJavaScript={bridgeNonceScript}
        injectedJavaScriptForMainFrameOnly
        startInLoadingState={false}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hidden: { width: 0, height: 0, opacity: 0 },
  failure: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  failureTitle: { fontSize: 17, fontWeight: "700", color: colors.noir[800] },
  failureBody: { fontSize: 14, lineHeight: 21, color: colors.textTertiary, textAlign: "center" },
  retryButton: {
    marginTop: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: colors.noir[800],
  },
  retryLabel: { fontSize: 15, fontWeight: "600", color: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    textAlign: "center",
    marginHorizontal: 12,
  },
  loadingBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: 60,
    alignItems: "center",
  },
});
