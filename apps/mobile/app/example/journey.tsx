import { ExampleFrame, useExampleCouple, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationJourney from "@/components/invitation/InvitationJourney";

/** 예시 커플의 준비 순서. 빼기·다시 넣기와 넣기 단추는 예시 화면 안에서만 바뀐다. */
export default function ExampleJourneyScreen() {
  const navigate = useExampleNavigate();
  const couple = useExampleCouple();
  return (
    <ExampleFrame>
      <InvitationJourney
        model={couple.journey}
        onBack={() => navigate("home")}
        onNavigate={navigate}
        onToggleStage={couple.toggleStage}
        onToggleAddOn={couple.toggleAddOn}
        topInset={0}
      />
    </ExampleFrame>
  );
}
