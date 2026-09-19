// 내 북마크 목록
import { useEffect, useState, useCallback } from "react";
import { View, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Bookmark, ThumbsUp, MessageCircle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "이거 정상이야?",
  tour_review: "투어/이용 후기",
  tips_v2: "꿀팁",
  ama: "결혼 끝났다 AMA",
  free: "자유게시판",
};

interface BookmarkedPost {
  id: string;
  post: {
    id: string;
    category: string;
    title: string;
    created_at: string;
    upvote_count: number;
    comment_count: number;
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

export default function MyBookmarksScreen() {
  const [bookmarks, setBookmarks] = useState<BookmarkedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("community_bookmarks")
        .select("id, post:community_posts(id, category, title, created_at, upvote_count, comment_count)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setBookmarks((data ?? []) as unknown as BookmarkedPost[]);
    } catch (err) {
      console.error("Bookmarks load:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <LoadingState label="북마크를 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader title="북마크" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={colors.rose[500]}
          />
        }
      >
        {bookmarks.length === 0 ? (
          <EmptyState
            icon={<Bookmark size={48} color={colors.textTertiary} />}
            title="북마크한 글이 없어요"
            description="다시 보고 싶은 후기와 견적 글을 저장하면 여기에서 모아볼 수 있어요."
          />
        ) : (
          bookmarks.map((bm) => {
            const p = bm.post;
            if (!p) return null;
            return (
              <Pressable
                key={bm.id}
                style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}
                onPress={() => router.push({ pathname: "/community/post/[id]", params: { id: p.id } })}
              >
                <View style={s.catBadge}>
                  <Text style={s.catBadgeText}>
                    {CATEGORY_LABELS[p.category] ?? p.category}
                  </Text>
                </View>
                <Text style={s.title} numberOfLines={2}>{p.title}</Text>
                <View style={s.meta}>
                  <Text style={s.dateText}>{formatDate(p.created_at)}</Text>
                  <View style={s.metaRight}>
                    <ThumbsUp size={14} color={colors.textTertiary} />
                    <Text style={s.metaNum}>{p.upvote_count}</Text>
                    <MessageCircle size={14} color={colors.textTertiary} />
                    <Text style={s.metaNum}>{p.comment_count}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: colors.paper.ink,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 12,
  elevation: 2,
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  catBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 10,
  },
  catBadgeText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[700],
  },
  title: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    lineHeight: 22,
    marginBottom: 10,
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dateText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.paper.inkFaint,
  },
  metaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaNum: {
    fontSize: 13,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.paper.inkFaint,
    marginRight: 8,
  },

});
