// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 신부=분홍(#F5E6DF), 신랑=파랑(#E8EDF5), AI=noir
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Send, Sparkles, Heart, LockKeyhole } from "lucide-react-native";
import { useRouter } from "expo-router";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { readMyChatViewState, readMySafeProfile } from "@/lib/safeProfile";
import { apiFetch } from "@/lib/api";
import {
  MOBILE_CHAT_DELAY_NOTICE_MS,
  MobileChatCancelledError,
  MobileChatTimeoutError,
  withMobileChatTimeout,
} from "@/lib/chatRequestTimeout";
import {
  ChatApiError,
  isTerminalAmoraChatError,
} from "@/lib/chatApiError";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";
import {
  chatVisibilityForMobileTarget,
  isMessageAfterChatClear,
  isMessageVisibleForMobileTarget,
  normalizeChatVisibility,
  parseChatSse,
  type ChatSseToolResult,
  type ChatVisibility,
  type MobileChatTarget,
  type ParsedChatSse,
} from "@hanbang/shared";

interface ChatMessageMetadata extends Record<string, unknown> {
  target?: string;
  client_request_id?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: ChatMessageMetadata | null;
  visibility: ChatVisibility;
  created_at?: string;
  toolResults?: ChatSseToolResult[];
  suggestions?: string[];
  quotaRemaining?: number;
}

interface PendingAiRequest {
  requestId: string;
  tempId: string;
  body: {
    currentUserMessageId: string;
    coupleId: string;
    senderName: string;
    visibility: ChatVisibility;
    clientRequestId: string;
    clientCapabilities: { toolCards: false; incrementalSse: true };
  };
}

type LoadIssue = "signed_out" | "couple_missing" | "load_failed";
type AiWaitStage = "preparing" | "delayed" | "cancelling" | null;

interface SendIssue {
  message: string;
  retry: "send" | "ai" | "none";
  claimCode?: string;
}

interface ChatStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock?(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toMetadata(value: unknown): ChatMessageMetadata | null {
  return isRecord(value) ? value : null;
}

function toolResultsFromMetadata(metadata: ChatMessageMetadata | null): ChatSseToolResult[] | undefined {
  if (!Array.isArray(metadata?.toolResults)) return undefined;
  const results = metadata.toolResults.filter(isRecord) as ChatSseToolResult[];
  return results.length > 0 ? results : undefined;
}

function toolResultLabels(results: ChatSseToolResult[] | undefined): string[] {
  if (!results?.length) return [];
  return results.slice(-3).map((result) => {
    if (typeof result.displayMessage === "string" && result.displayMessage.trim()) {
      const message = result.displayMessage.trim();
      return message.length > 180 ? `${message.slice(0, 177)}...` : message;
    }
    return result.success === false ? "정보를 확인하지 못했어요." : "정보 확인을 마쳤어요.";
  });
}

function matchesPendingRequest(message: ChatMessage, pending: PendingAiRequest): boolean {
  return message.id === pending.tempId || message.metadata?.client_request_id === pending.requestId;
}

async function readChatSseResponse(
  response: Response,
  onUpdate: (parsed: ParsedChatSse) => void
): Promise<ParsedChatSse> {
  const body = response.body as unknown as { getReader?: () => ChatStreamReader } | null;
  if (!body?.getReader || typeof TextDecoder === "undefined") {
    const parsed = parseChatSse(await response.text());
    onUpdate(parsed);
    return parsed;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let parsed = parseChatSse(raw);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      raw += decoder.decode(value, { stream: true });
      parsed = parseChatSse(raw);
      onUpdate(parsed);
    }
    raw += decoder.decode();
    parsed = parseChatSse(raw);
    onUpdate(parsed);
    return parsed;
  } finally {
    reader.releaseLock?.();
  }
}

async function readResponseError(response: Response, fallback: string): Promise<ChatApiError> {
  const payload = await response.json().catch(() => null);
  const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback;
  const code = isRecord(payload) && typeof payload.code === "string" ? payload.code : undefined;
  return new ChatApiError(message, response.status, code);
}

