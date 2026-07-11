// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 신부=분홍(#F5E6DF), 신랑=파랑(#E8EDF5), AI=noir
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Send, Sparkles, Heart, LockKeyhole } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";
import {
  chatVisibilityForMobileTarget,
  isMessageAllowedInAiContext,
  isMessageVisibleForMobileTarget,
  normalizeChatVisibility,
  parseChatSse,
  type ChatVisibility,
  type MobileChatTarget,
} from "@hanbang/shared";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: { target?: string } | null;
  visibility: ChatVisibility;
  created_at?: string;
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
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"bride" | "groom">("bride");
  const [userName, setUserName] = useState("사용자");
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [target, setTarget] = useState<MobileChatTarget>("ai_shared");
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const previousMessageCountRef = useRef(0);
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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setInitialLoaded(true); return; }
      setUserId(user.id);

      const { data: profile } = await supabase.from("profiles").select("name, role, couple_id").eq("id", user.id).single();
      if (!profile?.couple_id) { setInitialLoaded(true); return; }
      setCoupleId(profile.couple_id);
      if (profile.name) setUserName(profile.name);
      if (profile.role) setUserRole(profile.role as "bride" | "groom");

      // 파트너
      const { data: partners } = await supabase.rpc("get_my_partner_public");
      if (partners?.[0]) setPartnerName(partners?.[0]?.name ?? "");

      // 대화 이력
      const { data: history } = await supabase.from("chat_messages")
        .select("id, role, sender_type, content, metadata, visibility, created_at")
        .eq("couple_id", profile.couple_id).order("created_at", { ascending: true }).limit(200);

      if (history?.length) {
        setMessages(history.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", sender_type: m.sender_type as "bride" | "groom" | "ai", content: m.content, metadata: m.metadata as ChatMessage["metadata"], visibility: normalizeChatVisibility(m.visibility), created_at: m.created_at })));
      }

      // Realtime
      const ch = supabase.channel(`chat:${profile.couple_id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          const n = payload.new as Record<string, unknown>;
          setMessages((prev) => {
            if (prev.some((m) => m.id === n.id)) return prev;
            return [...prev.filter((m) => !m.id.toString().startsWith("temp_")), {
              id: n.id as string, role: n.role as "user" | "assistant", sender_type: n.sender_type as "bride" | "groom" | "ai",
              content: n.content as string, metadata: n.metadata as ChatMessage["metadata"], visibility: normalizeChatVisibility(n.visibility), created_at: n.created_at as string,
            }];
          });
        }).subscribe();
      channelRef.current = ch;
      setInitialLoaded(true);
    })();
    return () => { if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; } };
  }, []);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || !coupleId || !userId) return;

    if (target === "partner") {
      const response = await apiFetch("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ coupleId, content: text, target: "partner", visibility: "shared" }),
      });
      if (!response.ok) return;
      setInput("");
      return;
    }

    // AI
    const persistResponse = await apiFetch("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ coupleId, content: text, visibility: activeVisibility }),
    });
    const persistPayload = await persistResponse.json().catch(() => ({}));
    if (!persistResponse.ok || !persistPayload.message) return;
    const ui = persistPayload.message as ChatMessage;
    const userMsg: ChatMessage = { ...ui, role: "user", sender_type: userRole, visibility: activeVisibility };
    const tempId = `temp_${Date.now()}`;
    setMessages((p) => [...p, userMsg, { id: tempId, role: "assistant", sender_type: "ai", content: "", visibility: activeVisibility }]);
    setInput(""); setStreaming(true); scrollToLatest(true);

    try {
      const recentContext = [...messages, userMsg]
        .filter((message) => isMessageAllowedInAiContext(message, activeVisibility))
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: recentContext,
          coupleId,
          senderName: userName,
          visibility: activeVisibility,
          clientRequestId: `mobile:${userMsg.id}`.slice(0, 120),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "채팅 오류");
      const raw = await res.text();
      const parsed = parseChatSse(raw);
      if (parsed.error) throw new Error(parsed.error);
      if (!parsed.completed) throw new Error("AI 응답이 완료되지 않았어요. 다시 시도해주세요.");
      const full = parsed.content;
      const clean = full.replace(/\[suggestions\][\s\S]*?\[\/suggestions\]/g, "").trim() || full || "응답을 받지 못했어요.";
      setMessages((p) => p.map((m) => m.id === tempId ? { ...m, content: clean } : m));
      scrollToLatest(true);
    } catch (err) {
      setMessages((p) => p.map((m) => m.id === tempId ? { ...m, content: `오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}` } : m));
    } finally { setStreaming(false); }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isAi = item.sender_type === "ai";
    const isMe = item.sender_type === userRole;
    const isPartnerMsg = item.metadata?.target === "partner";
    const isBride = item.sender_type === "bride";
    const isThinking = isAi && !item.content && streaming;
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
            {isThinking ? <ThinkingDots /> : <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>{item.content}</Text>}
          </View>
        </View>
      </View>
    );
  }

  const isP = target === "partner";
  const isPrivate = target === "ai_private";

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>AI 웨딩 플래너</Text></View></View>
        {visibleMessages.length > 0 && <StatusPill label={`${visibleMessages.length}`} tone="neutral" />}
      </View>

      <View style={st.targetRow}>
        <Pressable style={[st.targetBtn, target === "ai_shared" && st.targetActive]} onPress={() => setTarget("ai_shared")} accessibilityRole="tab" accessibilityLabel="커플이 함께 보는 아모라 대화" accessibilityState={{ selected: target === "ai_shared" }}><Sparkles size={14} color={target === "ai_shared" ? colors.gold.DEFAULT : colors.textTertiary} /><Text style={[st.targetText, target === "ai_shared" && st.targetTextActive]}>함께</Text></Pressable>
        <Pressable style={[st.targetBtn, isPrivate && st.targetPrivate]} onPress={() => setTarget("ai_private")} accessibilityRole="tab" accessibilityLabel="나만 보는 아모라 비공개 대화" accessibilityState={{ selected: isPrivate }}><LockKeyhole size={14} color={isPrivate ? colors.noir[800] : colors.textTertiary} /><Text style={[st.targetText, isPrivate && st.targetTextPrivate]}>나만</Text></Pressable>
        <Pressable style={[st.targetBtn, isP && st.targetPartner]} onPress={() => setTarget("partner")} accessibilityRole="tab" accessibilityState={{ selected: isP }}><Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} /><Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너"}</Text></Pressable>
      </View>

      {!isP && (
        <Pressable
          style={st.aiNotice}
          onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai"}/ai-policy`)}
          accessibilityRole="link"
          accessibilityLabel="AI 생성 안내와 AI 정책 열기"
        >
          <Sparkles size={12} color={colors.gold.DEFAULT} />
          <Text style={st.aiNoticeText}>AI 생성 · {isPrivate ? "나만 보는 대화" : "커플이 함께 보는 대화"} · AI 정책</Text>
        </Pressable>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
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
                  : "이 대화는 커플이 함께 볼 수 있어요.\n결혼 준비를 무엇이든 물어보세요."}
            />
            {!isP && <View style={st.suggestions}>{["스드메 평균 가격이 얼마야?", "결혼 준비 체크리스트 알려줘", "웨딩홀 고를 때 주의할 점은?"].map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => setInput(q)}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>}
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput style={st.input} value={input} onChangeText={setInput} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : isPrivate ? "나만의 고민을 입력하세요..." : "함께 볼 메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming} returnKeyType="send" accessibilityLabel="메시지 입력" />
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
  targetRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  targetBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11 },
  targetActive: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPrivate: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPartner: { borderBottomWidth: 2, borderBottomColor: colors.rose[500] },
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
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.noir[800], backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
});
