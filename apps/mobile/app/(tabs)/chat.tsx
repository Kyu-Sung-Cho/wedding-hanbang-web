// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 신부=분홍(#F5E6DF), 신랑=파랑(#E8EDF5), AI=noir
import { useState, useRef, useEffect, useCallback, useMemo, type SetStateAction } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { Check, Send, ShieldCheck, Sparkles, Heart, X, Lock } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { normalizeMediationBlock } from "@/lib/amoraMediation";
import {
  getPendingAmoraAction,
  getPendingActionDisabledReason,
  type PendingActionDisabledReason,
} from "@/lib/pendingAmoraAction";
import {
  chatVisibilityForScope,
  isMessageInAiContext,
  isMessageInChatScope,
  selectChatScope,
  updateChatScopeDraft,
  type ChatScope,
  type ChatScopeDrafts,
} from "@/lib/chatPrivacyScope";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";
import AmoraMediationCard from "@/components/chat/AmoraMediationCard";

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const CHAT_REQUEST_TIMEOUT_MS = 180_000;

interface ChatMessageMetadata {
  target?: string;
  client_request_id?: string;
  client_visible_request_id?: string;
  mediation?: unknown;
  pending_amora_action?: unknown;
}

type ChatMessageVisibility = "shared" | "bride_private" | "groom_private";
type ViewerRole = "bride" | "groom" | null;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: ChatMessageMetadata | null;
  created_at?: string;
  visibility: ChatMessageVisibility;
}

type MessageTarget = "ai" | "partner";
type ChatApiMessage = Pick<ChatMessage, "role" | "content">;

interface ChatRequestBody {
  messages: ChatApiMessage[];
  coupleId: string;
  senderName: string;
  clientRequestId: string;
  userMessageId: string;
  visibility: ChatMessageVisibility;
  confirmedActionId?: string;
}

interface AiDraft {
  text: string;
  clientRequestId: string;
  startedAt: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  senderName: string;
  context: ChatApiMessage[];
  visibility: ChatMessageVisibility;
  confirmedActionId?: string;
}

interface AiRequest {
  body: ChatRequestBody;
  tempId: string;
  serverRequestKey: string;
}

interface PartnerDraft {
  text: string;
  startedAt: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  visibility: "shared";
}

type SendFailure =
  | { kind: "partner_insert"; message: string; draft: PartnerDraft }
  | { kind: "ai_insert"; message: string; draft: AiDraft }
  | { kind: "ai_response"; message: string; request: AiRequest };

function sendFailureVisibility(failure: SendFailure): ChatMessageVisibility {
  return failure.kind === "ai_response"
    ? failure.request.body.visibility
    : failure.draft.visibility;
}

type ChatStreamEvent = {
  type?: string;
  content?: unknown;
  fullContent?: unknown;
  text?: unknown;
  chunk?: unknown;
  message?: unknown;
  remaining?: unknown;
  metadata?: unknown;
  delta?: { text?: unknown };
};

type ChatStreamState = {
  streamed: string;
  completed: string | null;
  error: boolean;
};

class ChatTransportError extends Error {
  constructor(
    public readonly code: "AUTH" | "CANCELLED" | "EMPTY" | "HTTP" | "NETWORK" | "STREAM" | "TIMEOUT",
    public readonly status?: number,
  ) {
    super(code);
    this.name = "ChatTransportError";
  }
}

function normalizeChatVisibility(value: unknown): ChatMessageVisibility | null {
  return value === "shared" || value === "bride_private" || value === "groom_private"
    ? value
    : null;
}

function chatMessageFromRealtimeRow(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const visibility = normalizeChatVisibility(row.visibility);
  const validRole = row.role === "user" || row.role === "assistant";
  const validSender = row.sender_type === "bride"
    || row.sender_type === "groom"
    || row.sender_type === "ai";
  if (
    typeof row.id !== "string"
    || !validRole
    || !validSender
    || typeof row.content !== "string"
    || typeof row.created_at !== "string"
    || !visibility
  ) return null;

  const metadata = row.metadata !== null
    && typeof row.metadata === "object"
    && !Array.isArray(row.metadata)
    ? row.metadata as ChatMessageMetadata
    : null;
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    sender_type: row.sender_type as ChatMessage["sender_type"],
    content: row.content,
    metadata,
    created_at: row.created_at,
    visibility,
  };
}

function canViewerSeeChatMessage(message: ChatMessage, viewerRole: ViewerRole): boolean {
  if (message.visibility === "shared") return true;
  return viewerRole !== null && message.visibility === `${viewerRole}_private`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asChatStreamEvent(value: unknown): ChatStreamEvent | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ChatStreamEvent
    : null;
}

function applyChatEvent(
  event: ChatStreamEvent,
  state: ChatStreamState,
): boolean {
  if (event.type === "error") {
    state.streamed = "";
    state.completed = null;
    state.error = true;
    return false;
  }

  if (event.type === "text_clear") {
    state.streamed = "";
    state.completed = null;
    return true;
  }

  if (event.type === "done") {
    state.completed = nonEmptyString(event.fullContent)
      ?? nonEmptyString(event.content)
      ?? nonEmptyString(event.text)
      ?? state.streamed;
    return true;
  }

  const delta = event.type === "text_delta"
    ? nonEmptyString(event.content)
    : event.type === "content_block_delta"
      ? nonEmptyString(event.delta?.text)
      : nonEmptyString(event.text) ?? nonEmptyString(event.chunk);

  if (!delta) return false;
  state.streamed += delta;
  return true;
}

