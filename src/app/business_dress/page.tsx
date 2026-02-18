import B2BSurveyPage from "@/components/b2b-survey/B2BSurveyPage";
import { dressConfig } from "@/components/b2b-survey/data/dress";

export const metadata = {
  title: "웨딩 드레스샵 파트너십 설문 | 웨딩한방",
  description: "AI 웨딩 플랫폼 웨딩한방이 드레스샵 사장님께 여쭤봅니다. 약 5분 소요.",
};

export default function BusinessDressPage() {
  return <B2BSurveyPage config={dressConfig} />;
}
