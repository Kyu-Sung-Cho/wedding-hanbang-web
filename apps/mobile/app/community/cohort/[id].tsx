// 동기방 실시간 채팅 — 개선 버전 (멤버 목록, 정보판, 타임라인 탭)
import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import {
  Send,
  ChevronDown,
  ChevronUp,
  Users,
  MessageSquare,
  Info,
  Clock,
  FileText,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { safeErrorDiagnostic } from "@/lib/safeErrorDiagnostic";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";

/* ───── 타입 ───── */

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

interface CohortMember {
  id: string;
  user_id: string;
  profile: {
    nickname: string;
    rank: string;
  } | null;
}

type ScreenTab = "chat" | "info" | "timeline";

const TOPICS = [
  { key: "all", label: "전체" },
  { key: "price", label: "가격" },
  { key: "review", label: "후기" },
  { key: "concern", label: "고민" },
  { key: "chat", label: "잡담" },
] as const;

type TopicKey = (typeof TOPICS)[number]["key"];

const STARTER_PROMPTS: { label: string; topic: Exclude<TopicKey, "all">; text: string }[] = [
  {
    label: "예식장 가격 묻기",
    topic: "price",
    text: "예식장 견적, 어느 정도가 적당할까요?",
  },
  {
    label: "투어 후기 공유",
    topic: "review",
    text: "최근 투어 다녀온 곳 후기 공유해요.",
  },
  {
    label: "준비 고민 남기기",
    topic: "concern",
    text: "준비하면서 제일 헷갈리는 부분이 있어요.",
  },
];

// 닉네임 기반 아바타 색상
const AVATAR_COLORS = [
  colors.rose[500], colors.gold.DEFAULT, colors.rose[600], colors.taupe[500], colors.taupe[400],
  colors.rose.light, colors.gold.light, colors.noir.soft, colors.noir[800], colors.rose.pale,
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

/* ───── 멤버 목록 (접이식) ───── */

function MemberListSection({ members }: { members: CohortMember[] }) {
  const [expanded, setExpanded] = useState(false);

  function toggleExpand() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }

  return (
    <View style={styles.memberSection}>
      <Pressable style={styles.memberToggle} onPress={toggleExpand}>
        <Users size={16} color={colors.textSecondary} />
        <Text style={styles.memberToggleText}>
          멤버 {members.length}명
        </Text>
        {expanded ? (
          <ChevronUp size={16} color={colors.taupe[400]} />
        ) : (
          <ChevronDown size={16} color={colors.taupe[400]} />
        )}
      </Pressable>

      {expanded && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.memberScroll}
        >
          {members.map((member) => {
            const nickname = member.profile?.nickname ?? "멤버";
            const bgColor = getAvatarColor(nickname);
            return (
              <View key={member.id} style={styles.memberItem}>
                <View style={[styles.memberAvatar, { backgroundColor: bgColor }]}>
                  <Text style={styles.memberAvatarText}>
                    {nickname.charAt(0)}
                  </Text>
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {nickname}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/* ───── 정보판 탭 플레이스홀더 ───── */

function InfoBoardTab() {
  return (
    <EmptyState
      icon={<FileText size={40} color={colors.rose[500]} />}
      title="정보판"
      description={"계약 정보를 공유해보세요\n동기들과 가격, 업체 정보를 비교할 수 있어요"}
    />
  );
}

/* ───── 타임라인 탭 플레이스홀더 ───── */

function TimelineTab() {
  return (
    <EmptyState
      icon={<Clock size={40} color={colors.gold.DEFAULT} />}
      title="타임라인"
      description={"동기들의 진행 상황을 확인하세요\n서로의 웨딩 준비 과정을 함께해요"}
    />
  );
}

/* ───── 메인 ───── */

export default function CohortChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<CohortMessage[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<CohortMember[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTopic, setActiveTopic] = useState<TopicKey>("all");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [showTopicDropdown, setShowTopicDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<ScreenTab>("chat");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<CohortMessage>>(null);

  // 서버가 capacity/단일 활성 멤버십을 원자적으로 보장한 뒤 방 데이터를 읽는다.
  const loadMessages = useCallback(async () => {
    if (!id) return false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/(auth)/login");
        return false;
      }
      setCurrentUserId(user.id);

      const currentResponse = await apiFetch("/api/community/cohort", {
        method: "GET",
        cache: "no-store",
      });
      const current = (await currentResponse.json().catch(() => ({}))) as {
        room?: { id?: unknown } | null;
      };
      if (!currentResponse.ok || !("room" in current)) {
        throw new Error("cohort membership lookup failed");
      }

      let assignedRoomId: string;
      if (current.room !== null) {
        if (typeof current.room?.id !== "string" || current.room.id.length === 0) {
          throw new Error("invalid cohort membership response");
        }
        assignedRoomId = current.room.id;
      } else {
        const assignmentResponse = await apiFetch("/api/community/cohort/auto-assign", {
          method: "POST",
        });
        const assignment = (await assignmentResponse.json().catch(() => ({}))) as {
          room_id?: unknown;
        };
        if (
          !assignmentResponse.ok
          || typeof assignment.room_id !== "string"
          || assignment.room_id.length === 0
        ) {
          throw new Error("cohort assignment failed");
        }
        assignedRoomId = assignment.room_id;
      }

      // 탐색 화면의 URL은 힌트일 뿐이다. 서버가 정한 방이 단일 멤버십과
      // 정원 제한을 만족하는 최종 권위이므로 다르면 그 방으로 교정한다.
      if (assignedRoomId !== id) {
        router.replace({
          pathname: "/community/cohort/[id]",
          params: { id: assignedRoomId },
        });
        return false;
      }

      const { data: roomData } = await supabase
        .from("cohort_rooms")
        .select("id, name, member_count, message_count, year, month")
        .eq("id", id)
        .single();

      if (roomData) {
        setRoomInfo({
          name: roomData.name,
          member_count: roomData.member_count,
        });
      }

      // 3. 메시지 로드 (Supabase 직접 — RLS는 멤버 확인)
      const { data: msgs } = await supabase
        .from("cohort_messages")
        .select("id, room_id, author_id, content, thread_topic, created_at")
        .eq("room_id", id)
        .order("created_at", { ascending: true })
        .limit(100);

      if (msgs) {
        setMessages(msgs.map((m) => ({
          id: m.id,
          room_id: m.room_id,
          author_id: m.author_id,
          author_nickname: null, // 멤버 리스트에서 매칭
          content: m.content,
          topic: m.thread_topic,
          created_at: m.created_at,
        })));
      }
      return true;
    } catch (err) {
      console.error("동기방 로드 에러:", safeErrorDiagnostic(err));
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  // 멤버 로드
  const loadMembers = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await supabase
        .from("cohort_members")
        .select("id, user_id, profile:community_profiles(nickname, rank)")
        .eq("room_id", id);

      setMembers((data as unknown as CohortMember[]) ?? []);
    } catch (err) {
      console.error("멤버 로드 에러:", safeErrorDiagnostic(err));
    }
  }, [id]);

  useEffect(() => {
    void loadMessages().then((ready) => {
      if (ready) void loadMembers();
    });
  }, [loadMessages, loadMembers]);

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
          const raw = payload.new as Record<string, unknown>;
          const newMsg: CohortMessage = {
            id: raw.id as string,
            room_id: raw.room_id as string,
            author_id: raw.author_id as string | null,
            author_nickname: null, // 멤버 리스트에서 매칭
            content: raw.content as string,
            topic: (raw.thread_topic as string) ?? null,
            created_at: raw.created_at as string,
          };
          setMessages((prev) => {
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
    if (messages.length > 0 && activeTab === "chat") scrollToEnd();
  }, [messages.length, scrollToEnd, activeTab]);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const topic = selectedTopic === "all" ? undefined : selectedTopic ?? undefined;
      const res = await apiFetch(`/api/community/cohort/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: text,
          thread_topic: topic,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "메시지 전송에 실패했습니다.");
      }

      setInput("");
      setSelectedTopic(null);
      // Realtime이 새 메시지를 자동 추가하므로 수동 reload 불필요
    } catch (err) {
      console.error("전송 실패:", safeErrorDiagnostic(err));
    } finally {
      setSending(false);
    }
  }

  function getInitial(nickname: string | null): string {
    if (!nickname) return "AI";
    return nickname.charAt(0);
  }

  function renderChatEmpty() {
    return (
      <View style={styles.chatEmpty}>
        <View style={styles.chatEmptyIcon}>
          <MessageSquare size={30} color={colors.rose[500]} />
        </View>
        <Text style={styles.chatEmptyTitle}>아직 메시지가 없어요</Text>
        <Text style={styles.chatEmptyText}>
          같은 시기에 준비하는 사람들에게 바로 물어볼 수 있어요.
        </Text>
        <View style={styles.starterPromptList}>
          {STARTER_PROMPTS.map((prompt) => (
            <Pressable
              key={prompt.topic}
              style={({ pressed }) => [
                styles.starterPrompt,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                setSelectedTopic(prompt.topic);
                setInput(prompt.text);
              }}
            >
              <Text style={styles.starterPromptText}>{prompt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  function renderMessage({ item }: { item: CohortMessage }) {
    const isAi = item.author_id === null;
    const isMe = item.author_id === currentUserId;

    // 멤버 닉네임 매칭
    const memberNick = members.find((m) => m.user_id === item.author_id)?.profile?.nickname;
    const nickname = isAi ? "아모라 AI" : (memberNick ?? item.author_nickname ?? "멤버");
    const avatarBg = isAi ? colors.noir[800] : getAvatarColor(nickname);

    // 내 메시지 → 오른쪽
    if (isMe) {
      return (
        <View style={styles.msgRowMe}>
          <View style={styles.msgContentMe}>
            <Text style={styles.msgTimeMe}>{timeAgo(item.created_at)}</Text>
            <View style={styles.bubbleMe}>
              <Text style={styles.bubbleTextMe}>{item.content}</Text>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.msgRow}>
        {/* 아바타 */}
        <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
          <Text style={[styles.avatarText, isAi && styles.avatarTextAi]}>
            {getInitial(isAi ? null : nickname)}
          </Text>
        </View>

        <View style={styles.msgContent}>
          {/* 닉네임 + 시간 */}
          <View style={styles.msgMeta}>
            <Text
              style={[
                styles.msgNickname,
                { color: isAi ? colors.gold.DEFAULT : avatarBg },
              ]}
            >
              {nickname}
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

  /* ── 스크린 탭 ── */

  const SCREEN_TABS: { key: ScreenTab; label: string; icon: typeof MessageSquare }[] = [
    { key: "chat", label: "채팅", icon: MessageSquare },
    { key: "info", label: "정보판", icon: Info },
    { key: "timeline", label: "타임라인", icon: Clock },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title={roomInfo?.name ?? "동기방"}
        onBack={() => router.back()}
        sideWidth={72}
        right={
          <View style={styles.memberBadge}>
            <Users size={14} color={colors.textSecondary} />
            <Text style={styles.memberCount}>
              {roomInfo?.member_count ?? "..."}
            </Text>
          </View>
        }
      />

      {/* 멤버 목록 (접이식) */}
      {members.length > 0 && <MemberListSection members={members} />}

      {/* 스크린 탭 */}
      <View style={styles.screenTabRow}>
        {SCREEN_TABS.map((tab) => {
          const active = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.key}
              style={[styles.screenTab, active && styles.screenTabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Icon
                size={16}
                color={active ? colors.noir[800] : colors.taupe[400]}
              />
              <Text
                style={[
                  styles.screenTabText,
                  active && styles.screenTabTextActive,
                ]}
              >
                {tab.label}
              </Text>
              {active && <View style={styles.screenTabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      {/* 탭 컨텐츠 */}
      {activeTab === "info" ? (
        <InfoBoardTab />
      ) : activeTab === "timeline" ? (
        <TimelineTab />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
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

          {/* 메시지 영역 */}
          {loading ? (
            <LoadingState label="메시지를 불러오는 중이에요" />
          ) : (
            <FlatList
              ref={flatListRef}
              data={filteredMessages}
              keyExtractor={(m) => m.id}
              renderItem={renderMessage}
              contentContainerStyle={[
                styles.messageList,
                filteredMessages.length === 0 && styles.messageListEmpty,
              ]}
              onContentSizeChange={scrollToEnd}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    void loadMessages().then((ready) => {
                      if (ready) void loadMembers();
                    });
                  }}
                  tintColor={colors.rose[500]}
                />
              }
              ListEmptyComponent={renderChatEmpty}
            />
          )}

          {/* 입력 바 */}
          <View style={styles.inputBar}>
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
                placeholderTextColor={colors.textTertiary}
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
      )}
    </SafeAreaView>
  );
}

/* ───── 스타일 ───── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

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

  // 멤버 섹션
  memberSection: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  memberToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  memberScroll: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 16,
  },
  memberItem: {
    alignItems: "center",
    width: 56,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  memberName: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: "center",
  },

  // 스크린 탭
  screenTabRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  screenTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    position: "relative",
  },
  screenTabActive: {},
  screenTabText: { fontSize: 14, color: colors.taupe[400] },
  screenTabTextActive: { color: colors.noir[800], fontWeight: "600" },
  screenTabIndicator: {
    position: "absolute",
    bottom: 0,
    left: "20%",
    right: "20%",
    height: 2,
    backgroundColor: colors.noir[800],
    borderRadius: 1,
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

  // 메시지 리스트
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 16 },
  messageListEmpty: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 80,
  },
  chatEmpty: {
    alignItems: "center",
    paddingHorizontal: 18,
    gap: 8,
  },
  chatEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  chatEmptyTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  chatEmptyText: {
    maxWidth: 260,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  starterPromptList: {
    width: "100%",
    gap: 8,
    marginTop: 12,
  },
  starterPrompt: {
    alignSelf: "center",
    minWidth: 190,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  starterPromptText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  rowPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },

  // 메시지 행
  msgRow: { flexDirection: "row", gap: 10 },
  msgRowMe: { alignSelf: "flex-end", maxWidth: "80%" },
  msgContent: { flex: 1 },
  msgContentMe: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  msgTimeMe: { fontSize: 11, color: colors.taupe[400], marginBottom: 2 },
  bubbleMe: {
    backgroundColor: colors.noir[800],
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleTextMe: { fontSize: 14, color: "#FFFFFF", lineHeight: 20 },
  msgMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  msgNickname: { fontSize: 13, fontWeight: "600" },
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
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
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
    fontSize: 15,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
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
  sendBtnDisabled: { backgroundColor: colors.gold.light },
});
