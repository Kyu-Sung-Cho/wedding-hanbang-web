// 동기방 실시간 채팅
import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, Send, ChevronDown, Users } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch, apiJson } from "@/lib/api";

interface CohortMessage {
  id: string;
  room_id: string;
  author_id: string | null;
  author_nickname: string | null;
  content: string;
  topic: string | null;
  created_at: string;
}

interface RoomInfo {
  name: string;
  member_count: number;
}

const TOPICS = [
  { key: "all", label: "전체" },
  { key: "price", label: "가격" },
  { key: "review", label: "후기" },
  { key: "worry", label: "고민" },
  { key: "chat", label: "잡담" },
] as const;

type TopicKey = (typeof TOPICS)[number]["key"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function CohortChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<CohortMessage[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTopic, setActiveTopic] = useState<TopicKey>("all");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [showTopicDropdown, setShowTopicDropdown] = useState(false);
  const flatListRef = useRef<FlatList<CohortMessage>>(null);

  // 초기 메시지 로드
  const loadMessages = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiJson<{ messages: CohortMessage[]; room: RoomInfo }>(
        `/api/community/cohort/${id}/messages`
      );
      setMessages(data.messages ?? []);
      if (data.room) setRoomInfo(data.room);
    } catch (err) {
      console.error("Cohort messages load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Supabase Realtime 구독
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`cohort:${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cohort_messages",
          filter: `room_id=eq.${id}`,
        },
        (payload) => {
          const newMsg = payload.new as CohortMessage;
          setMessages((prev) => {
            // 중복 방지
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // 새 메시지 도착 시 하단 스크롤
  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  // 토픽 필터 적용된 메시지
  const filteredMessages =
    activeTopic === "all"
      ? messages
      : messages.filter((m) => m.topic === activeTopic);

  // 메시지 전송
  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await apiFetch(`/api/community/cohort/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text, topic: selectedTopic }),
      });
      setInput("");
      setSelectedTopic(null);
    } catch (err) {
      console.error("Send error:", err);
    } finally {
      setSending(false);
    }
  }

  // 아바타 첫 글자
  function getInitial(nickname: string | null): string {
    if (!nickname) return "AI";
    return nickname.charAt(0);
  }

  function renderMessage({ item }: { item: CohortMessage }) {
    const isAi = item.author_id === null;

    return (
      <View style={[styles.msgRow, isAi && styles.msgRowAi]}>
        {/* 아바타 */}
        <View style={[styles.avatar, isAi && styles.avatarAi]}>
          <Text style={[styles.avatarText, isAi && styles.avatarTextAi]}>
            {getInitial(item.author_nickname)}
          </Text>
        </View>

        <View style={styles.msgContent}>
          {/* 닉네임 + 시간 */}
          <View style={styles.msgMeta}>
            <Text style={[styles.msgNickname, isAi && styles.msgNicknameAi]}>
              {item.author_nickname ?? "아모라 AI"}
            </Text>
            {item.topic && (
              <View style={styles.topicBadge}>
                <Text style={styles.topicBadgeText}>
                  {TOPICS.find((t) => t.key === item.topic)?.label ?? item.topic}
                </Text>
              </View>
            )}
            <Text style={styles.msgTime}>{timeAgo(item.created_at)}</Text>
          </View>

          {/* 메시지 내용 */}
          <View style={[styles.bubble, isAi && styles.bubbleAi]}>
            <Text style={[styles.bubbleText, isAi && styles.bubbleTextAi]}>
              {item.content}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {roomInfo?.name ?? "동기방"}
          </Text>
        </View>
        <View style={styles.memberBadge}>
          <Users size={14} color={colors.textSecondary} />
          <Text style={styles.memberCount}>
            {roomInfo?.member_count ?? "..."}
          </Text>
        </View>
      </View>

      {/* 토픽 필터 */}
      <View style={styles.topicRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TOPICS}
          keyExtractor={(t) => t.key}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          renderItem={({ item: topic }) => {
            const active = activeTopic === topic.key;
            return (
              <Pressable
                style={[styles.topicChip, active && styles.topicChipActive]}
                onPress={() => setActiveTopic(topic.key)}
              >
                <Text
                  style={[
                    styles.topicChipText,
                    active && styles.topicChipTextActive,
                  ]}
                >
                  {topic.label}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* 메시지 영역 */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.rose[500]} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredMessages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={scrollToEnd}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadMessages();
                }}
                tintColor={colors.rose[500]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  아직 메시지가 없어요. 첫 대화를 시작해보세요!
                </Text>
              </View>
            }
          />
        )}

        {/* 입력 바 */}
        <View style={styles.inputBar}>
          {/* 선택된 토픽 표시 */}
          {selectedTopic && (
            <View style={styles.selectedTopicRow}>
              <Text style={styles.selectedTopicLabel}>
                #{TOPICS.find((t) => t.key === selectedTopic)?.label ?? selectedTopic}
              </Text>
              <Pressable onPress={() => setSelectedTopic(null)} hitSlop={8}>
                <Text style={styles.selectedTopicRemove}>X</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.inputRow}>
            {/* 토픽 선택 드롭다운 */}
            <View>
              <Pressable
                style={styles.topicSelector}
                onPress={() => setShowTopicDropdown(!showTopicDropdown)}
              >
                <Text style={styles.topicSelectorText}>#</Text>
                <ChevronDown size={14} color={colors.textSecondary} />
              </Pressable>

              {showTopicDropdown && (
                <View style={styles.dropdown}>
                  {TOPICS.filter((t) => t.key !== "all").map((topic) => (
                    <Pressable
                      key={topic.key}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setSelectedTopic(topic.key);
                        setShowTopicDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownText}>{topic.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="메시지를 입력하세요..."
              placeholderTextColor={colors.taupe[400]}
              multiline
              maxLength={2000}
              editable={!sending}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />

            <Pressable
              style={[
                styles.sendBtn,
                (!input.trim() || sending) && styles.sendBtnDisabled,
              ]}
              onPress={handleSend}
              disabled={!input.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Send size={18} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 헤더
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
  },
  memberBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
  },
  memberCount: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textSecondary,
  },

  // 토픽 필터
  topicRow: { paddingVertical: 10, backgroundColor: colors.surface },
  topicChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topicChipActive: {
    backgroundColor: colors.noir[800],
    borderColor: colors.noir[800],
  },
  topicChipText: { fontSize: 13, color: colors.textSecondary },
  topicChipTextActive: { color: "#FFFFFF", fontWeight: "600" },

  // 로딩
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  // 메시지 리스트
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 16 },

  // 메시지 행
  msgRow: { flexDirection: "row", gap: 10 },
  msgRowAi: {},
  msgContent: { flex: 1 },
  msgMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  msgNickname: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  msgNicknameAi: { color: colors.gold.DEFAULT },
  msgTime: { fontSize: 11, color: colors.taupe[400] },

  // 토픽 배지
  topicBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.rose[500] + "20",
  },
  topicBadgeText: { fontSize: 10, fontWeight: "600", color: colors.rose[500] },

  // 아바타
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarAi: { backgroundColor: colors.noir[800] },
  avatarText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  avatarTextAi: { color: colors.gold.DEFAULT },

  // 말풍선
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  bubbleAi: {
    backgroundColor: colors.noir[800] + "08",
    borderColor: colors.gold.DEFAULT + "30",
  },
  bubbleText: { fontSize: 14, lineHeight: 22, color: colors.noir[800] },
  bubbleTextAi: { color: colors.noir[800] },

  // 빈 상태
  emptyWrap: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: "center" },

  // 입력 바
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  selectedTopicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  selectedTopicLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.rose[500],
  },
  selectedTopicRemove: {
    fontSize: 12,
    color: colors.taupe[400],
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  topicSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  topicSelectorText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  dropdown: {
    position: "absolute",
    bottom: 48,
    left: 0,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    zIndex: 10,
    minWidth: 100,
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 10 },
  dropdownText: { fontSize: 14, color: colors.noir[800] },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.noir[800],
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: colors.taupe[400] },
});
