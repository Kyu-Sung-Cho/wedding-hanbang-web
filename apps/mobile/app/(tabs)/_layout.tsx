import { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, StyleSheet, View } from "react-native";
import { Text, useAppFontsLoaded } from "@/components/ui/AppText";
import { Redirect, Tabs, usePathname } from "expo-router";
import { Home, Users, User } from "lucide-react-native";
import AmoraMark from "@/components/ui/AmoraMark";
import { colors } from "@hanbang/design-tokens";
import { apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/ui/AppUI";
import {
  captureCommunityCacheScope,
  getCachedCommunityFeed,
  isCommunityCacheScopeCurrent,
  putCachedCommunityFeed,
  putCachedCommunityPosts,
  setCommunityCacheViewer,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";
import { parseCommunityPostTrust } from "@/lib/communityTrust.mjs";

const COMMUNITY_WARM_LIMIT = 12;
type AuthStatus = "checking" | "authenticated" | "guest" | "error";

type WarmedCommunityPost = CachedCommunityPost & {
  images?: string[] | null;
};

function normalizeWarmPost(value: unknown): CachedCommunityPost | null {
  const trust = parseCommunityPostTrust(value);
  if (!trust || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const post = value as WarmedCommunityPost;
  return {
    ...post,
    content_origin: trust.contentOrigin,
    ad_disclosure: trust.adDisclosure,
    sponsorship_detail: trust.sponsorshipDetail,
    is_resolved: trust.isResolved,
    under_review: trust.underReview,
    image_urls: post.image_urls ?? post.images ?? [],
  };
}

export default function TabsLayout() {
  const fontsLoaded = useAppFontsLoaded();
  const pathname = usePathname();
  const isPublicCommunity = pathname === "/community";
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [communityViewerKey, setCommunityViewerKey] = useState("checking");
  const [authAttempt, setAuthAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAuthStatus("checking");
    setCommunityViewerKey("checking");

    function applyViewer(viewerId: string | null, nextStatus: AuthStatus) {
      setCommunityCacheViewer(viewerId);
      setCommunityViewerKey(captureCommunityCacheScope().viewerKey);
      setAuthStatus(nextStatus);
    }

    async function checkSession() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (!active) return;

      if (error) {
        applyViewer(null, "error");
        return;
      }

      applyViewer(
        session?.user?.id ?? null,
        session ? "authenticated" : "guest",
      );
    }

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event === "INITIAL_SESSION") return;
      applyViewer(
        session?.user?.id ?? null,
        session ? "authenticated" : "guest",
      );
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authAttempt]);

  useEffect(() => {
    if (authStatus === "checking") return;

    let cancelled = false;

    async function warmCommunityFeed() {
      if (getCachedCommunityFeed("all")) return;
      const cacheScope = captureCommunityCacheScope();

      try {
        const data = await apiJson<{ posts?: unknown }>(
          `/api/community/posts?sort=new&limit=${COMMUNITY_WARM_LIMIT}`
        );
        if (cancelled || !isCommunityCacheScopeCurrent(cacheScope)) return;

        if (!Array.isArray(data.posts)) return;
        const posts = data.posts
          .map(normalizeWarmPost)
          .filter((post): post is CachedCommunityPost => post !== null);
        putCachedCommunityFeed("all", posts, cacheScope);
        putCachedCommunityPosts(posts, cacheScope);
      } catch {
        // Best-effort warmup. The community screen still performs its own load.
      }
    }

    // 홈의 첫 화면 전환과 핵심 데이터 로드를 먼저 끝낸 뒤 보조 피드를 데운다.
    const warmTask = InteractionManager.runAfterInteractions(
      warmCommunityFeed,
    );
    return () => {
      cancelled = true;
      warmTask.cancel();
    };
  }, [authStatus, communityViewerKey]);

  if (authStatus === "checking") {
    return (
      <View style={styles.authState}>
        <ActivityIndicator color={colors.rose[500]} size="large" />
        <Text style={styles.authStateBody}>로그인 상태를 확인하고 있어요</Text>
      </View>
    );
  }

  if (!isPublicCommunity && authStatus === "error") {
    return (
      <View style={styles.authState}>
        <Text style={styles.authStateTitle}>로그인 상태를 확인하지 못했어요</Text>
        <Text style={styles.authStateBody}>
          연결을 확인한 뒤 다시 시도해주세요.
        </Text>
        <PrimaryButton
          tone="rose"
          style={styles.retryButton}
          onPress={() => setAuthAttempt((attempt) => attempt + 1)}
        >
          다시 시도
        </PrimaryButton>
      </View>
    );
  }

  if (authStatus === "guest" && !isPublicCommunity) {
    return <Redirect href="/(auth)/login" />;
  }

  const protectedTabHref =
    authStatus === "authenticated" ? undefined : null;

  return (
    <Tabs
      key={communityViewerKey}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.rose[500],
        tabBarInactiveTintColor: colors.taupe[400],
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          height: 86,
          paddingTop: 10,
          paddingBottom: 24,
          shadowColor: colors.paper.ink,
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.06,
          shadowRadius: 24,
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: fontsLoaded ? "Pretendard_500Medium" : undefined,
        },
        tabBarItemStyle: {
          borderRadius: 18,
          marginHorizontal: 3,
        },
      }}
    >
      <Tabs.Screen
        name="lounge"
        options={{
          // 탭에는 짧게 "라운지", 읽어주는 이름과 화면 제목은 "웨딩 라운지".
          // 같은 이름의 줄임말일 뿐, 이전처럼 화면마다 다른 이름을 쓰지 않는다.
          title: "라운지",
          href: protectedTabHref,
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          tabBarAccessibilityLabel: "웨딩 라운지",
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "아모라",
          href: protectedTabHref,
          tabBarIcon: ({ color, size }) => <AmoraMark size={size} color={color} />,
          tabBarAccessibilityLabel: "아모라",
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "커뮤니티",
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
          tabBarAccessibilityLabel: "커뮤니티",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "내 정보",
          href: protectedTabHref,
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
          tabBarAccessibilityLabel: "내 정보",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  authState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.bg,
  },
  authStateTitle: {
    fontSize: 20,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
  },
  authStateBody: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
  },
  retryButton: {
    width: "100%",
    maxWidth: 320,
    marginTop: 8,
  },
});
