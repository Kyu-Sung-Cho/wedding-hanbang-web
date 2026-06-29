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
  ArrowLeft,
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
    wedding_year: number | null;
    wedding_month: number | null;
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

// 닉네임 기반 아바타 색상
const AVATAR_COLORS = [
  "#C4967E", "#C9A96E", "#9A6B62", "#928980", "#B5ADA3",
  "#D4AFA0", "#DCC9A0", "#4A4A52", "#1A1A1F", "#E8D5CD",
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
    <View style={styles.placeholderWrap}>
      <View style={styles.placeholderIcon}>
        <FileText size={40} color={colors.rose[500]} />
      </View>
      <Text style={styles.placeholderTitle}>정보판</Text>
      <Text style={styles.placeholderText}>
        계약 정보를 공유해보세요{"\n"}
        동기들과 가격, 업체 정보를 비교할 수 있어요
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.placeholderBtn,
          pressed && { backgroundColor: colors.rose[600] },
        ]}
      >
        <Text style={styles.placeholderBtnText}>정보 공유하기</Text>
      </Pressable>
    </View>
  );
}

/* ───── 타임라인 탭 플레이스홀더 ───── */

function TimelineTab() {
  return (
    <View style={styles.placeholderWrap}>
      <View style={styles.placeholderIcon}>
        <Clock size={40} color={colors.gold.DEFAULT} />
      </View>
      <Text style={styles.placeholderTitle}>타임라인</Text>
      <Text style={styles.placeholderText}>
        동기들의 진행 상황을 확인하세요{"\n"}
        서로의 웨딩 준비 과정을 함께해요
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.placeholderBtn,
          pressed && { backgroundColor: colors.rose[600] },
        ]}
      >
        <Text style={styles.placeholderBtnText}>내 진행상황 공유</Text>
      </Pressable>
    </View>
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

  // 초기: 자동 입장 + 메시지/방 정보 로드 (Supabase 직접)
  const loadMessages = useCallback(async () => {
    if (!id) return;
    try {
      // 1. 자동 입장 (이미 멤버면 무시)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        await supabase.from("cohort_members").upsert(
          { room_id: id, user_id: user.id },
          { onConflict: "room_id,user_id" }
        ).then(() => {});
      }

      // 2. 방 정보 로드
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
    } catch (err) {
      console.error("동기방 로드 에러:", err);
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
        .select("id, user_id, profile:community_profiles(nickname, rank, wedding_year, wedding_month)")
        .eq("room_id", id);

      setMembers((data as unknown as CohortMember[]) ?? []);
    } catch (err) {
      console.error("멤버 로드 에러:", err);
    }
  }, [id]);

  useEffect(() => {
    loadMessages();
    loadMembers();
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
      console.error("전송 실패:", err);
    } finally {
      setSending(false);
    }
  }

  function getInitial(nickname: string | null): string {
    if (!nickname) return "AI";
    return nickname.charAt(0);
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
                    loadMembers();
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
      )}
    </SafeAreaView>
  );
}

/* ───── 스타일 ───── */

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

  // 로딩
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  // 메시지 리스트
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 16 },

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

  // 빈 상태
  emptyWrap: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: "center" },

  // 플레이스홀더 (정보판 / 타임라인)
  placeholderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  placeholderIcon: {
    width: 80,
    height: 80,
    borderRadius: 28,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  placeholderBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 8,
    shadowColor: colors.rose[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  placeholderBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },

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
