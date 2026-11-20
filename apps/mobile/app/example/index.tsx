import { EXAMPLE_HOME } from "@hanbang/shared/invitation";
import { ExampleFrame, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationHome from "@/components/invitation/InvitationHome";
import InvitationTabBar from "@/components/invitation/InvitationTabBar";

/** 예시 커플 홈. 떠 있는 하단 메뉴로 대화·준비 순서·상담 화면에 간다(아티팩트 링크 그대로). */
export default function ExampleHomeScreen() {
  const navigate = useExampleNavigate();
  return (
    <ExampleFrame>
      <InvitationHome model={EXAMPLE_HOME} onNavigate={navigate} topInset={0} withTabBar />
      <InvitationTabBar active="home" onNavigate={navigate} />
    </ExampleFrame>
  );
}
