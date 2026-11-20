import LiveConsultation from "@/components/invitationLive/LiveConsultation";

/** 웨딩홀 흐름 안의 답장과 상담 확정(`Status.dc`). 일정 탭과 같은 화면이고, 뒤로 가면 앞 화면으로 돌아간다. */
export default function HallsConsultationScreen() {
  return <LiveConsultation from="stack" />;
}
