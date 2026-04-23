import CustomerNav from "@/components/customer-landing/CustomerNav";
import Hero from "@/components/landing/Hero";
import CommunityFeed from "@/components/landing/CommunityFeed";
import BetaCTA from "@/components/landing/BetaCTA";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "웨딩한방 — 당신만을 위한 AI 웨딩 플래너",
  description:
    "당신도 모르는 선호를 끌어내고, 파트너와 합의로 가도록 중재하고, 6개월 전 결정도 기억하는 AI 웨딩 플래너 아모라. 실제 커플들의 결정 과정을 지금 확인하세요.",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-ivory-50">
      <CustomerNav />
      <Hero />
      <CommunityFeed />
      <BetaCTA />
      <Footer />
    </main>
  );
}
