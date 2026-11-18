import { Stack } from "expo-router";
import { invitationPalette } from "@hanbang/design-tokens";
import { ExampleCoupleProvider } from "@/components/invitation/ExampleCouple";

/**
 * 예시 커플로 둘러보기(2026-11-17 파운더 디자인 아티팩트). 로그인 없이 보는 화면 묶음이다.
 * 홈·첫 대화·준비 순서·웨딩홀 비교·편지 확인(아래에서 올라오는 시트)·답장과 상담 확정.
 * 데이터는 `EXAMPLE_*` 만 쓰고 서버를 부르지 않는다.
 */
export default function ExampleLayout() {
  return (
    <ExampleCoupleProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: invitationPalette.white } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="journey" />
        <Stack.Screen name="halls" />
        <Stack.Screen name="letter" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="consultation" />
      </Stack>
    </ExampleCoupleProvider>
  );
}
