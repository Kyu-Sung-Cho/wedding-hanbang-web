import type { Metadata } from "next";
import Preferences21Client from "@/components/weddingCodePreferences21/Preferences21Client";

export const metadata: Metadata = {
  title: "나의 결혼 준비 선호 · 21문항 | 웨딩코드",
  description: "21개의 문장에 답하고, 실제 답을 근거로 결혼 준비 방식과 파트너에게 부탁할 말을 살펴봐요. 로그인 없이 시작해요.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  alternates: { canonical: "/wedding-code/preferences21" },
  openGraph: { title: "나의 결혼 준비 선호 · 21문항", description: "각자의 답에서 시작하는 결혼 준비 대화", images: ["/wedding-code/likert-card/opengraph-image"] },
};

export default function Preferences21Page() {
  return <Preferences21Client />;
}