function cleanAssistantContent(content: string): string {
  return content
    .replace(/\[suggestions\][\s\S]*?\[\/suggestions\]/g, "")
    .replace(/\[suggestions\][\s\S]*$/g, "")
    .trim();
}

function ThinkingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    function a(d: Animated.Value, dl: number) { return Animated.loop(Animated.sequence([Animated.delay(dl), Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }), Animated.timing(d, { toValue: 0, duration: 400, useNativeDriver: true })])); }
    const anims = [a(dot1, 0), a(dot2, 200), a(dot3, 400)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [dot1, dot2, dot3]);
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 4 }}>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.textTertiary, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"bride" | "groom">("bride");
  const [userName, setUserName] = useState("사용자");
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [loadIssue, setLoadIssue] = useState<LoadIssue | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [sendIssue, setSendIssue] = useState<SendIssue | null>(null);
  const [pendingAiRequest, setPendingAiRequest] = useState<PendingAiRequest | null>(null);
  const [aiWaitStage, setAiWaitStage] = useState<AiWaitStage>(null);
  const [target, setTarget] = useState<MobileChatTarget>("ai_shared");
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const previousMessageCountRef = useRef(0);
  const submitLockRef = useRef(false);
  const aiLockRef = useRef(false);
  const activeAiAbortRef = useRef<AbortController | null>(null);
  const aiDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeVisibility = chatVisibilityForMobileTarget(target, userRole);
  const visibleMessages = useMemo(
    () => messages.filter((message) => isMessageVisibleForMobileTarget(message, target, userRole)).reverse(),
    [messages, target, userRole]
  );

  const scrollToLatest = useCallback((animated = true, delay = 40) => {
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated });
    }, delay);
  }, []);

  useEffect(() => () => {
    if (aiDelayTimerRef.current) {
      clearTimeout(aiDelayTimerRef.current);
      aiDelayTimerRef.current = null;
    }
    activeAiAbortRef.current?.abort();
    activeAiAbortRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setInitialLoaded(false);
    setLoadIssue(null);
    setCoupleId(null);
    setUserId(null);
    setPartnerName(null);

    void (async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) {
          if (!cancelled) setLoadIssue("signed_out");
          return;
        }
        if (cancelled) return;
        setUserId(user.id);

        const [profileResult, chatViewResult] = await Promise.all([
          readMySafeProfile(),
          readMyChatViewState(),
        ]);
        const { data: profile, error: profileError } = profileResult;
        const { data: chatView, error: chatViewError } = chatViewResult;
        if (profileError || !profile) throw profileError ?? new Error("프로필을 찾을 수 없습니다.");
        if (chatViewError || !chatView) {
          throw chatViewError ?? new Error("chat view state unavailable");
        }
        if (!profile.couple_id) {
          if (!cancelled) setLoadIssue("couple_missing");
          return;
        }
        if (cancelled) return;
        setCoupleId(profile.couple_id);
        if (profile.name) setUserName(profile.name);
        if (profile.role === "bride" || profile.role === "groom") setUserRole(profile.role);

        // 파트너가 없거나 조회가 실패하면 파트너 탭을 비활성화하고 AI 상담은 계속 제공한다.
        const { data: partners } = await supabase.rpc("get_my_partner_public");
        if (!cancelled) setPartnerName(partners?.[0]?.name?.trim() || null);

        // 최신 200개를 먼저 제한한 뒤, 화면 상태는 시간 오름차순으로 보관한다.
        const { data: history, error: historyError } = await supabase
          .from("chat_messages")
          .select("id, role, sender_type, content, metadata, visibility, created_at")
          .eq("couple_id", profile.couple_id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (historyError) throw historyError;
        if (cancelled) return;

        setMessages((history ?? []).slice().reverse()
          .filter((message) => isMessageAfterChatClear(
            message,
            chatView.shared_chat_cleared_at,
            chatView.private_chat_cleared_at
          ))
          .map((message) => {
          const metadata = toMetadata(message.metadata);
          return {
            id: message.id,
            role: message.role as "user" | "assistant",
            sender_type: message.sender_type as "bride" | "groom" | "ai",
            content: message.content,
            metadata,
            visibility: normalizeChatVisibility(message.visibility),
            created_at: message.created_at,
            toolResults: toolResultsFromMetadata(metadata),
          };
        }));

        const ch = supabase.channel(`chat:${profile.couple_id}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
            const row = payload.new as Record<string, unknown>;
            const metadata = toMetadata(row.metadata);
            const incoming: ChatMessage = {
              id: row.id as string,
              role: row.role as "user" | "assistant",
              sender_type: row.sender_type as "bride" | "groom" | "ai",
              content: row.content as string,
              metadata,
              visibility: normalizeChatVisibility(row.visibility),
              created_at: row.created_at as string,
              toolResults: toolResultsFromMetadata(metadata),
            };
            setMessages((previous) => {
              if (previous.some((message) => message.id === incoming.id)) return previous;
              const requestId = incoming.metadata?.client_request_id;
              const hasMatchingPlaceholder = incoming.sender_type === "ai" && typeof requestId === "string"
                && previous.some((message) => message.id.startsWith("temp_") && message.metadata?.client_request_id === requestId);
              // SSE 완료 이벤트가 canonical ID와 본문을 적용하므로 진행 중 placeholder는 지우지 않는다.
              if (hasMatchingPlaceholder) return previous;
              return [...previous, incoming];
            });
          })
          .subscribe();
        channelRef.current = ch;
      } catch {
        if (!cancelled) setLoadIssue("load_failed");
      } finally {
        if (!cancelled) setInitialLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [reloadNonce]);

  useEffect(() => {
    if (!initialLoaded || messages.length === 0) return;

    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (previousCount === 0) {
      scrollToLatest(false, 0);
      return;
    }

    scrollToLatest(true);
  }, [initialLoaded, target, visibleMessages.length, scrollToLatest]);

  function pressIn() { Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start(); }
  function pressOut() { Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start(); }

  function applyStreamUpdate(pending: PendingAiRequest, parsed: ParsedChatSse) {
    const clean = cleanAssistantContent(parsed.content);
    const serverMessageId = typeof parsed.metadata?.serverMessageId === "string"
      ? parsed.metadata.serverMessageId
      : null;
    const serverCreatedAt = typeof parsed.metadata?.serverCreatedAt === "string"
      ? parsed.metadata.serverCreatedAt
      : undefined;

    setMessages((previous) => previous.map((message) => {
      if (!matchesPendingRequest(message, pending)) return message;
      return {
        ...message,
        id: parsed.completed && serverMessageId ? serverMessageId : message.id,
        content: clean || (parsed.completed ? "응답 내용을 표시하지 못했어요. 다시 시도해주세요." : ""),
        metadata: {
          ...(message.metadata ?? {}),
          ...(parsed.metadata ?? {}),
          client_request_id: pending.requestId,
        },
        created_at: serverCreatedAt ?? message.created_at,
        toolResults: parsed.toolResults ?? message.toolResults,
        suggestions: parsed.suggestions ?? message.suggestions,
        quotaRemaining: parsed.quotaRemaining ?? message.quotaRemaining,
      };
    }));
  }

  async function requestAiReply(pending: PendingAiRequest) {
    if (aiLockRef.current) return;
    aiLockRef.current = true;
    const requestAbortController = new AbortController();
    activeAiAbortRef.current = requestAbortController;
    setPendingAiRequest(pending);
    setSendIssue(null);
    setStreaming(true);
    setAiWaitStage("preparing");
    if (aiDelayTimerRef.current) clearTimeout(aiDelayTimerRef.current);
    aiDelayTimerRef.current = setTimeout(() => {
      if (activeAiAbortRef.current === requestAbortController && !requestAbortController.signal.aborted) {
        setAiWaitStage("delayed");
      }
    }, MOBILE_CHAT_DELAY_NOTICE_MS);
    setMessages((previous) => previous.map((message) => matchesPendingRequest(message, pending)
      ? { ...message, content: "" }
      : message));
    scrollToLatest(true);

    try {
      const parsed = await withMobileChatTimeout(async (signal) => {
        const response = await apiFetch("/api/chat", {
          method: "POST",
          body: JSON.stringify(pending.body),
          signal,
        });
        if (!response.ok) {
          throw await readResponseError(response, "아모라 연결에 실패했어요.");
        }

        return readChatSseResponse(response, (next) => {
          if (!signal.aborted) applyStreamUpdate(pending, next);
        });
      }, { signal: requestAbortController.signal });
      if (parsed.error) throw new ChatApiError(parsed.error, 200, parsed.errorCode);
      if (!parsed.completed) throw new Error("응답 연결이 중간에 끊겼어요.");

      applyStreamUpdate(pending, parsed);
      setInput("");
      setPendingAiRequest(null);
      setSendIssue(null);
      scrollToLatest(true);
    } catch (error) {
      const wasCancelled = error instanceof MobileChatCancelledError;
      const didTimeOut = error instanceof MobileChatTimeoutError;
      const isTerminalLimit = isTerminalAmoraChatError(error);
      const detail = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
      setMessages((previous) => previous.map((message) => matchesPendingRequest(message, pending)
        ? {
            ...message,
            content: wasCancelled
              ? "답변 생성을 중단했어요."
              : didTimeOut
                ? "답변 대기 시간이 끝났어요."
                : "아모라 답변을 불러오지 못했어요.",
          }
        : message));
      if (isTerminalLimit) setPendingAiRequest(null);
      setSendIssue({
        message: wasCancelled
          ? "답변 생성을 중단했어요. 질문은 저장되어 있어 언제든 다시 시도할 수 있어요."
          : didTimeOut
            ? "2분 동안 답변을 받지 못했어요. 질문은 저장되어 있어 다시 시도할 수 있어요."
            : `${detail} 입력한 내용은 그대로 두었어요.`,
        retry: isTerminalLimit ? "none" : "ai",
        claimCode: error instanceof ChatApiError
          || error instanceof MobileChatTimeoutError
          || error instanceof MobileChatCancelledError
          ? error.code
          : undefined,
      });
    } finally {
      if (aiDelayTimerRef.current) {
        clearTimeout(aiDelayTimerRef.current);
        aiDelayTimerRef.current = null;
      }
      if (activeAiAbortRef.current === requestAbortController) {
        activeAiAbortRef.current = null;
      }
      aiLockRef.current = false;
      setStreaming(false);
      setAiWaitStage(null);
    }
  }

  function cancelAiReply() {
    const activeRequest = activeAiAbortRef.current;
    if (!activeRequest || activeRequest.signal.aborted) return;
    setAiWaitStage("cancelling");
    activeRequest.abort();
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || submitting || submitLockRef.current) return;
    if (!coupleId || !userId) {
      setSendIssue({ message: "커플 연결 상태를 확인한 뒤 다시 시도해주세요.", retry: "send" });
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setSendIssue(null);

    try {
      if (target === "partner") {
        if (!partnerName) {
          setSendIssue({ message: "파트너가 연결되면 메시지를 보낼 수 있어요.", retry: "send" });
          return;
        }
        try {
          const response = await apiFetch("/api/chat/messages", {
            method: "POST",
            body: JSON.stringify({ coupleId, content: text, target: "partner", visibility: "shared" }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !isRecord(payload) || !isRecord(payload.message)) {
            const message = isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "메시지를 보내지 못했어요.";
            throw new Error(message);
          }
          const saved = payload.message;
          const metadata = toMetadata(saved.metadata);
          const partnerMessage: ChatMessage = {
            id: saved.id as string,
            role: "user",
            sender_type: userRole,
            content: saved.content as string,
            metadata,
            visibility: normalizeChatVisibility(saved.visibility),
            created_at: saved.created_at as string,
          };
          setMessages((previous) => previous.some((message) => message.id === partnerMessage.id)
            ? previous
            : [...previous, partnerMessage]);
          setInput("");
        } catch (error) {
          setSendIssue({
            message: `${error instanceof Error ? error.message : "메시지를 보내지 못했어요."} 입력한 내용은 그대로 두었어요.`,
            retry: "send",
          });
        }
        return;
      }

      try {
        const persistResponse = await apiFetch("/api/chat/messages", {
          method: "POST",
          body: JSON.stringify({ coupleId, content: text, visibility: activeVisibility }),
        });
        const persistPayload = await persistResponse.json().catch(() => null);
        if (!persistResponse.ok || !isRecord(persistPayload) || !isRecord(persistPayload.message)) {
          const message = isRecord(persistPayload) && typeof persistPayload.error === "string"
            ? persistPayload.error
            : "메시지를 저장하지 못했어요.";
          throw new Error(message);
        }

        const saved = persistPayload.message;
        const userMsg: ChatMessage = {
          id: saved.id as string,
          role: "user",
          sender_type: userRole,
          content: saved.content as string,
          metadata: toMetadata(saved.metadata),
          visibility: activeVisibility,
          created_at: saved.created_at as string,
        };
        const requestId = `mobile:${userMsg.id}`.slice(0, 120);
        const pending: PendingAiRequest = {
          requestId,
          tempId: `temp_${Date.now()}`,
          body: {
            currentUserMessageId: userMsg.id,
            coupleId,
            senderName: userName,
            visibility: activeVisibility,
            clientRequestId: requestId,
            clientCapabilities: { toolCards: false, incrementalSse: true },
          },
        };
        const placeholder: ChatMessage = {
          id: pending.tempId,
          role: "assistant",
          sender_type: "ai",
          content: "",
          metadata: { client_request_id: requestId },
          visibility: activeVisibility,
        };
        setMessages((previous) => [
          ...previous.filter((message) => message.id !== userMsg.id),
          userMsg,
          placeholder,
        ]);
        await requestAiReply(pending);
      } catch (error) {
        setSendIssue({
          message: `${error instanceof Error ? error.message : "메시지를 저장하지 못했어요."} 입력한 내용은 그대로 두었어요.`,
          retry: "send",
        });
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function retrySend() {
    if (submitting || streaming) return;
    if (sendIssue?.retry === "none") return;
    if (sendIssue?.retry === "ai" && pendingAiRequest) {
      const previous = pendingAiRequest;
      setSubmitting(true);
      try {
        // 먼저 같은 ID로 완료 응답 replay/진행 중 상태를 확인한다. 서버가
        // 명시적으로 request_failed를 반환한 뒤에만 새 provider 실행 ID를 만든다.
        if (sendIssue.claimCode !== "request_failed") {
          await requestAiReply(previous);
          return;
        }

        const retryRequestId = `mobile:retry:${Date.now().toString(36)}`;
        const nextPending: PendingAiRequest = {
          ...previous,
          requestId: retryRequestId,
          body: {
            ...previous.body,
            clientRequestId: retryRequestId,
          },
        };
        setMessages((messagesBeforeRetry) => messagesBeforeRetry.map((message) =>
          matchesPendingRequest(message, previous)
            ? {
                ...message,
                id: previous.tempId,
                metadata: { ...(message.metadata ?? {}), client_request_id: retryRequestId },
              }
            : message
        ));
        await requestAiReply(nextPending);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    await handleSend();
  }

  function handleInputChange(value: string) {
    if (pendingAiRequest && value !== input) {
      setMessages((previous) => previous.filter((message) => !matchesPendingRequest(message, pendingAiRequest)));
      setPendingAiRequest(null);
    }
    setSendIssue(null);
    setInput(value);
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isAi = item.sender_type === "ai";
    const isMe = item.sender_type === userRole;
    const isPartnerMsg = item.metadata?.target === "partner";
    const isBride = item.sender_type === "bride";
    const isThinking = isAi && !item.content && streaming && Boolean(
      pendingAiRequest && matchesPendingRequest(item, pendingAiRequest)
    );
    const toolLabels = toolResultLabels(item.toolResults);
    const bubbleBg = isAi ? colors.surface : isMe ? colors.noir[800] : isBride ? "#F5E6DF" : "#E8EDF5";
    const textColor = isMe ? "#FFF" : colors.noir[800];

    return (
      <View style={[st.msgRow, isMe && st.msgRowRight]}>
        {!isMe && (
          <View style={[st.avatar, isAi ? st.avatarAi : isBride ? st.avatarBride : st.avatarGroom]}>
            {isAi ? <Sparkles size={12} color={colors.gold.DEFAULT} /> : <Text style={st.avatarLetter}>{isBride ? "신부" : "신랑"}</Text>}
          </View>
        )}
        <View style={{ maxWidth: "78%" }}>
          {!isMe && <Text style={st.senderLabel}>{isAi ? "아모라" : isBride ? (userRole === "bride" ? userName : partnerName ?? "신부") : (userRole === "groom" ? userName : partnerName ?? "신랑")}{isPartnerMsg ? " ♥" : ""}</Text>}
          <View style={[st.bubble, { backgroundColor: bubbleBg }, !isMe && !isAi && { borderWidth: 1, borderColor: isBride ? "#E8C5B8" : "#C5CEE0" }, isAi && { borderWidth: 1, borderColor: colors.border }, isMe && st.bubbleRight, !isMe && st.bubbleLeft]}>
            {isThinking && <ThinkingDots />}
            {!isThinking && Boolean(item.content) && <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>{item.content}</Text>}
            {toolLabels.map((label, index) => (
              <View key={`${item.id}:tool:${index}`} style={st.toolStatus}>
                <Sparkles size={11} color={colors.gold.DEFAULT} />
                <Text style={st.toolStatusText}>{label}</Text>
              </View>
            ))}
          </View>
          {isAi && Boolean(item.suggestions?.length) && (
            <View style={st.messageSuggestions}>
              {item.suggestions!.slice(0, 3).map((suggestion) => (
                <Pressable key={`${item.id}:${suggestion}`} style={st.messageSuggestionBtn} onPress={() => handleInputChange(suggestion)}>
                  <Text style={st.messageSuggestionText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  const isP = target === "partner";
  const isPrivate = target === "ai_private";
  const targetLocked = submitting || streaming || Boolean(pendingAiRequest);
  const loadCopy = loadIssue === "signed_out"
    ? { title: "로그인이 필요해요", description: "로그인하면 아모라 대화를 안전하게 이어갈 수 있어요.", action: "로그인하기" }
    : loadIssue === "couple_missing"
      ? { title: "커플 연결이 필요해요", description: "내 정보를 먼저 설정하거나 파트너 초대 코드를 연결해주세요.", action: "연결 설정하기" }
      : { title: "대화를 불러오지 못했어요", description: "네트워크 상태를 확인하고 다시 불러와 주세요.", action: "다시 불러오기" };

  function handleLoadIssueAction() {
    if (loadIssue === "signed_out") {
      router.replace("/(auth)/login");
    } else if (loadIssue === "couple_missing") {
      router.push("/onboarding");
    } else {
      setReloadNonce((value) => value + 1);
    }
  }

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>AI 웨딩 플래너</Text></View></View>
        {visibleMessages.length > 0 && <StatusPill label={`${visibleMessages.length}`} tone="neutral" />}
      </View>

      <View style={st.targetRow}>
        <Pressable style={[st.targetBtn, target === "ai_shared" && st.targetActive, targetLocked && st.targetDisabled]} onPress={() => setTarget("ai_shared")} disabled={targetLocked} accessibilityRole="tab" accessibilityLabel="커플이 함께 보는 아모라 대화" accessibilityState={{ selected: target === "ai_shared", disabled: targetLocked }}><Sparkles size={14} color={target === "ai_shared" ? colors.gold.DEFAULT : colors.textTertiary} /><Text style={[st.targetText, target === "ai_shared" && st.targetTextActive]}>함께</Text></Pressable>
        <Pressable style={[st.targetBtn, isPrivate && st.targetPrivate, targetLocked && st.targetDisabled]} onPress={() => setTarget("ai_private")} disabled={targetLocked} accessibilityRole="tab" accessibilityLabel="나만 보는 아모라 비공개 대화" accessibilityState={{ selected: isPrivate, disabled: targetLocked }}><LockKeyhole size={14} color={isPrivate ? colors.noir[800] : colors.textTertiary} /><Text style={[st.targetText, isPrivate && st.targetTextPrivate]}>나만</Text></Pressable>
        <Pressable
          style={[st.targetBtn, isP && st.targetPartner, (!partnerName || targetLocked) && st.targetDisabled]}
          onPress={() => setTarget("partner")}
          disabled={!partnerName || targetLocked}
          accessibilityRole="tab"
          accessibilityLabel={partnerName ? `${partnerName}님과 대화` : "파트너 미연결"}
          accessibilityState={{ selected: isP, disabled: !partnerName || targetLocked }}
        >
          <Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} />
          <Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너 미연결"}</Text>
        </Pressable>
      </View>

      {!isP && (
        <Pressable
          style={st.aiNotice}
          onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai"}/ai-policy`)}
          accessibilityRole="link"
          accessibilityLabel="AI 생성 안내와 AI 정책 열기"
        >
          <Sparkles size={12} color={colors.gold.DEFAULT} />
          <Text style={st.aiNoticeText}>AI 생성 · {isPrivate ? "나만 보는 대화" : "커플이 함께 보는 대화"} · 중요한 계약·비용은 직접 확인 · AI 정책</Text>
        </Pressable>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : loadIssue ? (
          <View style={st.empty}>
            <EmptyState
              icon={<IconBadge tone="noir" size={64}><Sparkles size={28} color={colors.gold.DEFAULT} /></IconBadge>}
              title={loadCopy.title}
              description={loadCopy.description}
            />
            <Pressable style={st.primaryRetryBtn} onPress={handleLoadIssueAction} accessibilityRole="button">
              <Text style={st.primaryRetryText}>{loadCopy.action}</Text>
            </Pressable>
          </View>
        ) : visibleMessages.length === 0 ? (
          <View style={st.empty}>
            <EmptyState
              icon={
                <IconBadge tone="noir" size={64}>
                  <Sparkles size={28} color={colors.gold.DEFAULT} />
                </IconBadge>
              }
              title={isP ? `${partnerName ?? "파트너"}님과 대화` : "안녕하세요, 아모라예요"}
              description={isP
                ? "커플이 함께 보는 대화예요.\n첫 메시지를 보내보세요."
                : isPrivate
                  ? "이 대화는 나만 볼 수 있어요.\n상대방에게 공유되지 않아요."
                  : "이 대화는 커플이 함께 볼 수 있어요.\n계약서 확인 질문, 공식 조사 시세, 직접 시작한 일정·예산 정리를 물어보세요. 실시간 업체·장소 검색이나 예약은 제공하지 않아요."}
            />
            {!isP && <View style={st.suggestions}>{["공식 조사 스드메 가격의 조사월과 범위를 알려줘", "내가 시작한 준비 항목을 정리해줘", "예식장 계약서에서 직접 확인할 질문을 정리해줘"].map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => setInput(q)}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>}
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        {streaming && pendingAiRequest && aiWaitStage && (
          <View style={st.generationStatus} accessibilityLiveRegion="polite">
            <View style={st.generationStatusCopy}>
              <ThinkingDots />
              <Text style={st.generationStatusText}>
                {aiWaitStage === "delayed"
                  ? "여러 정보를 확인하느라 평소보다 오래 걸리고 있어요. 최대 2분까지만 기다릴게요."
                  : aiWaitStage === "cancelling"
                    ? "답변 생성을 중단하고 있어요."
                    : "아모라가 답변을 준비하고 있어요."}
              </Text>
            </View>
            <Pressable
              style={[st.cancelGenerationBtn, aiWaitStage === "cancelling" && st.cancelGenerationBtnDisabled]}
              onPress={cancelAiReply}
              disabled={aiWaitStage === "cancelling"}
              accessibilityRole="button"
              accessibilityLabel="아모라 답변 생성 중단"
              accessibilityHint="작성 중인 답변만 중단하고 저장된 질문은 유지합니다"
              accessibilityState={{ disabled: aiWaitStage === "cancelling" }}
            >
              <Text style={st.cancelGenerationText}>{aiWaitStage === "cancelling" ? "중단 중" : "생성 중단"}</Text>
            </Pressable>
          </View>
        )}

        {sendIssue && !loadIssue && (
          <View style={st.sendIssue} accessibilityRole="alert">
            <Text style={st.sendIssueText}>{sendIssue.message}</Text>
            {sendIssue.retry !== "none" && (
              <Pressable style={st.retryLink} onPress={retrySend} disabled={submitting || streaming} accessibilityRole="button">
                <Text style={st.retryLinkText}>{submitting || streaming ? "다시 연결 중" : "다시 시도"}</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput style={st.input} value={input} onChangeText={handleInputChange} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : isPrivate ? "나만의 고민을 입력하세요..." : "함께 볼 메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!submitting && !streaming && !loadIssue} returnKeyType="send" accessibilityLabel="메시지 입력" />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            <Pressable style={[st.sendBtn, isP && { backgroundColor: colors.rose[500] }, (!input.trim() || submitting || streaming || Boolean(loadIssue)) && st.sendBtnOff]} onPress={pendingAiRequest ? retrySend : handleSend} onPressIn={pressIn} onPressOut={pressOut} disabled={!input.trim() || submitting || streaming || Boolean(loadIssue)} accessibilityLabel={pendingAiRequest ? "아모라 답변 다시 받기" : "메시지 보내기"} accessibilityRole="button">
              {submitting ? <ActivityIndicator size="small" color="#FFF" /> : isP ? <Heart size={18} color="#FFF" /> : <Send size={18} color="#FFF" />}
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLogo: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.noir[800], alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  headerSub: { fontSize: 11, color: colors.textTertiary },
  targetRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  targetBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11 },
  targetActive: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPrivate: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPartner: { borderBottomWidth: 2, borderBottomColor: colors.rose[500] },
  targetDisabled: { opacity: 0.48 },
  targetText: { fontSize: 14, color: colors.textTertiary },
  targetTextActive: { color: colors.noir[800], fontWeight: "600" },
  targetTextPrivate: { color: colors.noir[800], fontWeight: "600" },
  targetTextPartner: { color: colors.rose[500], fontWeight: "600" },
  aiNotice: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  aiNoticeText: { fontSize: 12, color: colors.textSecondary, textDecorationLine: "underline" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13, color: colors.textTertiary },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: { paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sugText: { fontSize: 14, color: colors.noir[800] },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarAi: { backgroundColor: colors.noir[800] },
  avatarBride: { backgroundColor: "#F5E6DF" },
  avatarGroom: { backgroundColor: "#E8EDF5" },
  avatarLetter: { fontSize: 8, fontWeight: "700", color: colors.noir[800] },
  senderLabel: { fontSize: 11, color: colors.textTertiary, marginBottom: 4, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  toolStatus: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  toolStatusText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  messageSuggestions: { gap: 6, marginTop: 7 },
  messageSuggestionBtn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  messageSuggestionText: { fontSize: 12, lineHeight: 17, color: colors.noir[800] },
  primaryRetryBtn: { minHeight: 44, minWidth: 160, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.noir[800] },
  primaryRetryText: { fontSize: 14, fontWeight: "600", color: "#FFF" },
  generationStatus: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  generationStatusCopy: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  generationStatusText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  cancelGenerationBtn: { minHeight: 44, minWidth: 88, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.noir[800], backgroundColor: colors.surface },
  cancelGenerationBtnDisabled: { opacity: 0.5 },
  cancelGenerationText: { fontSize: 12, fontWeight: "700", color: colors.noir[800] },
  sendIssue: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#FFF5F3", borderTopWidth: 1, borderTopColor: colors.rose.light },
  sendIssueText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.noir[800] },
  retryLink: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10 },
  retryLinkText: { fontSize: 12, fontWeight: "700", color: colors.rose[600] },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.noir[800], backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
});
