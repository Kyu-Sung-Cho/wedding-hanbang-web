import CustomerNav from "@/components/customer-landing/CustomerNav";
import ProblemReframe from "@/components/landing/ProblemReframe";
import FiveRoles from "@/components/landing/FiveRoles";
import OfficialPriceResearch from "@/components/landing/OfficialPriceResearch";
import CompareToHumanPlanner from "@/components/landing/CompareToHumanPlanner";
import ForBetaCouples from "@/components/landing/ForBetaCouples";
import Footer from "@/components/landing/Footer";
import { getBetaCount, BETA_TOTAL } from "@/lib/beta-count";
import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

// ISR: 60초마다 사용자 연구 코호트 신청 카운트 새로고침
export const revalidate = 60;

export const metadata = {
  title: "이 브랜드의 이야기 — 웨딩한방",
  description:
    "결혼 준비가 힘든 이유, 업체 원문에서 질문을 정리하고 예산·일정 기록으로 이어가는 방법, 출처가 표시된 시세.",
};

export default async function AboutPage() {
  const applicationsEnabled = isResearchCohortApplicationsEnabled();
  const current = applicationsEnabled ? await getBetaCount() : 0;
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
      <OfficialPriceResearch />
      <CompareToHumanPlanner />
      <ForBetaCouples
        current={current}
        total={BETA_TOTAL}
        applicationsEnabled={applicationsEnabled}
      />
      <Footer />
    </main>
  );
}
