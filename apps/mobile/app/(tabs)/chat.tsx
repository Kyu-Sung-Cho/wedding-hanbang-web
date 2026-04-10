// AI 채팅 (아모라) — 웹과 동일한 chat_messages 테이블 연동
import { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Send, Sparkles } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

// 타이핑 점 애니메이션
function ThinkingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    function animateDot(dot: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      );
    }
    const a1 = animateDot(dot1, 0);
    const a2 = animateDot(dot2, 200);
    const a3 = animateDot(dot3, 400);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={thinkingStyles.container}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={[thinkingStyles.dot, {
          opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
        }]} />
      ))}
    </View>
  );
}

const thinkingStyles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.textTertiary },
});

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("bride");
  const [userName, setUserName] = useState<string>("사용자");
  const [initialLoaded, setInitialLoaded] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;

  // 유저 프로필 + coupleId + 기존 메시지 로드
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, role, couple_id")
        .eq("id", user.id)
        .single();

      if (profile) {
        setCoupleId(profile.couple_id);
        if (profile.name) setUserName(profile.name);
        if (profile.role) setUserRole(profile.role);
      }

      // 기존 대화 불러오기 (웹과 동일한 chat_messages 테이블)
      if (profile?.couple_id) {
        const { data: chatHistory } = await supabase
          .from("chat_messages")
          .select("id, role, content, created_at")
          .eq("couple_id", profile.couple_id)
          .order("created_at", { ascending: true })
          .limit(200);

        if (chatHistory && chatHistory.length > 0) {
          setMessages(chatHistory.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            created_at: m.created_at,
          })));
        }
      }

      setInitialLoaded(true);
    })();
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 100);
  }, []);

  useEffect(() => {
    if (initialLoaded && messages.length > 0) scrollToEnd();
  }, [initialLoaded, messages.length, scrollToEnd]);

  function handleSendPressIn() {
    Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start();
  }
  function handleSendPressOut() {
    Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start();
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!coupleId || !userId) {
      Alert.alert("알림", "프로필 설정이 필요해요. 온보딩을 먼저 완료해주세요.");
      return;
    }

    // 1. 유저 메시지를 DB에 저장 (웹과 동일)
    const { data: userInserted } = await supabase
      .from("chat_messages")
      .insert({
        couple_id: coupleId,
        sender_id: userId,
        sender_type: userRole,
        role: "user",
        content: text,
      })
      .select("id, role, content, created_at")
      .single();

    const userMsg: ChatMessage = userInserted
      ? { id: userInserted.id, role: "user", content: text, created_at: userInserted.created_at }
      : { id: Date.now().toString(), role: "user", content: text };

    // 임시 AI 메시지 (로딩 표시용)
    const tempAiId = `temp_${Date.now()}`;
    const aiMsg: ChatMessage = { id: tempAiId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
    setStreaming(true);
    scrollToEnd();

    try {
      // 2. 웹 API 호출 (Bearer 토큰)
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: apiMessages,
          coupleId,
          senderName: userName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "채팅 오류가 발생했어요");
      }

      // 3. 응답 읽기 (RN은 스트리밍 불가 → 전체 텍스트)
      const rawText = await res.text();
      let fullText = "";

      const lines = rawText.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) fullText += parsed.delta.text;
          else if (parsed.text) fullText += parsed.text;
          else if (parsed.chunk) fullText += parsed.chunk;
        } catch {
          if (jsonStr) fullText += jsonStr;
        }
      }

      if (!fullText && rawText) {
        try {
          const json = JSON.parse(rawText);
          fullText = json.text || json.content || json.message || rawText;
        } catch {
          fullText = rawText;
        }
      }

      const cleanText = fullText.replace(/\[suggestions\][\s\S]*?\[\/suggestions\]/g, "").trim();
      const finalContent = cleanText || fullText || "응답을 받지 못했어요.";

      // 4. AI 응답을 DB에 저장 (웹과 동일)
      const { data: aiInserted } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: finalContent,
        })
        .select("id, role, content, created_at")
        .single();

      // 임시 메시지를 실제 DB 메시지로 교체
      setMessages((prev) => prev.map((m) =>
        m.id === tempAiId
          ? (aiInserted
            ? { id: aiInserted.id, role: "assistant", content: finalContent, created_at: aiInserted.created_at }
            : { ...m, content: finalContent })
          : m
      ));
      scrollToEnd();

    } catch (err) {
      const message = err instanceof Error ? err.message : "채팅 중 오류가 발생했어요";
      setMessages((prev) => prev.map((m) =>
        m.id === tempAiId ? { ...m, content: `오류: ${message}` } : m
      ));
    } finally {
      setStreaming(false);
    }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    const isThinking = !isUser && !item.content && streaming;

    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={styles.aiAvatar}>
            <Sparkles size={14} color={colors.gold.DEFAULT} />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
          {isThinking ? (
            <ThinkingDots />
          ) : (
            <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAi]}>
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Sparkles size={16} color={colors.gold.DEFAULT} />
        </View>
        <View>
          <Text style={styles.headerTitle}>아모라</Text>
          <Text style={styles.headerSub}>AI 웨딩 플래너</Text>
        </View>
        {messages.length > 0 && (
          <Text style={styles.msgCount}>{messages.length}개의 대화</Text>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {messages.length === 0 && initialLoaded ? (
          <View style={styles.empty}>
            <View style={styles.emptyDecoTop} />
            <View style={styles.emptyDecoBottom} />
            <View style={styles.emptyLogo}>
              <Sparkles size={28} color={colors.gold.DEFAULT} />
            </View>
            <Text style={styles.emptyTitle}>안녕하세요, 아모라예요</Text>
            <Text style={styles.emptyDesc}>
              결혼 준비 뭐든 물어보세요.{"\n"}가격, 일정, 업체, 예절... 다 도와드릴게요.
            </Text>
            <View style={styles.suggestions}>
              {["스드메 평균 가격이 얼마야?", "결혼 준비 체크리스트 알려줘", "웨딩홀 고를 때 주의할 점은?"].map((q) => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [styles.sugBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }], borderColor: colors.rose[500] }]}
                  onPress={() => setInput(q)}
                >
                  <Text style={styles.sugText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={scrollToEnd}
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="메시지를 입력하세요..."
            placeholderTextColor={colors.taupe[400]}
            multiline
            maxLength={4000}
            editable={!streaming}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            <Pressable
              style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnDisabled]}
              onPress={handleSend}
              onPressIn={handleSendPressIn}
              onPressOut={handleSendPressOut}
              disabled={!input.trim() || streaming}
            >
              <Send size={18} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  headerLogo: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: colors.noir[800],
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  headerSub: { fontSize: 11, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary, marginTop: -1 },
  msgCount: { marginLeft: "auto", fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },

  empty: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, position: "relative", overflow: "hidden",
  },
  emptyDecoTop: { position: "absolute", top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: colors.rose.glow },
  emptyDecoBottom: { position: "absolute", bottom: -40, left: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: colors.ivory[200], opacity: 0.6 },
  emptyLogo: {
    width: 64, height: 64, borderRadius: 22, backgroundColor: colors.noir[800],
    alignItems: "center", justifyContent: "center", marginBottom: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  emptyTitle: { fontSize: 22, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800], marginBottom: 8 },
  emptyDesc: { fontSize: 14, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 28 },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: {
    paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1,
  },
  sugText: { fontSize: 14, fontFamily: "NotoSansKR_400Regular", color: colors.noir[800] },

  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgRowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  aiAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.noir[800],
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  bubble: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, maxWidth: "100%" },
  bubbleAi: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: colors.noir[800], borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, fontFamily: "NotoSansKR_400Regular", color: colors.noir[800] },
  bubbleTextAi: { lineHeight: 24 },
  bubbleTextUser: { color: "#FFFFFF", lineHeight: 22 },

  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, fontFamily: "NotoSansKR_400Regular", color: colors.noir[800],
    backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 16, backgroundColor: colors.rose[500],
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: colors.taupe[400] },
});
