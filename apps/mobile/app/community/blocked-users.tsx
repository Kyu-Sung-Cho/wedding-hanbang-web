import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ban, RotateCcw } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

import { CommunityAvatar } from "@/components/community/CommunityAvatar";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";
import { apiFetchForExpectedUser } from "@/lib/api";
import { clearCommunityCaches } from "@/lib/communityPostCache";
import { supabase } from "@/lib/supabase";

type BlockedUser = {
  blocked_user_id: string;
  reason_category: string | null;
  created_at: string;
  profile: {
    user_id: string;
    nickname: string;
    avatar_url: string | null;
    rank: string;
  } | null;
};

export default function BlockedUsersScreen() {
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBlocks = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const currentOwnerId = data.session?.user.id ?? null;
      if (!currentOwnerId) {
        router.replace("/(auth)/login");
        return;
      }
      setOwnerId(currentOwnerId);
      const response = await apiFetchForExpectedUser(
        currentOwnerId,
        "/api/community/blocks",
      );
      const body = await response.json().catch(() => ({})) as {
        blocks?: BlockedUser[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.blocks)) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "차단 목록을 불러오지 못했어요.",
        );
        return;
      }
      const { data: latest } = await supabase.auth.getSession();
      if (latest.session?.user.id !== currentOwnerId) return;
      setBlocks(body.blocks);
    } catch {
      setError("차단 목록을 불러오지 못했어요. 연결을 확인해 주세요.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadBlocks();
    }, [loadBlocks]),
  );

  async function unblock(blockedUserId: string) {
    if (!ownerId || unblockingId) return;
    setUnblockingId(blockedUserId);
    setError(null);
    try {
      const response = await apiFetchForExpectedUser(
        ownerId,
        "/api/community/blocks",
        {
          method: "POST",
          body: JSON.stringify({
            blocked_user_id: blockedUserId,
            blocked: false,
          }),
        },
      );
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        blocked_user_id?: string;
        blocked?: boolean;
        changed?: boolean;
        error?: string;
      };
      if (
        !response.ok
        || body.ok !== true
        || body.blocked_user_id?.toLowerCase() !== blockedUserId.toLowerCase()
        || body.blocked !== false
        || typeof body.changed !== "boolean"
      ) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "차단 해제 결과를 확인하지 못했어요.",
        );
        return;
      }
      clearCommunityCaches();
      setBlocks((current) =>
        current.filter((block) => block.blocked_user_id !== blockedUserId),
      );
    } catch {
      setError("차단 해제를 저장하지 못했어요. 연결을 확인해 주세요.");
    } finally {
      setUnblockingId(null);
    }
  }

  function confirmUnblock(block: BlockedUser) {
    const nickname = block.profile?.nickname ?? "이 회원";
    Alert.alert(
      "차단을 해제할까요?",
      `${nickname}님의 공개 활동이 다시 보이고 앞으로 새 답글을 주고받을 수 있어요. 차단 중 숨겨진 과거 알림은 다시 뜨지 않아요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제",
          onPress: () => void unblock(block.blocked_user_id),
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState label="차단 목록을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="차단 관리" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadBlocks(true)}
            tintColor={colors.rose[500]}
          />
        }
      >
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>이 목록은 본인에게만 보여요</Text>
          <Text style={styles.noticeText}>
            연결된 파트너에게도 공유하지 않아요. 차단은 로그인한 화면과 새
            연락을 막지만, 공개 글 자체의 운영 검토가 필요하면 별도로 신고해
            주세요.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => void loadBlocks()}
              accessibilityRole="button"
            >
              <RotateCcw size={15} color={colors.noir[800]} />
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : null}

        {!error && blocks.length === 0 ? (
          <EmptyState
            icon={<Ban size={46} color={colors.textTertiary} />}
            title="차단한 회원이 없어요"
            description="글과 답변의 안전 메뉴에서 필요할 때 설정할 수 있어요."
          />
        ) : null}

        {blocks.map((block) => {
          const nickname = block.profile?.nickname ?? "표시할 수 없는 회원";
          const unblocking = unblockingId === block.blocked_user_id;
          return (
            <View key={block.blocked_user_id} style={styles.card}>
              <CommunityAvatar nickname={nickname} size={42} />
              <View style={styles.cardCopy}>
                <Text style={styles.nickname} numberOfLines={1}>{nickname}</Text>
                <Text style={styles.cardDescription}>로그인한 커뮤니티에서 숨김</Text>
              </View>
              <Pressable
                style={[styles.unblockButton, unblocking && styles.disabled]}
                onPress={() => confirmUnblock(block)}
                disabled={unblocking}
                accessibilityRole="button"
                accessibilityLabel={`${nickname}님 차단 해제`}
              >
                {unblocking ? (
                  <ActivityIndicator size="small" color={colors.noir[800]} />
                ) : (
                  <Text style={styles.unblockText}>차단 해제</Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  notice: {
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.ivory[100],
    padding: 15,
  },
  noticeTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  noticeText: { marginTop: 5, fontSize: 12, lineHeight: 19, color: colors.paper.inkFaint },
  errorCard: {
    alignItems: "center",
    marginBottom: 16,
    borderRadius: 15,
    backgroundColor: "#fbf2f0",
    padding: 16,
  },
  errorText: { fontSize: 13, lineHeight: 20, textAlign: "center", color: colors.rose[700] },
  retryButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, minHeight: 40, paddingHorizontal: 14 },
  retryText: { fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 14,
  },
  cardCopy: { flex: 1 },
  nickname: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  cardDescription: { marginTop: 3, fontSize: 11, color: colors.paper.inkFaint },
  unblockButton: {
    minWidth: 78,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 11,
  },
  unblockText: { fontSize: 12, fontWeight: "700", color: colors.noir[800] },
  disabled: { opacity: 0.5 },
});