function cleanAiText(value: string, final: boolean): string {
  const withoutSuggestions = value.replace(
    /\[suggestions\][\s\S]*?(?:\[\/suggestions\]|$)/gi,
    "",
  );
  return final ? withoutSuggestions.trim() : withoutSuggestions.trimStart();
}

function createChatStreamParser(
  onText: (text: string) => void,
  onQuota: (remaining: number) => void = () => undefined,
  onDoneMetadata: (metadata: Record<string, unknown>) => void = () => undefined,
) {
  const state: ChatStreamState = { streamed: "", completed: null, error: false };
  let buffer = "";
  let raw = "";
  let sawSseData = false;

  function emit() {
    onText(cleanAiText(state.completed ?? state.streamed, false));
  }

  function consumeBlock(block: string) {
    const dataLines = block
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;

    sawSseData = true;
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return;

    try {
      const parsed: unknown = JSON.parse(data);
      const event = asChatStreamEvent(parsed);
      if (event) {
        if (event.type === "quota") {
          if (
            typeof event.remaining === "number"
            && Number.isInteger(event.remaining)
            && event.remaining >= 0
          ) {
            onQuota(event.remaining);
          }
          return;
        }
        if (
          event.type === "done"
          && event.metadata !== null
          && typeof event.metadata === "object"
          && !Array.isArray(event.metadata)
        ) {
          onDoneMetadata(event.metadata as Record<string, unknown>);
        }
        const hadVisibleDraft = Boolean(state.completed ?? state.streamed);
        if (applyChatEvent(event, state)) emit();
        else if (event.type === "error" && hadVisibleDraft) onText("");
      } else if (typeof parsed === "string") {
        state.streamed += parsed;
        emit();
      }
    } catch {
      // Preserve legacy plain SSE text, but never render JSON-looking payloads.
      if (!data.startsWith("{") && !data.startsWith("[") && !data.startsWith("\"")) {
        state.streamed += data;
        emit();
      }
    }
  }

  function push(chunk: string) {
    if (!chunk) return;
    raw += chunk;
    buffer += chunk;

    while (buffer.length > 0) {
      const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
      if (!boundary || boundary.index === undefined) break;
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      consumeBlock(block);
    }
  }

  function finish(): string {
    if (buffer.trim()) {
      if (sawSseData || /(^|\r?\n)data:/.test(buffer)) consumeBlock(buffer);
      buffer = "";
    }

    if (!sawSseData) {
      const trimmed = raw.trim();
      if (trimmed) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          const event = asChatStreamEvent(parsed);
          if (event) applyChatEvent(event, state);
          else if (typeof parsed === "string") state.completed = parsed;
        } catch {
          // Preserve legacy plain text, but never expose serialized JSON as chat text.
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) {
            state.completed = trimmed;
          }
        }
      }
    }

    if (state.error) throw new ChatTransportError("STREAM");
    return cleanAiText(state.completed ?? state.streamed, true);
  }

  return { push, finish };
}

