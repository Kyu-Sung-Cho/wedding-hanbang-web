import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Users } from "lucide-react-native";

export default function CommunityScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-16 h-16 rounded-3xl bg-ivory-200 items-center justify-center mb-6">
          <Users size={28} color="#C4967E" />
        </View>
        <Text className="text-2xl text-noir-800 mb-2" style={{ fontFamily: "serif" }}>
          커뮤니티
        </Text>
        <Text className="text-sm text-textSecondary text-center leading-6">
          동기방과 게시판이 여기에 열려요{"\n"}Phase 2 예정
        </Text>
      </View>
    </SafeAreaView>
  );
}
