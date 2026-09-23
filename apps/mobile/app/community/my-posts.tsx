// 내가 쓴 글 목록
import { useCallback } from "react";
import { View, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { FileText, ThumbsUp, MessageCircle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";
import { useOwnedCommunityList } from "@/lib/useOwnedCommunityList";

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "이거 정상이야?",
  tour_review: "투어/이용 후기",
  tips_v2: "꿀팁",
  ama: "결혼 끝났다 AMA",
  free: "자유게시판",
};

interface Post {
  id: string;
  category: string;
  title: string;
  created_at: string;
  upvote_count: number;
  comment_count: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

export default function MyPostsScreen() {
  const read = useCallback(async (owner: string, signal: AbortSignal) => {
      const { data, error } = await supabase
        .from("community_posts")
        .select("id, category, title, created_at, upvote_count, comment_count")
        .eq("author_id", owner)
        .order("created_at", { ascending: false }).abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as Post[];
  }, []);
  const { items: posts, loading, refreshing, loadError, loadData } = useOwnedCommunityList(read);

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <LoadingState label="내가 쓴 글을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader title="내가 쓴 글" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadData()}
            tintColor={colors.rose[500]}
          />
        }
      >
        {loadError ? <View><Text accessibilityRole="alert">{loadError}</Text><Pressable accessibilityRole="button" accessibilityLabel="다시 불러오기" onPress={() => void loadData()} style={{ minHeight: 44, justifyContent: "center" }}><Text>다시 불러오기</Text></Pressable></View> : null}
        {posts.length === 0 && !loadError ? (
          <EmptyState
            icon={<FileText size={48} color={colors.textTertiary} />}
            title="아직 작성한 글이 없어요"
            description="커뮤니티에 첫 후기를 남기면 여기에서 다시 볼 수 있어요."
          />
        ) : (
          posts.map((p) => (
            <Pressable
              key={p.id}
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
          ))
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
