// 빈 공간 탭 시 키보드 닫기 래퍼
import { Keyboard, TouchableWithoutFeedback, View } from "react-native";

export default function DismissKeyboard({ children }: { children: React.ReactNode }) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
