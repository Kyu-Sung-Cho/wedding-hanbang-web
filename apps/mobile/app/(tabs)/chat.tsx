import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";

export default function ChatScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-16 h-16 rounded-3xl bg-noir-800 items-center justify-center mb-6">
          <Sparkles size={28} color="#C9A96E" />
        </View>
        <Text className="text-2xl text-noir-800 mb-2" style={{ fontFamily: "serif" }}>
          아모라
        </Text>
        <Text className="text-sm text-textSecondary text-center leading-6">
          AI 웨딩 플래너와 대화하세요{"\n"}Phase 1에서 스트리밍 채팅이 열려요
        </Text>
      </View>
    </SafeAreaView>
  );
}
