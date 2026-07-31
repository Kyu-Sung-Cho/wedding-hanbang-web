import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Tabs, usePathname } from "expo-router";
import { Home, MessageCircle, Users, User } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/ui/AppUI";
import {
  getCachedCommunityFeed,
  putCachedCommunityFeed,
  putCachedCommunityPosts,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";

const COMMUNITY_WARM_LIMIT = 12;
type AuthStatus = "checking" | "authenticated" | "guest" | "error";

type WarmedCommunityPost = CachedCommunityPost & {
  images?: string[] | null;
};

function normalizeWarmPost(post: WarmedCommunityPost): CachedCommunityPost {
  return {
    ...post,
    image_urls: post.image_urls ?? post.images ?? [],
  };
}

export default function TabsLayout() {
  const pathname = usePathname();
  const isPublicCommunity = pathname === "/community";
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authAttempt, setAuthAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAuthStatus("checking");

    async function checkSession() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (!active) return;

      setAuthStatus(error ? "error" : session ? "authenticated" : "guest");
    }

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event === "INITIAL_SESSION") return;
      setAuthStatus(session ? "authenticated" : "guest");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authAttempt]);

  useEffect(() => {
    let cancelled = false;

    async function warmCommunityFeed() {
      if (getCachedCommunityFeed("all")) return;

      try {
        const data = await apiJson<{ posts: WarmedCommunityPost[] }>(
          `/api/community/posts?sort=new&limit=${COMMUNITY_WARM_LIMIT}`
        );
        if (cancelled) return;

        const posts = (data.posts ?? []).map(normalizeWarmPost);
        putCachedCommunityFeed("all", posts);
        putCachedCommunityPosts(posts);
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
  }, []);

  if (!isPublicCommunity && authStatus === "checking") {
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
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.06,
          shadowRadius: 24,
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "NotoSansKR_500Medium",
        },
        tabBarItemStyle: {
          borderRadius: 18,
          marginHorizontal: 3,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "홈",
          href: protectedTabHref,
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          tabBarAccessibilityLabel: "홈",
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "아모라",
          href: protectedTabHref,
          tabBarIcon: ({ color, size }) => <MessageCircle size={size} color={color} />,
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
