import CustomerNav from "@/components/customer-landing/CustomerNav";
import ProblemReframe from "@/components/landing/ProblemReframe";
import FiveRoles from "@/components/landing/FiveRoles";
import NumbersAnchor from "@/components/landing/NumbersAnchor";
import CompareToHumanPlanner from "@/components/landing/CompareToHumanPlanner";
import ForBetaCouples from "@/components/landing/ForBetaCouples";
import Footer from "@/components/landing/Footer";
import { getBetaCount, BETA_TOTAL } from "@/lib/beta-count";

// ISR: 60초마다 베타 카운트 새로고침
export const revalidate = 60;

export const metadata = {
  title: "이 브랜드의 이야기 — 웨딩한방",
  description:
    "결혼 준비가 진짜 힘든 이유, 견적·예산·일정으로 이어지는 아모라의 준비 도구, 정부 공식 데이터로 보는 시세.",
};

export default async function AboutPage() {
  const current = await getBetaCount();
  return (
    <main className="min-h-screen bg-ivory-50">
      <CustomerNav />

      {/* 간단한 상단 타이틀 */}
      <section className="pt-[120px] md:pt-[160px] pb-[clamp(60px,8vw,100px)] px-[clamp(20px,5vw,60px)] bg-ivory-50">
        <div className="max-w-[1240px] mx-auto">
          <p className="text-[11px] tracking-[0.3em] text-rose-500 mb-5 font-medium">
            이 브랜드의 이야기
          </p>
          <h1 className="font-serif-kr text-[clamp(36px,5vw,64px)] font-light text-noir-800 leading-[1.15] tracking-[-0.015em] max-w-3xl">
            우리가 믿는
            <br />
            <em className="not-italic text-rose-500">결혼 준비의 원칙.</em>
          </h1>
        </div>
      </section>

      <ProblemReframe />
      <FiveRoles />
      <NumbersAnchor />
      <CompareToHumanPlanner />
      <ForBetaCouples current={current} total={BETA_TOTAL} />
      <Footer />
    </main>
  );
}
