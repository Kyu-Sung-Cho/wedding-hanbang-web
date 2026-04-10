// AI 채팅 (아모라) — Claude 스트리밍
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
  Alert,
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
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("사용자");
  const flatListRef = useRef<FlatList>(null);

  // 유저 프로필 + coupleId 로드
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, couple_id")
        .eq("id", user.id)
        .single();

      if (profile) {
        setCoupleId(profile.couple_id);
        if (profile.name) setUserName(profile.name);
      }
    })();
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!coupleId) {
      Alert.alert("알림", "프로필 설정이 필요해요. 웹에서 온보딩을 먼저 완료해주세요.");
      return;
    }

    // 유저 메시지 추가
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);
    scrollToEnd();

    try {
      // 웹 API 호출 (Bearer 토큰 인증)
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
        throw new Error(err.error || "채팅 오류");
      }

      // React Native은 ReadableStream 미지원 → 전체 텍스트로 읽기
      const rawText = await res.text();

      // SSE 형식에서 텍스트 추출
      let fullText = "";
      const lines = rawText.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            fullText += parsed.delta.text;
          } else if (parsed.text) {
            fullText += parsed.text;
          } else if (parsed.chunk) {
            fullText += parsed.chunk;
          }
        } catch {
          // JSON 아닌 경우 직접 추가
          if (jsonStr) fullText += jsonStr;
        }
      }

      // SSE가 아닌 일반 JSON 응답인 경우
      if (!fullText && rawText) {
        try {
          const json = JSON.parse(rawText);
          fullText = json.text || json.content || json.message || rawText;
        } catch {
          fullText = rawText;
        }
      }

      // [suggestions] 블록 제거
      const cleanText = fullText.replace(/\[suggestions\][\s\S]*?\[\/suggestions\]/g, "").trim();

      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "assistant") {
          updated[lastIdx] = { ...updated[lastIdx], content: cleanText || fullText || "응답을 받지 못했어요." };
        }
        return updated;
      });
      scrollToEnd();
    } catch (err) {
      const message = err instanceof Error ? err.message : "채팅 중 오류 발생";
      // 에러 시 어시스턴트 메시지에 에러 표시
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "assistant") {
          updated[lastIdx] = { ...updated[lastIdx], content: `오류: ${message}` };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={styles.aiAvatar}>
            <Sparkles size={16} color={colors.gold.DEFAULT} />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
            {item.content || (streaming ? "..." : "")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Sparkles size={18} color={colors.gold.DEFAULT} />
        </View>
        <Text style={styles.headerTitle}>아모라</Text>
        <Text style={styles.headerSub}>AI 웨딩 플래너</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* 메시지 영역 */}
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyLogo}>
              <Sparkles size={32} color={colors.gold.DEFAULT} />
            </View>
            <Text style={styles.emptyTitle}>안녕하세요, 아모라예요</Text>
            <Text style={styles.emptyDesc}>
              결혼 준비 뭐든 물어보세요.{"\n"}가격, 일정, 업체, 예절... 다 도와드릴게요.
            </Text>

            {/* 추천 질문 */}
            <View style={styles.suggestions}>
              {[
                "스드메 평균 가격이 얼마야?",
                "결혼 준비 체크리스트 알려줘",
                "웨딩홀 고를 때 주의할 점은?",
              ].map((q) => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [styles.sugBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    setInput(q);
                  }}
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

        {/* 입력창 */}
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
          <Pressable
            style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || streaming}
          >
            {streaming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Send size={20} color="#FFFFFF" />
            )}
          </Pressable>
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
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
  },
  headerSub: {
    fontSize: 12,
    color: colors.textTertiary,
    marginLeft: "auto",
  },

  // 빈 상태
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyLogo: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "500",
    color: colors.noir[800],
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sugText: { fontSize: 14, color: colors.noir[800] },

  // 메시지 리스트
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },

  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgRowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },

  aiAvatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },

  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: "100%",
  },
  bubbleAi: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: colors.noir[800],
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.noir[800],
  },
  bubbleTextUser: {
    color: "#FFFFFF",
  },

  // 입력창
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.noir[800],
    backgroundColor: colors.bg,
    borderRadius: 20,
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
  sendBtnDisabled: {
    backgroundColor: colors.taupe[400],
  },
});
