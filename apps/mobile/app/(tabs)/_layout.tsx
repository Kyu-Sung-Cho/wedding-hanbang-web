import { Tabs } from "expo-router";
import { Home, MessageCircle, Users, User } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.rose[500],
        tabBarInactiveTintColor: colors.taupe[400],
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          height: 86,
          paddingTop: 10,
          paddingBottom: 24,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.06,
          shadowRadius: 24,
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "NotoSansKR_500Medium",
        },
        tabBarItemStyle: {
          borderRadius: 18,
          marginHorizontal: 3,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "홈",
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          tabBarAccessibilityLabel: "홈",
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "아모라",
          tabBarIcon: ({ color, size }) => <MessageCircle size={size} color={color} />,
          tabBarAccessibilityLabel: "아모라",
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "커뮤니티",
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
          tabBarAccessibilityLabel: "커뮤니티",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "내 정보",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
          tabBarAccessibilityLabel: "내 정보",
        }}
      />
    </Tabs>
  );
}
