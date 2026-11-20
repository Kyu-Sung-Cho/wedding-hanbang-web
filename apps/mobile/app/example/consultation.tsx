import { EXAMPLE_CONSULTATION } from "@hanbang/shared/invitation";
import { ExampleFrame, useExampleNavigate } from "@/components/invitation/ExampleCouple";
import InvitationConsultation from "@/components/invitation/InvitationConsultation";

/**
 * 예시 커플의 답장과 상담 확정. 캘린더·공유·시간 요청 단추는 실제 일정과 업체에 닿는 일이라
 * 예시에서는 눌리지 않는다.
 */
export default function ExampleConsultationScreen() {
  const navigate = useExampleNavigate();
  return (
    <ExampleFrame>
      <InvitationConsultation model={EXAMPLE_CONSULTATION} onNavigate={navigate} topInset={0} />
    </ExampleFrame>
  );
}
