import { ExampleFrame, goBackInExample, useExampleCouple, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationLetterSheet from "@/components/invitation/InvitationLetterSheet";

/**
 * 예시 커플의 보내기 전 편지 확인(아래에서 올라오는 시트). 받는 곳은 비교에서 담은 곳이다.
 * 보내기는 아무 데도 보내지 않고 상담 화면 예시로 넘어간다.
 */
export default function ExampleLetterScreen() {
  const navigate = useExampleNavigate();
  const couple = useExampleCouple();
  return (
    <ExampleFrame>
      <InvitationLetterSheet
        model={couple.letter}
        onToggleShare={couple.toggleShare}
        onChangeBody={couple.setLetterBody}
        onLater={goBackInExample}
        onNavigate={navigate}
      />
    </ExampleFrame>
  );
}