function streamChatWithXhr(
  body: ChatRequestBody,
  accessToken: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatTransportError("CANCELLED"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const parser = createChatStreamParser(onText, onQuota, onDoneMetadata);
    let consumedLength = 0;
    let settled = false;

    const cleanup = () => signal.removeEventListener("abort", abortRequest);
    const rejectOnce = (error: ChatTransportError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const consumeAvailableText = () => {
      if (xhr.status < 200 || xhr.status >= 300) return;
      const cumulative = xhr.responseText ?? "";
      if (cumulative.length < consumedLength) consumedLength = 0;
      const chunk = cumulative.slice(consumedLength);
      consumedLength = cumulative.length;
      parser.push(chunk);
    };
    function abortRequest() {
      xhr.abort();
    }

    xhr.open("POST", `${API_BASE}/api/chat`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.timeout = CHAT_REQUEST_TIMEOUT_MS;
    xhr.onprogress = consumeAvailableText;
    xhr.onload = () => {
      consumeAvailableText();
      if (xhr.status < 200 || xhr.status >= 300) {
        rejectOnce(new ChatTransportError("HTTP", xhr.status));
        return;
      }
      try {
        const finalText = parser.finish();
        if (!finalText) throw new ChatTransportError("EMPTY");
        resolveOnce(finalText);
      } catch (error) {
        rejectOnce(error instanceof ChatTransportError ? error : new ChatTransportError("STREAM"));
      }
    };
    xhr.onerror = () => rejectOnce(new ChatTransportError("NETWORK"));
    xhr.ontimeout = () => rejectOnce(new ChatTransportError("TIMEOUT"));
    xhr.onabort = () => rejectOnce(new ChatTransportError("CANCELLED"));
    signal.addEventListener("abort", abortRequest, { once: true });

    try {
      xhr.send(JSON.stringify(body));
    } catch {
      rejectOnce(new ChatTransportError("NETWORK"));
    }
  });
}

function waitForUnlessAborted<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatTransportError("CANCELLED"));
      return;
    }
    const abort = () => reject(new ChatTransportError("CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function requestChatStream(
  body: ChatRequestBody,
  signal: AbortSignal,
  onText: (text: string) => void,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
): Promise<string> {
  const { data: sessionData } = await waitForUnlessAborted(
    supabase.auth.getSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new ChatTransportError("AUTH");

  try {
    return await streamChatWithXhr(body, accessToken, signal, onText, onQuota, onDoneMetadata);
  } catch (error) {
    if (!(error instanceof ChatTransportError) || error.status !== 401 || signal.aborted) {
      throw error;
    }
  }

  // Refresh once and replay the exact same logical request id and payload.
  const { data: refreshed, error: refreshError } = await waitForUnlessAborted(
    supabase.auth.refreshSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  if (refreshError || !refreshed.session?.access_token) throw new ChatTransportError("AUTH");
  return streamChatWithXhr(
    body,
    refreshed.session.access_token,
    signal,
    onText,
    onQuota,
    onDoneMetadata,
  );
}

function getAiFailureMessage(error: unknown, timedOut: boolean): string {
  if (timedOut || (error instanceof ChatTransportError && error.code === "TIMEOUT")) {
    return "답변이 평소보다 오래 걸렸어요. 같은 요청으로 다시 이어갈 수 있어요.";
  }
  if (error instanceof ChatTransportError) {
    if (error.code === "AUTH") return "로그인이 만료됐어요. 다시 로그인한 뒤 재시도해 주세요.";
    if (error.status === 409) return "아모라가 같은 답변을 아직 만들고 있어요. 잠시 후 다시 시도해 주세요.";
    if (error.status === 429) return "요청이 잠시 몰렸어요. 조금 뒤에 다시 시도해 주세요.";
  }
  return "답변을 가져오지 못했어요. 입력한 질문은 저장되어 있으니 다시 시도해 주세요.";
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<ViewerRole>(null);
  const [userName, setUserName] = useState("사용자");
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [target, setTarget] = useState<MessageTarget>("ai");
  const [activeScope, setActiveScope] = useState<ChatScope>("shared");
  const [inputByScope, setInputByScope] = useState<ChatScopeDrafts>({
    shared: "",
    private: "",
  });
  const input = inputByScope[activeScope];
  const setActiveInput = useCallback((nextInput: SetStateAction<string>) => {
    setInputByScope((currentDrafts) => {
      const currentInput = currentDrafts[activeScope];
      const resolvedInput = typeof nextInput === "function"
        ? nextInput(currentInput)
        : nextInput;
      return updateChatScopeDraft(currentDrafts, activeScope, resolvedInput);
    });
  }, [activeScope]);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissedPendingActionIds, setDismissedPendingActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [applyingPendingActionId, setApplyingPendingActionId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const applyingPendingActionRef = useRef<string | null>(null);
  const persistedAiRequestKeysRef = useRef(new Set<string>());
  const previousMessageCountRef = useRef(0);
  const scopedMessages = useMemo(
    () => messages.filter((message) => (
      isMessageInChatScope(message.visibility, activeScope, userRole)
    )),
    [activeScope, messages, userRole],
  );
  const visibleMessages = useMemo(() => [...scopedMessages].reverse(), [scopedMessages]);
  const selectedVisibility = chatVisibilityForScope(activeScope, userRole);
  const activeSendFailure = sendFailure && selectedVisibility
    && sendFailureVisibility(sendFailure) === selectedVisibility
    ? sendFailure
    : null;
  const latestSharedMessageId = [...messages]
    .reverse()
    .find((message) => message.visibility === "shared")?.id ?? null;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const scrollToLatest = useCallback((animated = true, delay = 40) => {
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated });
    }, delay);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setInitialLoaded(true); return; }
      setUserId(user.id);

      const { data: profile } = await supabase.from("profiles").select("name, role, couple_id").eq("id", user.id).single();
      if (!profile?.couple_id) { setInitialLoaded(true); return; }
      const viewerRole: ViewerRole = profile.role === "bride" || profile.role === "groom"
        ? profile.role
        : null;
      setCoupleId(profile.couple_id);
      if (profile.name) setUserName(profile.name);
      if (viewerRole) setUserRole(viewerRole);

      // 파트너
      const { data: partners } = await supabase.from("couple_profile_directory").select("name").eq("couple_id", profile.couple_id).neq("id", user.id);
      if (partners?.[0]) setPartnerName(partners?.[0]?.name ?? "");

      // 대화 이력
      const { data: history } = await supabase.from("chat_messages")
        .select("id, role, sender_type, content, metadata, created_at, visibility")
        .eq("couple_id", profile.couple_id).order("created_at", { ascending: true }).limit(200);

      if (history?.length) {
        const historyMessages = history
          .map((message) => chatMessageFromRealtimeRow(message))
          .filter((message): message is ChatMessage => (
            message !== null && canViewerSeeChatMessage(message, viewerRole)
          ));
        for (const message of historyMessages) {
          const metadata = message.metadata;
          const persistedRequestKey = metadata?.client_visible_request_id ?? metadata?.client_request_id;
          if (message.sender_type === "ai" && persistedRequestKey) {
            persistedAiRequestKeysRef.current.add(persistedRequestKey);
          }
        }
        setMessages(historyMessages);
      }

      // Realtime
      const ch = supabase.channel(`chat:${profile.couple_id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          const incoming = chatMessageFromRealtimeRow(payload.new);
          if (!incoming || !canViewerSeeChatMessage(incoming, viewerRole)) return;
          const incomingMetadata = incoming.metadata;
          const incomingRequestKey = incoming.sender_type === "ai"
            ? incomingMetadata?.client_visible_request_id ?? incomingMetadata?.client_request_id
            : undefined;
          if (incomingRequestKey) {
            persistedAiRequestKeysRef.current.add(incomingRequestKey);
            setSendFailure((failure) =>
              failure?.kind === "ai_response" && failure.request.serverRequestKey === incomingRequestKey
                ? null
                : failure
            );
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            const withoutMatchingPlaceholder = incomingRequestKey
              ? prev.filter((m) => !(
                m.id.startsWith("temp_") &&
                m.metadata?.client_request_id === incomingRequestKey
              ))
              : prev;
            return [...withoutMatchingPlaceholder, incoming];
          });
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          const updated = chatMessageFromRealtimeRow(payload.new);
          const updatedId = updated?.id
            ?? (payload.new as Record<string, unknown> | null)?.id;
          if (typeof updatedId !== "string") return;
          setMessages((previous) => {
            if (!updated || !canViewerSeeChatMessage(updated, viewerRole)) {
              return previous.filter((message) => message.id !== updatedId);
            }
            if (!previous.some((message) => message.id === updated.id)) return previous;
            return previous.map((message) => message.id === updated.id ? updated : message);
          });
        })
        .subscribe();
      channelRef.current = ch;
      setInitialLoaded(true);
    })();
    return () => {
      mountedRef.current = false;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!initialLoaded || scopedMessages.length === 0) return;

    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = scopedMessages.length;

    if (previousCount === 0) {
      scrollToLatest(false, 0);
      return;
    }

    scrollToLatest(true);
  }, [initialLoaded, scopedMessages.length, scrollToLatest]);

  function pressIn() { Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start(); }
  function pressOut() { Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start(); }

  async function findDurableUserMessage(
    draft: Pick<AiDraft, "text" | "startedAt" | "coupleId" | "userId" | "senderType" | "visibility">,
    intendedTarget: MessageTarget,
  ): Promise<ChatMessage | null> {
    const { data, error } = await supabase.from("chat_messages")
      .select("id, role, sender_type, content, metadata, created_at, visibility")
      .eq("couple_id", draft.coupleId)
      .eq("sender_id", draft.userId)
      .eq("sender_type", draft.senderType)
      .eq("role", "user")
      .eq("content", draft.text)
      .eq("visibility", draft.visibility)
      .gte("created_at", draft.startedAt)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error || !data) return null;
    const match = data.find((row) => {
      const metadata = row.metadata as ChatMessageMetadata | null;
      return intendedTarget === "partner"
        ? metadata?.target === "partner"
        : metadata?.target !== "partner";
    });
    if (!match) return null;
    return chatMessageFromRealtimeRow(match);
  }

  async function sendPartnerDraft(draft: PartnerDraft, reconcileFirst: boolean) {
    setStreaming(true);
    setSendFailure(null);
    try {
      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "partner")
        : null;

      if (!durableMessage) {
        const { data, error } = await supabase.from("chat_messages")
          .insert({
            couple_id: draft.coupleId,
            sender_id: draft.userId,
            sender_type: draft.senderType,
            role: "user",
            content: draft.text,
            metadata: { target: "partner" },
            visibility: draft.visibility,
          })
          .select("id, role, sender_type, content, metadata, created_at, visibility")
          .single();

        const insertedMessage = !error && data
          ? chatMessageFromRealtimeRow(data)
          : null;
        durableMessage = insertedMessage ?? await findDurableUserMessage(draft, "partner");
      }

      if (!durableMessage) throw new Error("partner message was not persisted");
      if (mountedRef.current) {
        setMessages((previous) => previous.some((message) => message.id === durableMessage.id)
          ? previous
          : [...previous, durableMessage]
        );
        setActiveInput((current) => current.trim() === draft.text ? "" : current);
      }
    } catch {
      if (mountedRef.current) {
        setSendFailure({
          kind: "partner_insert",
          message: "메시지를 저장하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
        });
      }
    } finally {
      if (mountedRef.current) setStreaming(false);
    }
  }

  async function streamAiRequest(request: AiRequest) {
    if (!mountedRef.current) return;
    if (persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
      setSendFailure(null);
      setStreaming(false);
      return;
    }
    setSendFailure(null);
    setQuotaRemaining(null);
    setStreaming(true);
    setMessages((previous) => {
      const hasPersistedAnswer = previous.some((message) =>
        !message.id.startsWith("temp_") &&
        message.sender_type === "ai" &&
        message.metadata?.client_request_id === request.serverRequestKey
      );
      if (hasPersistedAnswer) return previous;
      const placeholder: ChatMessage = {
        id: request.tempId,
        role: "assistant",
        sender_type: "ai",
        content: "",
        metadata: { client_request_id: request.serverRequestKey },
        visibility: request.body.visibility,
      };
      const existingIndex = previous.findIndex((message) => message.id === request.tempId);
      if (existingIndex < 0) return [...previous, placeholder];
      return previous.map((message) => message.id === request.tempId ? placeholder : message);
    });
    scrollToLatest(true);

    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;
    let timedOut = false;
    let completionPendingAction: ReturnType<typeof getPendingAmoraAction> = null;
    let pendingText = "";
    let renderFrame: number | null = null;
    const cancelPendingRender = () => {
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      renderFrame = null;
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const fullText = await requestChatStream(
        request.body,
        controller.signal,
        (partialText) => {
          if (!mountedRef.current) return;
          pendingText = partialText;
          if (renderFrame !== null) return;
          renderFrame = requestAnimationFrame(() => {
            renderFrame = null;
            if (!mountedRef.current) return;
            setMessages((previous) => previous.map((message) =>
              message.id === request.tempId ? { ...message, content: pendingText } : message
            ));
          });
        },
        (remaining) => {
          if (mountedRef.current) setQuotaRemaining(remaining);
        },
        (metadata) => {
          completionPendingAction = getPendingAmoraAction({
            sender_type: "ai",
            visibility: request.body.visibility,
            metadata: { pending_amora_action: metadata.pending_amora_action },
          });
        },
      );
      cancelPendingRender();
      if (mountedRef.current) {
        setMessages((previous) => previous.map((message) => {
          if (message.id !== request.tempId) return message;
          return {
            ...message,
            content: fullText,
            metadata: completionPendingAction
              ? { ...message.metadata, pending_amora_action: completionPendingAction }
              : message.metadata,
          };
        }));
        scrollToLatest(true);
      }
    } catch (error) {
      const cancelledByUnmount =
        !mountedRef.current &&
        error instanceof ChatTransportError &&
        error.code === "CANCELLED";
      if (!cancelledByUnmount && mountedRef.current) {
        cancelPendingRender();
        setMessages((previous) => previous.filter((message) => message.id !== request.tempId));
        if (!persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
          setSendFailure({
            kind: "ai_response",
            message: getAiFailureMessage(error, timedOut),
            request,
          });
        }
      }
    } finally {
      cancelPendingRender();
      clearTimeout(timeout);
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      if (mountedRef.current) setStreaming(false);
    }
  }

  async function sendAiDraft(draft: AiDraft, reconcileFirst: boolean) {
    setStreaming(true);
    setSendFailure(null);
    try {
      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "ai")
        : null;

      if (!durableMessage) {
        const { data, error } = await supabase.from("chat_messages")
          .insert({
            couple_id: draft.coupleId,
            sender_id: draft.userId,
            sender_type: draft.senderType,
            role: "user",
            content: draft.text,
            visibility: draft.visibility,
          })
          .select("id, role, sender_type, content, metadata, created_at, visibility")
          .single();

        const insertedMessage = !error && data
          ? chatMessageFromRealtimeRow(data)
          : null;
        durableMessage = insertedMessage ?? await findDurableUserMessage(draft, "ai");
      }

      if (!durableMessage) throw new Error("user message was not persisted");

      const serverRequestKey = `chat:${draft.userId}:${draft.clientRequestId}`;
      const request: AiRequest = {
        tempId: `temp_${draft.clientRequestId}`,
        serverRequestKey,
        body: {
          messages: [
            ...draft.context,
            { role: "user", content: durableMessage.content },
          ],
          coupleId: draft.coupleId,
          senderName: draft.senderName,
          clientRequestId: draft.clientRequestId,
          userMessageId: durableMessage.id,
          visibility: draft.visibility,
          confirmedActionId: draft.confirmedActionId,
        },
      };

      if (mountedRef.current) {
        setMessages((previous) => previous.some((message) => message.id === durableMessage.id)
          ? previous
          : [...previous, durableMessage]
        );
        setActiveInput((current) => current.trim() === draft.text ? "" : current);
      }
      if (!mountedRef.current) return;
      await streamAiRequest(request);
    } catch {
      if (mountedRef.current) {
        setSendFailure({
          kind: "ai_insert",
          message: "질문을 저장하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
        });
        setStreaming(false);
      }
    }
  }

  async function handleRetry() {
    if (!sendFailure || streaming || sendingRef.current) return;
    const failure = sendFailure;
    sendingRef.current = true;
    try {
      if (failure.kind === "partner_insert") {
        setActiveInput(failure.draft.text);
        await sendPartnerDraft(failure.draft, true);
        return;
      }
      if (failure.kind === "ai_insert") {
        setActiveInput(failure.draft.text);
        await sendAiDraft(failure.draft, true);
        return;
      }
      await streamAiRequest(failure.request);
    } finally {
      sendingRef.current = false;
    }
  }

  async function handleSend() {
    const text = input.trim();
    const activeVisibility = chatVisibilityForScope(activeScope, userRole);
    if (
      !text
      || streaming
      || sendingRef.current
      || !coupleId
      || !userId
      || !userRole
      || !activeVisibility
    ) return;
    sendingRef.current = true;
    try {
      setSendFailure(null);
      const startedAt = new Date().toISOString();

      if (target === "partner") {
        if (activeVisibility !== "shared") return;
        await sendPartnerDraft({
          text,
          startedAt,
          coupleId,
          userId,
          senderType: userRole,
          visibility: "shared",
        }, false);
        return;
      }

      const context = messages
        .filter((message) =>
          (!message.id.startsWith("temp_") || Boolean(message.content.trim())) &&
          message.metadata?.target !== "partner" &&
          isMessageInAiContext(message.visibility, activeVisibility)
        )
        .slice(-39)
        .map(({ role, content }) => ({ role, content }));
      await sendAiDraft({
        text,
        clientRequestId: Crypto.randomUUID(),
        startedAt,
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        context,
        visibility: activeVisibility,
      }, false);
    } finally {
      sendingRef.current = false;
    }
  }

  function handleInputChange(value: string) {
    setActiveInput(value);
    setSendFailure((failure) =>
      failure?.kind === "partner_insert" || failure?.kind === "ai_insert"
        ? null
        : failure
    );
  }

  function handleTargetChange(nextTarget: MessageTarget) {
    if (streaming || sendingRef.current || (activeScope === "private" && nextTarget === "partner")) return;
    setTarget(nextTarget);
    setSendFailure((failure) =>
      failure?.kind === "partner_insert" || failure?.kind === "ai_insert"
        ? null
        : failure
    );
  }

  async function handleApplyPendingAction(actionId: string) {
    if (
      streaming
      || sendingRef.current
      || applyingPendingActionRef.current
      || !coupleId
      || !userId
      || !userRole
    ) return;

    const latestSharedMessage = [...messages]
      .reverse()
      .find((message) => message.visibility === "shared");
    const action = latestSharedMessage ? getPendingAmoraAction(latestSharedMessage) : null;
    if (
      !action
      || action.actionId !== actionId
      || getPendingActionDisabledReason(action, Date.now(), true, false) !== null
    ) return;

    sendingRef.current = true;
    applyingPendingActionRef.current = actionId;
    setApplyingPendingActionId(actionId);
    try {
      const context = messages
        .filter((message) => (
          (!message.id.startsWith("temp_") || Boolean(message.content.trim()))
          && message.metadata?.target !== "partner"
          && isMessageInAiContext(message.visibility, "shared")
        ))
        .slice(-39)
        .map(({ role, content }) => ({ role, content }));
      const content = "좋아요. 제안한 변경을 적용해 주세요.";
      await sendAiDraft({
        text: content,
        clientRequestId: Crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        context,
        visibility: "shared",
        confirmedActionId: actionId,
      }, false);
    } finally {
      applyingPendingActionRef.current = null;
      setApplyingPendingActionId(null);
      sendingRef.current = false;
    }
  }

  function handleScopeChange(nextScope: ChatScope) {
    if (streaming || sendingRef.current) return;
    const nextSelection = selectChatScope(
      { scope: activeScope, target },
      nextScope,
      userRole,
    );
    setActiveScope(nextSelection.scope);
    setTarget(nextSelection.target);
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isAi = item.sender_type === "ai";
    const isMe = item.sender_type === userRole;
    const isPartnerMsg = item.metadata?.target === "partner";
    const isBride = item.sender_type === "bride";
    const isThinking = isAi && item.id.startsWith("temp_") && !item.content && streaming;
    const mediationBlock = isAi
      ? normalizeMediationBlock(item.metadata?.mediation)
      : null;
    const pendingActionCandidate = getPendingAmoraAction(item);
    const pendingAction = pendingActionCandidate
      && !dismissedPendingActionIds.has(pendingActionCandidate.actionId)
      ? pendingActionCandidate
      : null;
    const pendingActionDisabledReason: PendingActionDisabledReason = pendingAction
      ? getPendingActionDisabledReason(
          pendingAction,
          nowMs,
          item.id === latestSharedMessageId,
          streaming || applyingPendingActionId !== null,
        )
      : null;
    const bubbleBg = isAi ? colors.surface : isMe ? colors.noir[800] : isBride ? "#F5E6DF" : "#E8EDF5";
    const textColor = isMe ? "#FFF" : colors.noir[800];

    return (
      <View style={[st.msgRow, isMe && st.msgRowRight]}>
        {!isMe && (
          <View style={[st.avatar, isAi ? st.avatarAi : isBride ? st.avatarBride : st.avatarGroom]}>
            {isAi ? <Sparkles size={12} color={colors.gold.DEFAULT} /> : <Text style={st.avatarLetter}>{isBride ? "신부" : "신랑"}</Text>}
          </View>
        )}
        <View style={[
          st.messageBody,
          (mediationBlock || pendingAction) && st.mediationMessageBody,
        ]}>
          {!isMe && <Text style={st.senderLabel}>{isAi ? "아모라" : isBride ? (userRole === "bride" ? userName : partnerName ?? "신부") : (userRole === "groom" ? userName : partnerName ?? "신랑")}{isPartnerMsg ? " ♥" : ""}</Text>}
          {(isThinking || Boolean(item.content.trim())) && (
            <View style={[st.bubble, { backgroundColor: bubbleBg }, !isMe && !isAi && { borderWidth: 1, borderColor: isBride ? "#E8C5B8" : "#C5CEE0" }, isAi && { borderWidth: 1, borderColor: colors.border }, isMe && st.bubbleRight, !isMe && st.bubbleLeft]}>
              {isThinking ? <ThinkingDots /> : <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>{item.content}</Text>}
            </View>
          )}
          {mediationBlock && (
            <AmoraMediationCard
              key={`${item.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}
              block={mediationBlock}
              messageId={item.id}
            />
          )}
          {pendingAction && (
            <View style={st.pendingActionCard}>
              <View style={st.pendingActionHeading}>
                <View style={st.pendingActionIcon} accessibilityElementsHidden>
                  <ShieldCheck size={18} color="#795252" />
                </View>
                <View style={st.pendingActionCopy}>
                  <Text style={st.pendingActionTitle}>적용하기 전에 확인해 주세요</Text>
                  <Text style={st.pendingActionConfirmation}>{pendingAction.confirmation}</Text>
                </View>
              </View>
              {pendingActionDisabledReason && (
                <Text style={st.pendingActionStatus} accessibilityLiveRegion="polite">
                  {pendingActionDisabledReason === "expired"
                    ? "안전을 위해 확인 시간이 지났어요. 아모라에게 다시 제안해 달라고 해주세요."
                    : pendingActionDisabledReason === "not_latest"
                      ? "새 대화가 이어져 이 제안은 적용할 수 없어요. 최신 내용으로 다시 확인해 주세요."
                      : "현재 답변이 끝나면 다시 확인할 수 있어요."}
                </Text>
              )}
              <View style={st.pendingActionControls}>
                <Pressable
                  style={({ pressed }) => [
                    st.pendingActionButton,
                    pressed && !pendingActionDisabledReason && { opacity: 0.82 },
                    pendingActionDisabledReason && st.pendingActionButtonDisabled,
                  ]}
                  onPress={() => handleApplyPendingAction(pendingAction.actionId)}
                  disabled={pendingActionDisabledReason !== null}
                  accessibilityRole="button"
                  accessibilityLabel="확인한 내용을 이대로 적용"
                  accessibilityState={{ disabled: pendingActionDisabledReason !== null }}
                >
                  <Check size={16} color="#FFF" />
                  <Text style={st.pendingActionButtonText}>
                    {applyingPendingActionId === pendingAction.actionId ? "적용 요청 중…" : "이대로 적용"}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [st.pendingActionDismiss, pressed && { opacity: 0.72 }]}
                  onPress={() => setDismissedPendingActionIds((current) => {
                    const next = new Set(current);
                    next.add(pendingAction.actionId);
                    return next;
                  })}
                  disabled={applyingPendingActionId === pendingAction.actionId}
                  accessibilityRole="button"
                  accessibilityLabel="지금은 적용하지 않기"
                  accessibilityState={{ disabled: applyingPendingActionId === pendingAction.actionId }}
                >
                  <X size={16} color={colors.noir.soft} />
                  <Text style={st.pendingActionDismissText}>지금은 적용하지 않기</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

  const isP = activeScope === "shared" && target === "partner";

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>AI 웨딩 플래너</Text></View></View>
        {scopedMessages.length > 0 && <StatusPill label={`${scopedMessages.length}`} tone="neutral" />}
      </View>

      <View style={st.scopeSection} accessibilityLabel="상담 공개 범위">
        <View style={st.scopeRow}>
          <Pressable
            disabled={streaming}
            accessibilityRole="tab"
            accessibilityLabel="함께 대화, 파트너에게 보임"
            accessibilityState={{ selected: activeScope === "shared", disabled: streaming }}
            style={[st.scopeBtn, activeScope === "shared" && st.scopeBtnActive]}
            onPress={() => handleScopeChange("shared")}
          >
            <Sparkles size={14} color={activeScope === "shared" ? colors.rose[500] : colors.textTertiary} />
            <Text style={[st.scopeText, activeScope === "shared" && st.scopeTextActive]}>함께 대화</Text>
          </Pressable>
          <Pressable
            disabled={streaming || userRole === null}
            accessibilityRole="tab"
            accessibilityLabel="나만 상담, 상대방에게 보이지 않음"
            accessibilityState={{ selected: activeScope === "private", disabled: streaming || userRole === null }}
            style={[st.scopeBtn, activeScope === "private" && st.privateScopeBtnActive]}
            onPress={() => handleScopeChange("private")}
          >
            <Lock size={14} color={activeScope === "private" ? "#5a6147" : colors.textTertiary} />
            <Text style={[st.scopeText, activeScope === "private" && st.privateScopeTextActive]}>나만 (상담)</Text>
          </Pressable>
        </View>
        <Text
          style={[st.scopeStatus, activeScope === "private" && st.privateScopeStatus]}
          accessibilityLiveRegion="polite"
        >
          {activeScope === "private"
            ? "현재 범위 · 나만 (상담) — 상대방에게 보이지 않아요"
            : "현재 범위 · 함께 대화 — 파트너에게 보여요"}
        </Text>
      </View>

      {activeScope === "shared" && (
        <View style={st.targetRow}>
          <Pressable disabled={streaming} accessibilityState={{ disabled: streaming }} style={[st.targetBtn, !isP && st.targetActive]} onPress={() => handleTargetChange("ai")}><Sparkles size={14} color={!isP ? colors.gold.DEFAULT : colors.textTertiary} /><Text style={[st.targetText, !isP && st.targetTextActive]}>아모라</Text></Pressable>
          <Pressable disabled={streaming} accessibilityState={{ disabled: streaming }} style={[st.targetBtn, isP && st.targetPartner]} onPress={() => handleTargetChange("partner")}><Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} /><Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너"}</Text></Pressable>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : scopedMessages.length === 0 ? (
          <View style={st.empty}>
            <EmptyState
              icon={
                <IconBadge tone="noir" size={64}>
                  <Sparkles size={28} color={colors.gold.DEFAULT} />
                </IconBadge>
              }
              title={activeScope === "private" ? "나만의 상담을 시작해볼까요?" : "안녕하세요, 아모라예요"}
              description={activeScope === "private"
                ? "이 범위의 대화는 상대방에게 보이지 않아요.\n아모라에게 편하게 이야기해 주세요."
                : "결혼 준비 뭐든 물어보세요.\n파트너에게도 메시지를 보낼 수 있어요."}
            />
            <View style={st.suggestions}>{["스드메 평균 가격이 얼마야?", "결혼 준비 체크리스트 알려줘", "웨딩홀 고를 때 주의할 점은?"].map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => { handleTargetChange("ai"); handleInputChange(q); }}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        {quotaRemaining !== null && !streaming && (
          <View style={st.quotaBar} accessibilityLiveRegion="polite">
            <Text style={st.quotaText}>
              {quotaRemaining > 0
                ? `베타 무료 상담이 ${quotaRemaining}회 남았어요.`
                : "베타 무료 상담을 모두 사용했어요."}
            </Text>
            <Pressable
              style={({ pressed }) => [st.quotaDismiss, pressed && { opacity: 0.62 }]}
              onPress={() => setQuotaRemaining(null)}
              accessibilityRole="button"
              accessibilityLabel="사용량 안내 닫기"
            >
              <X size={17} color={colors.taupe[500]} />
            </Pressable>
          </View>
        )}

        {activeSendFailure && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {activeSendFailure.message}
            </Text>
            <Pressable
              style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
              onPress={handleRetry}
              disabled={streaming}
              accessibilityRole="button"
              accessibilityLabel={activeSendFailure.kind === "ai_response" ? "아모라 답변 다시 받기" : "메시지 다시 보내기"}
            >
              <Text style={st.retryText}>
                {activeSendFailure.kind === "ai_response" ? "답변 다시 받기" : "다시 보내기"}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput style={st.input} value={input} onChangeText={handleInputChange} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : activeScope === "private" ? "나만의 상담을 입력하세요..." : "메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming} returnKeyType="send" accessibilityLabel="메시지 입력" />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            <Pressable style={[st.sendBtn, isP && { backgroundColor: colors.rose[500] }, (!input.trim() || streaming) && st.sendBtnOff]} onPress={handleSend} onPressIn={pressIn} onPressOut={pressOut} disabled={!input.trim() || streaming} accessibilityLabel="메시지 보내기" accessibilityRole="button">
              {isP ? <Heart size={18} color="#FFF" /> : <Send size={18} color="#FFF" />}
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
  scopeSection: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  scopeRow: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: colors.ivory.warm },
  scopeBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10 },
  scopeBtnActive: { backgroundColor: colors.surface },
  privateScopeBtnActive: { backgroundColor: colors.surface },
  scopeText: { fontSize: 13, color: colors.textTertiary, fontWeight: "500" },
  scopeTextActive: { color: colors.rose[500], fontWeight: "600" },
  privateScopeTextActive: { color: "#5a6147", fontWeight: "600" },
  scopeStatus: { paddingHorizontal: 4, paddingTop: 6, fontSize: 11, lineHeight: 16, color: colors.rose[500] },
  privateScopeStatus: { color: "#5a6147" },
  targetRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  targetBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  targetActive: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPartner: { borderBottomWidth: 2, borderBottomColor: colors.rose[500] },
  targetText: { fontSize: 14, color: colors.textTertiary },
  targetTextActive: { color: colors.noir[800], fontWeight: "600" },
  targetTextPartner: { color: colors.rose[500], fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13, color: colors.textTertiary },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sugText: { fontSize: 14, color: colors.noir[800] },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  messageBody: { maxWidth: "78%" },
  mediationMessageBody: { maxWidth: "92%", flex: 1 },
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
  pendingActionCard: { width: "100%", marginTop: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: "#FFFCF8" },
  pendingActionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  pendingActionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#F2E8DE" },
  pendingActionCopy: { flex: 1 },
  pendingActionTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  pendingActionConfirmation: { marginTop: 4, fontSize: 14, lineHeight: 21, color: colors.noir.soft },
  pendingActionStatus: { marginTop: 10, fontSize: 12, lineHeight: 18, color: "#795252" },
  pendingActionControls: { marginTop: 12, gap: 8 },
  pendingActionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#2F5F51" },
  pendingActionButtonDisabled: { backgroundColor: colors.taupe[400] },
  pendingActionButtonText: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  pendingActionDismiss: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: colors.surface },
  pendingActionDismissText: { fontSize: 14, fontWeight: "600", color: colors.noir.soft },
  quotaBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.border },
  quotaText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.noir.soft },
  quotaDismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  failureBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.rose.light },
  failureText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.noir.soft },
  retryBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.noir[800] },
  retryText: { fontSize: 14, fontWeight: "600", color: colors.surface },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.noir[800], backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
});
