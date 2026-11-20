import { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { Redirect, Tabs } from "expo-router";
import { colors, invitationPalette } from "@hanbang/design-tokens";
import { HOME_COPY } from "@hanbang/shared/invitation";
import InvitationTabsBar from "@/components/invitationLive/InvitationTabsBar";
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
 * 하단 메뉴는 넷이다: 홈·아모라와 대화·준비 순서·일정(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인
 * 완전 같아야해). 2026-11-13 의 "라운지·아모라 둘"을 뒤집는다. 메뉴는 아티팩트의 떠 있는 알약
 * (`InvitationTabBar`)이고 화면 위에 겹쳐 그려진다 — 탭 화면은 메뉴 높이만큼 아래를 비운다.
 * 커뮤니티와 내 정보는 여전히 탭이 아니다. 내 정보는 홈 오른쪽 위 머리글자에서 연다(`app/profile.tsx`),
 * 커뮤니티는 내 정보에서 연다. 이 폴더에 파일을 더 두면 Expo Router 가 선언하지 않아도 탭으로 올린다.
 *
 * 공개 탭(커뮤니티)이 빠져서 탭 안은 전부 로그인한 사람의 자리다. 로그아웃 상태면 어느 탭이든
 * 로그인으로 보낸다. 로그인 없이 커뮤니티 글을 읽는 길은 탭 밖 커뮤니티 화면에 그대로 있다.
 */
export default function TabsLayout() {
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
      // 메뉴의 칸·아이콘·읽어 주는 이름은 아티팩트 그대로다(`InvitationTabBar`, `HOME_COPY.nav`).
      tabBar={(props) => {
        const focused = props.state.routes[props.state.index];
        return (
          <InvitationTabsBar focused={focused?.name} onSelect={(screen) => props.navigation.navigate(screen)} />
        );
      }}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: invitationPalette.white } }}
    >
      <Tabs.Screen name="lounge" options={{ title: HOME_COPY.nav.home }} />
      <Tabs.Screen name="chat" options={{ title: HOME_COPY.nav.chat }} />
      <Tabs.Screen name="journey" options={{ title: HOME_COPY.nav.journey }} />
      <Tabs.Screen name="schedule" options={{ title: HOME_COPY.nav.schedule }} />
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
