import { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, StyleSheet, View } from "react-native";
import { Text, useAppFontsLoaded } from "@/components/ui/AppText";
import { Redirect, Tabs } from "expo-router";
import { Home } from "lucide-react-native";
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

/**
 * 하단 탭은 웨딩 라운지와 아모라 둘이다(2026-11-13 파운더 결정 "메인 두개만 남길거야 아모라랑 웨딩
 * 대쉬보드", 앱 구성은 같은 날 파운더 확인). 커뮤니티는 라운지의 준비 도구 칸과 내 정보에서 열고
 * (`app/community/index.tsx`), 내 정보는 라운지 머리줄에서 연다(`app/profile.tsx`). 둘 다 뒤로 가기가
 * 있는 화면이다. 이 폴더에 파일을 더 두면 Expo Router 가 선언하지 않아도 탭으로 올린다.
 *
 * 공개 탭(커뮤니티)이 빠져서 탭 안은 전부 로그인한 사람의 자리다. 로그아웃 상태면 어느 탭이든
 * 로그인으로 보낸다. 로그인 없이 커뮤니티 글을 읽는 길은 탭 밖 커뮤니티 화면에 그대로 있다.
 */
export default function TabsLayout() {
  const fontsLoaded = useAppFontsLoaded();
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

    // 홈의 첫 화면 전환과 핵심 데이터 로드를 먼저 끝낸 뒤 보조 피드를 데운다. 커뮤니티는 이제 탭이
    // 아니라 라운지 칸에서 여는 화면이지만, 누르자마자 글이 보이도록 데워 두는 것은 같다.
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

  if (authStatus === "error") {
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

  if (authStatus === "guest") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      key={communityViewerKey}
      screenOptions={{
        headerShown: false,
        // DESIGN.md Warm interactions: 선택된 탭은 rose.pale 면 위 rose[700](4.71:1), 선택 안 된
        // 탭은 잉크 단계 inkFaint(6.46:1). 예전 taupe[400] 은 2.28:1 로 읽히지 않았다. 흐린 글자를
        // 진하게 하면 선택 탭과 색 차이가 줄어서, 색만으로 구분하지 않도록 선택 면을 깐다.
        tabBarActiveTintColor: colors.rose[700],
        tabBarActiveBackgroundColor: colors.rose.pale,
        tabBarInactiveTintColor: colors.paper.inkFaint,
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
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          tabBarAccessibilityLabel: "웨딩 라운지",
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "아모라",
          tabBarIcon: ({ color, size }) => <AmoraMark size={size} color={color} />,
          tabBarAccessibilityLabel: "아모라",
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
