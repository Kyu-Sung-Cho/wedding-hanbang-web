import { useEffect } from "react";
import { Tabs } from "expo-router";
import { Home, MessageCircle, Users, User } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  getCachedCommunityFeed,
  putCachedCommunityFeed,
  putCachedCommunityPosts,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";

const COMMUNITY_WARM_LIMIT = 12;

type WarmedCommunityPost = CachedCommunityPost;

export default function TabsLayout() {
  useEffect(() => {
    let cancelled = false;

    async function warmCommunityFeed() {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user || cancelled) return;

        const ownerId = user.id;
        if (getCachedCommunityFeed(ownerId, "all")) return;

        const data = await apiJson<{ posts: WarmedCommunityPost[] }>(
          `/api/community/posts?sort=new&limit=${COMMUNITY_WARM_LIMIT}`
        );
        if (cancelled) return;

        const posts = data.posts ?? [];
        putCachedCommunityFeed(ownerId, "all", posts);
        putCachedCommunityPosts(ownerId, posts);
      } catch {
        // Best-effort warmup. The community screen still performs its own load.
      }
    }

    warmCommunityFeed();
    return () => {
      cancelled = true;
    };
  }, []);

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
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          tabBarAccessibilityLabel: "홈",
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "아모라",
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
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
          tabBarAccessibilityLabel: "내 정보",
        }}
      />
    </Tabs>
  );
}
