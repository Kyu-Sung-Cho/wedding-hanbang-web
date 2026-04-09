import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DashboardScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
        <Text className="text-sm text-textSecondary mb-1">오늘</Text>
        <Text className="text-3xl text-noir-800 mb-6" style={{ fontFamily: "serif" }}>
          웨딩한방
        </Text>

        {/* D-day 카드 */}
        <View className="bg-noir-800 rounded-3xl p-6 mb-4">
          <Text className="text-xs text-taupe-400 mb-2">결혼까지</Text>
          <Text className="text-5xl text-white mb-1" style={{ fontFamily: "serif" }}>
            D-—
          </Text>
          <Text className="text-sm text-taupe-400">결혼 예정일을 설정해보세요</Text>
        </View>

        {/* 진행률 */}
        <View className="bg-surface border border-border rounded-3xl p-6 mb-4">
          <Text className="text-sm text-textSecondary mb-2">전체 진행률</Text>
          <Text className="text-3xl text-noir-800 mb-3" style={{ fontFamily: "serif" }}>
            0%
          </Text>
          <View className="h-2 bg-ivory-200 rounded-full overflow-hidden">
            <View className="h-full bg-rose-500 rounded-full" style={{ width: "0%" }} />
          </View>
        </View>

        {/* 오늘의 할 일 */}
        <View className="bg-surface border border-border rounded-3xl p-6">
          <Text className="text-base font-semibold text-noir-800 mb-4">오늘의 할 일</Text>
          <Text className="text-sm text-textTertiary">
            아직 등록된 할 일이 없어요
          </Text>
        </View>

        {/* Phase 0 알림 */}
        <View className="bg-rose-pale rounded-2xl p-4 mt-6">
          <Text className="text-xs text-rose-600 font-semibold mb-1">Phase 0 · 앱 뼈대</Text>
          <Text className="text-xs text-noir-800 leading-5">
            웨딩한방 모바일 앱이 성공적으로 실행되고 있어요. 다음 단계에서 카카오 로그인, AI 채팅, 커뮤니티가 추가됩니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
