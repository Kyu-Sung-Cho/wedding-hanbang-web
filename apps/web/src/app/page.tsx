import CustomerNav from "@/components/customer-landing/CustomerNav";
import Hero from "@/components/landing/Hero";
import CommunityFeed from "@/components/landing/CommunityFeed";
import BetaCTA from "@/components/landing/BetaCTA";
import Footer from "@/components/landing/Footer";
import { getBetaCount, BETA_TOTAL } from "@/lib/beta-count";

// ISR: 60초마다 베타 카운트 새로고침
export const revalidate = 60;

export const metadata = {
  title: "웨딩한방 — 당신만을 위한 AI 웨딩 플래너",
  description:
    "당신도 모르는 선호를 끌어내고, 파트너와 합의로 가도록 중재하고, 6개월 전 결정도 기억하는 AI 웨딩 플래너 아모라. 실제 커플들의 결정 과정을 지금 확인하세요.",
};

export default async function Home() {
  const current = await getBetaCount();

  return (
    <main className="min-h-screen bg-ivory-50">
      <CustomerNav />
      <Hero />
      <CommunityFeed />
      <BetaCTA current={current} total={BETA_TOTAL} />
      <Footer />
    </main>
  );
}
