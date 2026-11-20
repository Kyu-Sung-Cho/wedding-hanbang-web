import { EXAMPLE_FIRST_CHAT } from "@hanbang/shared/invitation";
import { ExampleFrame, goBackInExample, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationFirstChat from "@/components/invitation/InvitationFirstChat";

/** 예시 커플의 아모라와 첫 대화. 고른 단계와 달은 이 화면 안에서만 바뀐다. */
export default function ExampleChatScreen() {
  const navigate = useExampleNavigate();
  return (
    <ExampleFrame>
      <InvitationFirstChat model={EXAMPLE_FIRST_CHAT} onBack={goBackInExample} onNavigate={navigate} topInset={0} />
    </ExampleFrame>
  );
}
