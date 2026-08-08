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
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
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
import { apiFetchForExpectedUser } from "@/lib/api";
import {
  CommunityCohortAccessError,
  assignCurrentUserToCohort,
  createCohortMessageIdempotencyStore,
  createCommunityCohortGate,
  fetchCohortMembers,
  fetchCohortMessages,
  fetchCurrentCohortAccess,
  mergeCohortMessageSnapshot,
  sendCohortMessage,
  type CohortIdentityToken,
  type CohortMessageToken,
} from "@/lib/communityCohortAccess.mjs";
import {
  AppHeader,
  EmptyState,
  LoadingState,
  PrimaryButton,
} from "@/components/ui/AppUI";

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
  user_id: string;
  profile: {
    nickname: string;
    rank: string;
  };
}

type ScreenTab = "chat" | "info" | "timeline";
type CohortAccessState =
  | "checking"
  | "member"
  | "unassigned"
  | "different_room"
  | "unauthenticated"
  | "error";

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
    label: "결혼식장 가격 묻기",
    topic: "price",
    text: "결혼식장 견적의 포함 항목과 금액을 같이 봐주세요.",
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
              <View key={member.user_id} style={styles.memberItem}>
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
  const roomId = typeof id === "string" ? id : "";
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
  const [accessState, setAccessState] = useState<CohortAccessState>("checking");
  const [assignedRoom, setAssignedRoom] = useState<{ id: string; name: string } | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<CohortMessage>>(null);
  const cohortGateRef = useRef(createCommunityCohortGate()).current;
  const messageIdempotencyRef = useRef(
    createCohortMessageIdempotencyStore(() => Crypto.randomUUID()),
  ).current;
  const loadSequenceRef = useRef(0);
  const messageRevisionRef = useRef(0);

  const clearRoomState = useCallback((options?: { preserveComposer?: boolean }) => {
    messageRevisionRef.current += 1;
    setMessages([]);
    setMembers([]);
    setRoomInfo(null);
    setCurrentUserId(null);
    setAssigning(false);
    setSending(false);
    setSendNotice(null);
    if (!options?.preserveComposer) {
      setInput("");
    }
  }, []);

  const isLoadCurrent = useCallback((sequence: number, token: CohortIdentityToken) => (
    loadSequenceRef.current === sequence && cohortGateRef.isCurrent(token)
  ), [cohortGateRef]);

  const isLoadOwnerCurrent = useCallback(async (
    sequence: number,
    token: CohortIdentityToken,
  ) => {
    if (!isLoadCurrent(sequence, token)) return false;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === token.ownerId
      && isLoadCurrent(sequence, token);
  }, [isLoadCurrent]);

  const loadRoom = useCallback(async (options?: { silent?: boolean }) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (!options?.silent) setLoading(true);
    setAccessMessage(null);

    if (!roomId) {
      setAccessState("error");
      setAccessMessage("동기방 주소가 올바르지 않아요.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let loadToken: CohortIdentityToken | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (loadSequenceRef.current !== sequence) return;
      const ownerId = data.session?.user.id ?? null;
      const ownerChanged = cohortGateRef.setOwner(ownerId);
      if (ownerChanged) {
        messageIdempotencyRef.clear();
        clearRoomState();
      }
      if (!ownerId) {
        setAccessState("unauthenticated");
        setAccessMessage("동기방은 로그인한 멤버만 이용할 수 있어요.");
        return;
      }
      const token = cohortGateRef.capture();
      if (!token) return;
      loadToken = token;

      const access = await fetchCurrentCohortAccess({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
        roomId,
      });
      if (!(await isLoadOwnerCurrent(sequence, token))) return;

      if (access.status === "unassigned") {
        cohortGateRef.invalidateOperations();
        clearRoomState();
        setAccessState("unassigned");
        setAssignedRoom(null);
        setAccessMessage("아직 배정된 동기방이 없어요. 동의한 뒤 명시적으로 배정받을 수 있어요.");
        return;
      }
      if (access.status === "different_room") {
        cohortGateRef.invalidateOperations();
        clearRoomState();
        setAccessState("different_room");
        setAssignedRoom({ id: access.room.id, name: access.room.name });
        setAccessMessage("이 방은 현재 가입한 동기방이 아니에요. 내 동기방으로 이동할 수 있어요.");
        return;
      }

      const messageRevision = messageRevisionRef.current;
      const [nextMessages, nextMembers] = await Promise.all([
        fetchCohortMessages({
          apiFetchForExpectedUser,
          ownerId: token.ownerId,
          roomId,
        }),
        fetchCohortMembers({
          apiFetchForExpectedUser,
          ownerId: token.ownerId,
          roomId,
        }),
      ]);
      if (!(await isLoadOwnerCurrent(sequence, token))) return;

      setAccessState("member");
      setAssignedRoom({ id: access.room.id, name: access.room.name });
      setRoomInfo({ name: access.room.name, member_count: access.room.memberCount });
      setCurrentUserId(token.ownerId);
      const messageSnapshot = nextMessages.map((message) => ({
        id: message.id,
        room_id: message.roomId,
        author_id: message.authorId,
        author_nickname: message.authorNickname,
        content: message.content,
        topic: message.topic,
        created_at: message.createdAt,
      }));
      setMessages((current) => messageRevisionRef.current === messageRevision
        ? messageSnapshot
        : mergeCohortMessageSnapshot(messageSnapshot, current));
      setMembers(nextMembers);
    } catch (error) {
      if (!loadToken || !(await isLoadOwnerCurrent(sequence, loadToken))) return;
      cohortGateRef.invalidateOperations();
      clearRoomState({ preserveComposer: true });
      setAccessState("error");
      setAccessMessage(
        error instanceof CommunityCohortAccessError
          ? error.displayMessage
          : "동기방 가입 상태와 메시지를 안전하게 확인하지 못했어요.",
      );
    } finally {
      if (loadSequenceRef.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clearRoomState, cohortGateRef, isLoadOwnerCurrent, messageIdempotencyRef, roomId]);

  useFocusEffect(
    useCallback(() => {
      void loadRoom({ silent: true });
    }, [loadRoom]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadRoom({ silent: true });
    });
    return () => subscription.remove();
  }, [loadRoom]);

  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const changed = cohortGateRef.setOwner(session?.user.id ?? null);
      if (!changed) return;
      messageIdempotencyRef.clear();
      loadSequenceRef.current += 1;
      clearRoomState();
      setAccessState("checking");
      setLoading(true);
      setTimeout(() => {
        if (!disposed) void loadRoom();
      }, 0);
    });
    return () => {
      disposed = true;
      loadSequenceRef.current += 1;
      cohortGateRef.setOwner(null);
      messageIdempotencyRef.clear();
      subscription.unsubscribe();
    };
  }, [clearRoomState, cohortGateRef, loadRoom, messageIdempotencyRef]);

  // Supabase Realtime 구독
  useEffect(() => {
    if (!roomId || accessState !== "member") return;
    const identity = cohortGateRef.capture();
    if (!identity) return;

    const channel = supabase
      .channel(`cohort:${roomId}:${identity.ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cohort_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (!cohortGateRef.isCurrent(identity)) return;
          const raw = payload.new as Record<string, unknown>;
          if (
            typeof raw.id !== "string"
            || raw.room_id !== roomId
            || !(raw.author_id === null || typeof raw.author_id === "string")
            || typeof raw.content !== "string"
            || raw.content.trim().length === 0
            || typeof raw.created_at !== "string"
          ) return;
          const newMsg: CohortMessage = {
            id: raw.id,
            room_id: roomId,
            author_id: raw.author_id,
            author_nickname: null, // 멤버 리스트에서 매칭
            content: raw.content as string,
            topic: (raw.thread_topic as string) ?? null,
            created_at: raw.created_at as string,
          };
          messageRevisionRef.current += 1;
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
  }, [accessState, cohortGateRef, roomId]);

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

  async function isOperationOwnerCurrent(token: CohortIdentityToken | CohortMessageToken) {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === token.ownerId
      && cohortGateRef.isCurrent(token);
  }

  async function handleAssignCohort() {
    const token = cohortGateRef.beginAssignment();
    if (!token) return;
    setAssigning(true);
    setAccessMessage(null);
    try {
      const result = await assignCurrentUserToCohort({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
      });
      if (!(await isOperationOwnerCurrent(token))) return;
      if (result.roomId !== roomId) {
        router.replace({
          pathname: "/community/cohort/[id]",
          params: { id: result.roomId },
        });
        return;
      }
      await loadRoom();
    } catch (error) {
      if (!(await isOperationOwnerCurrent(token))) return;
      setAccessMessage(
        error instanceof CommunityCohortAccessError
          ? error.displayMessage
          : "동기방을 배정하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      const shouldCommit = await isOperationOwnerCurrent(token);
      cohortGateRef.finishAssignment(token);
      if (shouldCommit) setAssigning(false);
    }
  }

  // 메시지 전송
  async function handleSend() {
    const text = input.trim();
    if (!text || accessState !== "member") return;
    const token = cohortGateRef.beginMessage();
    if (!token) return;

    setSending(true);
    setSendNotice(null);
    try {
      const topic = selectedTopic === "price"
        || selectedTopic === "review"
        || selectedTopic === "concern"
        || selectedTopic === "chat"
        ? selectedTopic
        : undefined;
      const idempotencyKey = messageIdempotencyRef.keyFor(
        token.ownerId,
        roomId,
        text,
        topic,
      );
      const message = await sendCohortMessage({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
        roomId,
        content: text,
        threadTopic: topic,
        idempotencyKey,
      });
      if (!(await isOperationOwnerCurrent(token))) return;
      messageIdempotencyRef.clearIf(idempotencyKey);
      messageRevisionRef.current += 1;
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current
        : [...current, {
          id: message.id,
          room_id: message.roomId,
          author_id: message.authorId,
          author_nickname: null,
          content: message.content,
          topic: message.topic,
          created_at: message.createdAt,
        }]);
      setInput("");
      setSelectedTopic(null);
    } catch (error) {
      if (!(await isOperationOwnerCurrent(token))) return;
      if (error instanceof CommunityCohortAccessError && error.status === 403) {
        cohortGateRef.invalidateOperations();
        clearRoomState({ preserveComposer: true });
        setAccessState("error");
        setAccessMessage(error.displayMessage);
        return;
      }
      setSendNotice(
        error instanceof CommunityCohortAccessError
          ? error.displayMessage
          : "메시지 전송 결과를 확인하지 못했어요. 입력한 내용은 유지했어요.",
      );
    } finally {
      const shouldCommit = await isOperationOwnerCurrent(token);
      cohortGateRef.finishMessage(token);
      if (shouldCommit) setSending(false);
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

  if (accessState === "checking" || (loading && accessState !== "member")) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="동기방" onBack={() => router.back()} />
        <LoadingState label="내 동기방 가입 상태를 확인하고 있어요" />
      </SafeAreaView>
    );
  }

  if (accessState !== "member") {
    const presentation = accessState === "unassigned"
      ? {
          title: "아직 배정된 동기방이 없어요",
          description: accessMessage ?? "원할 때 동기방을 배정받을 수 있어요.",
          action: (
            <PrimaryButton onPress={handleAssignCohort} disabled={assigning}>
              {assigning ? "배정 확인 중..." : "동기방 배정받기"}
            </PrimaryButton>
          ),
        }
      : accessState === "different_room"
        ? {
            title: "현재 가입한 동기방이 따로 있어요",
            description: accessMessage ?? "내 동기방으로 이동해주세요.",
            action: (
              <PrimaryButton
                onPress={() => {
                  if (!assignedRoom) return;
                  router.replace({
                    pathname: "/community/cohort/[id]",
                    params: { id: assignedRoom.id },
                  });
                }}
                disabled={!assignedRoom}
              >
                {assignedRoom ? `${assignedRoom.name}으로 이동` : "내 동기방으로 이동"}
              </PrimaryButton>
            ),
          }
        : accessState === "unauthenticated"
          ? {
              title: "로그인이 필요해요",
              description: accessMessage ?? "동기방은 로그인한 멤버만 이용할 수 있어요.",
              action: (
                <PrimaryButton onPress={() => router.replace("/(auth)/login")}>
                  로그인하기
                </PrimaryButton>
              ),
            }
          : {
              title: "동기방을 열지 못했어요",
              description: accessMessage ?? "가입 상태를 다시 확인해주세요.",
              action: (
                <PrimaryButton onPress={() => void loadRoom()}>
                  다시 확인하기
                </PrimaryButton>
              ),
            };

    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="동기방" onBack={() => router.back()} />
        <EmptyState
          icon={<Users size={42} color={colors.rose[500]} />}
          title={presentation.title}
          description={presentation.description}
          action={presentation.action}
        />
      </SafeAreaView>
    );
  }

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
                    void loadRoom();
                  }}
                  tintColor={colors.rose[500]}
                />
              }
              ListEmptyComponent={renderChatEmpty}
            />
          )}

          {/* 입력 바 */}
          <View style={styles.inputBar}>
            {sendNotice ? (
              <View style={styles.sendNotice}>
                <Text style={styles.sendNoticeText}>{sendNotice}</Text>
              </View>
            ) : null}
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
  sendNotice: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.rose.glow,
    borderWidth: 1,
    borderColor: colors.rose[500] + "30",
  },
  sendNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
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
