import B2BSurveyPage from "@/components/b2b-survey/B2BSurveyPage";
import { studioConfig } from "@/components/b2b-survey/data/studio";

export const metadata = {
  title: "설문조사 - 스튜디오 | 웨딩한방",
  description: "AI 웨딩 플랫폼 웨딩한방이 스튜디오 대표님께 여쭤봅니다. 약 5분 소요.",
};

export default function BusinessStudioPage() {
  return <B2BSurveyPage config={studioConfig} />;
}
