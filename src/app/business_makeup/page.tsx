import B2BSurveyPage from "@/components/b2b-survey/B2BSurveyPage";
import { makeupConfig } from "@/components/b2b-survey/data/makeup";

export const metadata = {
  title: "웨딩 메이크업샵 파트너십 설문 | 웨딩한방",
  description: "AI 웨딩 플랫폼 웨딩한방이 메이크업샵 대표님께 여쭤봅니다. 약 5분 소요.",
};

export default function BusinessMakeupPage() {
  return <B2BSurveyPage config={makeupConfig} />;
}
