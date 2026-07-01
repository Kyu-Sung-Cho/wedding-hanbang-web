// 방명록 뷰어 — 웹에서 만든 방명록을 앱에서 보기
import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Heart, MessageSquare, Eye } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";

interface Guestbook {
  id: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  venue: string | null;
  our_story: string | null;
  message_count: number;
  view_count: number;
}

interface GuestMessage {
  id: string;
  guest_name: string;
  relation: string | null;
  message: string;
  created_at: string;
}

const RELATION_LABELS: Record<string, string> = {
  university_friend: "대학친구",
  work_colleague: "직장동료",
  family: "가족",
  old_friend: "오래된 친구",
  partner: "파트너 지인",
  other: "기타",
};

export default function GuestbookViewerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [guestbook, setGuestbook] = useState<Guestbook | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { data: gb } = await supabase
        .from("guestbooks")
        .select("id, bride_name, groom_name, wedding_date, venue, our_story, message_count, view_count")
        .eq("slug", slug)
        .single();

      if (gb) {
        setGuestbook(gb);
        const { data: msgs } = await supabase
          .from("guestbook_messages")
          .select("id, guest_name, relation, message, created_at")
          .eq("guestbook_id", gb.id)
          .order("created_at", { ascending: false })
          .limit(100);
        setMessages(msgs ?? []);
      }
    } catch (err) {
      console.error("Guestbook load error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [slug]);

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <AppHeader title="방명록" onBack={() => router.back()} />
        <LoadingState label="방명록을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  if (!guestbook) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <AppHeader title="방명록" onBack={() => router.back()} />
        <EmptyState
          icon={<MessageSquare size={36} color={colors.rose[500]} />}
          title="방명록을 찾을 수 없어요"
          description="주소를 다시 확인해주세요"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader title="방명록" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.rose[500]} />}>

        {/* 커플 카드 */}
        <View style={s.coupleCard}>
          <Heart size={24} color={colors.rose[500]} />
          <Text style={s.coupleName}>{guestbook.bride_name} & {guestbook.groom_name}</Text>
          <Text style={s.weddingDate}>
            {new Date(guestbook.wedding_date).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
          </Text>
          {guestbook.venue && <Text style={s.venue}>{guestbook.venue}</Text>}
          <View style={s.statsRow}>
            <View style={s.stat}>
              <MessageSquare size={14} color={colors.textTertiary} />
              <Text style={s.statText}>{guestbook.message_count}개</Text>
            </View>
            <View style={s.stat}>
              <Eye size={14} color={colors.textTertiary} />
              <Text style={s.statText}>{guestbook.view_count}회</Text>
            </View>
          </View>
        </View>

        {/* 우리의 이야기 */}
        {guestbook.our_story && (
          <View style={s.storyCard}>
            <Text style={s.storyTitle}>우리의 이야기</Text>
            <Text style={s.storyText}>{guestbook.our_story}</Text>
          </View>
        )}

        {/* 메시지 목록 */}
        <Text style={s.sectionTitle}>축하 메시지 {messages.length}개</Text>
        {messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={36} color={colors.rose[500]} />}
            title="아직 메시지가 없어요"
            description="첫 축하 메시지를 기다리고 있어요"
          />
        ) : (
          messages.map((msg) => (
            <View key={msg.id} style={s.msgCard}>
              <View style={s.msgHeader}>
                <Text style={s.msgName}>{msg.guest_name}</Text>
                {msg.relation && (
                  <View style={s.relationBadge}>
                    <Text style={s.relationText}>{RELATION_LABELS[msg.relation] ?? msg.relation}</Text>
                  </View>
                )}
              </View>
              <Text style={s.msgBody}>{msg.message}</Text>
              <Text style={s.msgTime}>
                {new Date(msg.created_at).toLocaleDateString("ko-KR")}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  coupleCard: {
    backgroundColor: colors.surface, borderRadius: 24, padding: 24, alignItems: "center",
    borderWidth: 1, borderColor: colors.border, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 12,
  },
  coupleName: { fontSize: 22, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800], marginTop: 12 },
  weddingDate: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  venue: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 16, marginTop: 12 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 12, color: colors.textTertiary },

  storyCard: {
    backgroundColor: colors.ivory[200], borderRadius: 20, padding: 20, marginBottom: 20,
  },
  storyTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800], marginBottom: 8 },
  storyText: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },

  sectionTitle: { fontSize: 16, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800], marginBottom: 12 },

  msgCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  msgName: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  relationBadge: { backgroundColor: colors.rose.glow, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  relationText: { fontSize: 11, color: colors.rose[500], fontWeight: "600" },
  msgBody: { fontSize: 14, color: colors.noir[800], lineHeight: 22 },
  msgTime: { fontSize: 11, color: colors.textTertiary, marginTop: 8 },
});
