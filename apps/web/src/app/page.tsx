import CustomerNav from "@/components/customer-landing/CustomerNav";
import Hero from "@/components/landing/Hero";
import ProblemReframe from "@/components/landing/ProblemReframe";
import FiveRoles from "@/components/landing/FiveRoles";
import NumbersAnchor from "@/components/landing/NumbersAnchor";
import CompareToHumanPlanner from "@/components/landing/CompareToHumanPlanner";
import ForBetaCouples from "@/components/landing/ForBetaCouples";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "웨딩한방 — 당신만을 위한 AI 웨딩 플래너",
  description:
    "당신도 모르는 선호를 끌어내고, 파트너와 합의로 가도록 중재하고, 6개월 전 결정도 기억하는 AI 웨딩 플래너 아모라. 한국소비자원·기획재정부 데이터 기반.",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-ivory-50">
      <CustomerNav />
      <Hero />
      <ProblemReframe />
      <FiveRoles />
      <NumbersAnchor />
      <CompareToHumanPlanner />
      <ForBetaCouples />
      <Footer />
    </main>
  );
}
