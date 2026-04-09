import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

export default function ProfileScreen() {
  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="flex-1 px-5 pt-6">
        <Text className="text-3xl text-noir-800 mb-8" style={{ fontFamily: "serif" }}>
          내 정보
        </Text>

        <View className="bg-surface border border-border rounded-3xl p-6 mb-4">
          <View className="flex-row items-center gap-4">
            <View className="w-14 h-14 rounded-full bg-ivory-200 items-center justify-center">
              <Text className="text-xl text-noir-800" style={{ fontFamily: "serif" }}>
                웨
              </Text>
            </View>
            <View>
              <Text className="text-base font-semibold text-noir-800">게스트</Text>
              <Text className="text-xs text-textTertiary">로그인이 필요해요</Text>
            </View>
          </View>
        </View>

        <Pressable
          className="bg-surface border border-border rounded-2xl p-4 mb-3 active:bg-ivory-100"
          onPress={handleLogout}
        >
          <Text className="text-sm text-noir-800">로그아웃</Text>
        </Pressable>

        <Text className="text-xs text-textTertiary text-center mt-auto mb-4">
          웨딩한방 v1.0.0 · Phase 0
        </Text>
      </View>
    </SafeAreaView>
  );
}
