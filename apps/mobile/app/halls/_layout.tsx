import { Stack } from "expo-router";
import { invitationPalette } from "@hanbang/design-tokens";

/**
 * 웨딩홀 비교 → 보내기 전 편지 확인(아래에서 올라오는 시트) → 답장과 상담 확정
 * (2026-11-17 파운더 디자인 아티팩트 `Compare.dc`·`Approve.dc`·`Status.dc`). 로그인한 커플의 실제 화면이다.
 * 예시 커플의 같은 흐름은 `app/example/**` 에 있다(서버를 부르지 않는다).
 */
export default function HallsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: invitationPalette.white } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="letter" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="consultation" />
    </Stack>
  );
}
