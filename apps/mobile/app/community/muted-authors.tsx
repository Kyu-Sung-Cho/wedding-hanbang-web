import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { EyeOff } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@hanbang/design-tokens";
import { CommunityAvatar } from "@/components/community/CommunityAvatar";
import ErrorRetry from "@/components/ErrorRetry";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";
import { apiFetch } from "@/lib/api";
import { clearCommunityCaches } from "@/lib/communityPostCache";
import {
  listMutedCommunityAuthors,
  type MutedCommunityAuthor,
  unmuteCommunityAuthor,
} from "@/lib/communityMutes";

function formatMutedDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default function MutedAuthorsScreen() {
  const [users, setUsers] = useState<MutedCommunityAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [unmutingId, setUnmutingId] = useState<string | null>(null);

  const loadData = useCallback(async (options?: { refresh?: boolean }) => {
    setLoadError(false);
    if (options?.refresh) setRefreshing(true);

    try {
      const nextUsers = await listMutedCommunityAuthors(apiFetch);
      setUsers(nextUsers);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleUnmute(user: MutedCommunityAuthor) {
    if (unmutingId) return;
    setUnmutingId(user.id);

    try {
      await unmuteCommunityAuthor(user.id, apiFetch);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      clearCommunityCaches();
      Alert.alert(
        "숨김을 해제했어요",
        `${user.nickname} 작성자의 게시글과 댓글이 커뮤니티에서 다시 보일 수 있어요.`,
      );
    } catch (error) {
      const detail = error instanceof Error
        ? error.message
        : "연결을 확인하고 다시 시도해주세요.";
      Alert.alert(
        "숨김을 해제하지 못했어요",
        `${detail}\n\n저장된 숨김 설정이 바뀐 것은 아니에요.`,
      );
    } finally {
      setUnmutingId(null);
    }
  }

  function confirmUnmute(user: MutedCommunityAuthor) {
    if (unmutingId) return;
    Alert.alert(
      "숨김을 해제할까요?",
      `${user.nickname} 작성자의 게시글과 댓글이 다시 보일 수 있어요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "숨김 해제",
          onPress: () => void handleUnmute(user),
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState label="숨긴 작성자를 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="숨긴 작성자" onBack={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadData({ refresh: true })}
            tintColor={colors.rose[500]}
          />
        }
      >
        <View style={styles.boundaryNotice}>
          <Text style={styles.boundaryTitle}>내 커뮤니티에서만 숨겨요</Text>
          <Text style={styles.boundaryBody}>
            숨긴 작성자의 게시글과 댓글은 내 커뮤니티에서 보이지 않아요. 작성자에게 알림은 가지 않으며, 여기에서 언제든 해제할 수 있어요.
          </Text>
        </View>

        {loadError && users.length === 0 ? (
          <ErrorRetry
            message="숨긴 작성자 목록을 불러오지 못했어요. 저장된 숨김 설정이 바뀐 것은 아니에요."
            onRetry={() => {
              setLoading(true);
              void loadData();
            }}
          />
        ) : (
          <>
            {loadError ? (
              <View style={styles.loadWarning} accessibilityRole="alert">
                <Text style={styles.loadWarningTitle}>목록을 새로 확인하지 못했어요</Text>
                <Text style={styles.loadWarningBody}>
                  마지막으로 불러온 목록을 유지하고 있어요. 저장된 숨김 설정이 바뀐 것은 아니에요.
                </Text>
                <Pressable
                  onPress={() => void loadData({ refresh: true })}
                  accessibilityRole="button"
                  accessibilityLabel="숨긴 작성자 목록 다시 불러오기"
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>다시 불러오기</Text>
                </Pressable>
              </View>
            ) : null}

            {users.length === 0 ? (
              <EmptyState
                icon={<EyeOff size={48} color={colors.textTertiary} />}
                title="숨긴 작성자가 없어요"
                description="게시글 상세에서 작성자 글을 숨기면 이곳에서 관리할 수 있어요."
              />
            ) : (
              <View style={styles.list}>
                {users.map((user) => {
                  const busy = unmutingId === user.id;
                  return (
                    <View key={user.id} style={styles.row}>
                      <CommunityAvatar nickname={user.nickname} size={40} />
                      <View style={styles.userInfo}>
                        <Text style={styles.nickname} numberOfLines={1}>
                          {user.nickname}
                        </Text>
                        <Text style={styles.mutedAt}>
                          {formatMutedDate(user.mutedAt)}부터 숨김
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => confirmUnmute(user)}
                        disabled={Boolean(unmutingId)}
                        accessibilityRole="button"
                        accessibilityLabel={`${user.nickname} 작성자 숨김 해제`}
                        accessibilityState={{ disabled: Boolean(unmutingId), busy }}
                        style={({ pressed }) => [
                          styles.unmuteButton,
                          (pressed || busy) && styles.unmuteButtonPressed,
                        ]}
                      >
                        <Text style={styles.unmuteButtonText}>
                          {busy ? "해제 중" : "숨김 해제"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  boundaryNotice: {
    padding: 16,
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  boundaryTitle: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  boundaryBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  loadWarning: {
    padding: 14,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E8B4AB",
    backgroundColor: "#FFF4F2",
  },
  loadWarningTitle: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
  },
  loadWarningBody: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  retryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  retryButtonText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
    textDecorationLine: "underline",
  },
  list: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  userInfo: { flex: 1, minWidth: 0 },
  nickname: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  mutedAt: {
    marginTop: 3,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  unmuteButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.rose[500],
    backgroundColor: colors.surface,
  },
  unmuteButtonPressed: { opacity: 0.58 },
  unmuteButtonText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[500],
  },
});
