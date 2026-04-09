// 로그인 화면 (Phase 0 — UI 껍데기만)
// Phase 1 에서 카카오 OAuth (expo-auth-session) 연결

import { View, Text, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";

export default function LoginScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 justify-between py-8">
        {/* 상단 — 브랜드 */}
        <View className="flex-1 items-center justify-center">
          <View className="w-20 h-20 rounded-3xl bg-noir-800 items-center justify-center mb-8">
            <Sparkles size={36} color="#C9A96E" />
          </View>
          <Text className="text-4xl text-noir-800 mb-3" style={{ fontFamily: "serif" }}>
            웨딩한방
          </Text>
          <Text className="text-base text-textSecondary text-center leading-6">
            AI 웨딩 플래너와 함께{"\n"}완벽한 결혼을 준비하세요
          </Text>
        </View>

        {/* 하단 — 로그인 버튼 */}
        <View className="gap-3">
          <Pressable
            className="w-full h-14 rounded-2xl bg-[#FEE500] items-center justify-center active:opacity-80"
            onPress={() => {
              // TODO: Phase 1 — 카카오 OAuth
              console.log("Kakao login");
            }}
          >
            <Text className="text-base font-semibold text-[#191919]">
              카카오로 계속하기
            </Text>
          </Pressable>

          <Pressable
            className="w-full h-14 rounded-2xl bg-white border border-border items-center justify-center active:opacity-80"
            onPress={() => {
              // TODO: Phase 1 — 애플 로그인 (iOS 심사 필수)
              console.log("Apple login");
            }}
          >
            <Text className="text-base font-semibold text-textPrimary">
              Apple로 계속하기
            </Text>
          </Pressable>

          <Text className="text-xs text-textTertiary text-center mt-4 leading-5">
            계속하면 이용약관과 개인정보처리방침에{"\n"}동의하는 것으로 간주됩니다
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
