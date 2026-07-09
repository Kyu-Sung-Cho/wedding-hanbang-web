// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 신부=분홍(#F5E6DF), 신랑=파랑(#E8EDF5), AI=noir
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Send, Sparkles, Heart } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: { target?: string } | null;
  created_at?: string;
}

type MessageTarget = "ai" | "partner";

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
  const [target, setTarget] = useState<MessageTarget>("ai");
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const previousMessageCountRef = useRef(0);
  const visibleMessages = useMemo(() => [...messages].reverse(), [messages]);

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
      const { data: partners } = await supabase.from("profiles").select("name").eq("couple_id", profile.couple_id).neq("id", user.id);
      if (partners?.[0]) setPartnerName(partners?.[0]?.name ?? "");

      // 대화 이력
      const { data: history } = await supabase.from("chat_messages")
        .select("id, role, sender_type, content, metadata, created_at")
        .eq("couple_id", profile.couple_id).order("created_at", { ascending: true }).limit(200);

      if (history?.length) {
        setMessages(history.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", sender_type: m.sender_type as "bride" | "groom" | "ai", content: m.content, metadata: m.metadata as ChatMessage["metadata"], created_at: m.created_at })));
      }

      // Realtime
      const ch = supabase.channel(`chat:${profile.couple_id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          const n = payload.new as Record<string, unknown>;
          setMessages((prev) => {
            if (prev.some((m) => m.id === n.id)) return prev;
            return [...prev.filter((m) => !m.id.toString().startsWith("temp_")), {
              id: n.id as string, role: n.role as "user" | "assistant", sender_type: n.sender_type as "bride" | "groom" | "ai",
              content: n.content as string, metadata: n.metadata as ChatMessage["metadata"], created_at: n.created_at as string,
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
  }, [initialLoaded, messages.length, scrollToLatest]);

  function pressIn() { Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start(); }
  function pressOut() { Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start(); }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || !coupleId || !userId) return;

    if (target === "partner") {
      await supabase.from("chat_messages").insert({ couple_id: coupleId, sender_id: userId, sender_type: userRole, role: "user", content: text, metadata: { target: "partner" } });
      setInput(""); return;
    }

    // AI
    const { data: ui } = await supabase.from("chat_messages").insert({ couple_id: coupleId, sender_id: userId, sender_type: userRole, role: "user", content: text }).select("id, role, sender_type, content, created_at").single();
    const userMsg: ChatMessage = ui ? { ...ui, role: "user", sender_type: userRole } : { id: Date.now().toString(), role: "user", sender_type: userRole, content: text };
    const tempId = `temp_${Date.now()}`;
    setMessages((p) => [...p, userMsg, { id: tempId, role: "assistant", sender_type: "ai", content: "" }]);
    setInput(""); setStreaming(true); scrollToLatest(true);

    try {
      const res = await apiFetch("/api/chat", { method: "POST", body: JSON.stringify({ messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })), coupleId, senderName: userName }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "채팅 오류");
      const raw = await res.text();
      let full = "";
      for (const line of raw.split("\n")) { if (!line.startsWith("data: ")) continue; const j = line.slice(6).trim(); if (j === "[DONE]" || !j) continue; try { const p = JSON.parse(j); if (p.type === "content_block_delta" && p.delta?.text) full += p.delta.text; else if (p.text) full += p.text; else if (p.chunk) full += p.chunk; } catch { if (j) full += j; } }
      if (!full && raw) { try { const json = JSON.parse(raw); full = json.text || json.content || raw; } catch { full = raw; } }
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

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>AI 웨딩 플래너</Text></View></View>
        {messages.length > 0 && <StatusPill label={`${messages.length}`} tone="neutral" />}
      </View>

      <View style={st.targetRow}>
        <Pressable style={[st.targetBtn, !isP && st.targetActive]} onPress={() => setTarget("ai")}><Sparkles size={14} color={!isP ? colors.gold.DEFAULT : colors.textTertiary} /><Text style={[st.targetText, !isP && st.targetTextActive]}>아모라</Text></Pressable>
        <Pressable style={[st.targetBtn, isP && st.targetPartner]} onPress={() => setTarget("partner")}><Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} /><Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너"}</Text></Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={st.empty}>
            <EmptyState
              icon={
                <IconBadge tone="noir" size={64}>
                  <Sparkles size={28} color={colors.gold.DEFAULT} />
                </IconBadge>
              }
              title="안녕하세요, 아모라예요"
              description={"결혼 준비 뭐든 물어보세요.\n파트너에게도 메시지를 보낼 수 있어요."}
            />
            <View style={st.suggestions}>{["스드메 평균 가격이 얼마야?", "결혼 준비 체크리스트 알려줘", "웨딩홀 고를 때 주의할 점은?"].map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => { setTarget("ai"); setInput(q); }}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput style={st.input} value={input} onChangeText={setInput} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : "메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming} returnKeyType="send" accessibilityLabel="메시지 입력" />
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
  targetBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  targetActive: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPartner: { borderBottomWidth: 2, borderBottomColor: colors.rose[500] },
  targetText: { fontSize: 14, color: colors.textTertiary },
  targetTextActive: { color: colors.noir[800], fontWeight: "600" },
  targetTextPartner: { color: colors.rose[500], fontWeight: "600" },
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
  sendBtn: { width: 40, height: 40, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
});
