import { ExampleFrame, useExampleCouple, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationCompare from "@/components/invitation/InvitationCompare";

/** 예시 커플의 웨딩홀 비교. 업체 이름·가격·사진은 예시다(맨 위 띠가 알린다). */
export default function ExampleHallsScreen() {
  const navigate = useExampleNavigate();
  const couple = useExampleCouple();
  return (
    <ExampleFrame>
      <InvitationCompare
        model={couple.compare}
        sort={couple.sort}
        onSortChange={couple.setSort}
        onTogglePick={couple.togglePick}
        onBack={() => navigate("home")}
        onNavigate={navigate}
        topInset={0}
      />
    </ExampleFrame>
  );
}
