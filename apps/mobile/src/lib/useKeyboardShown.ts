import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * 화면 키보드가 떠 있는가. 떠 있는 하단 메뉴(청첩장 디자인 2026-11-17)는 화면 위에 겹쳐 그려진다.
 * 안드로이드는 키보드가 뜨면 창이 줄어 메뉴가 키보드 위로 올라와 입력칸을 가리므로, 키보드가 떠 있는
 * 동안에는 메뉴를 숨기고 입력칸 아래 여백도 거둔다. iOS 는 키보드가 뜨기 직전 알림을 쓴다.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setShown(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setShown(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);
  return shown;
}
