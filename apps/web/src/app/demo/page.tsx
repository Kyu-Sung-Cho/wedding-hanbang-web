import CustomerNav from "@/components/customer-landing/CustomerNav";
import CustomerHero from "@/components/customer-landing/CustomerHero";
import CustomerPainPoints from "@/components/customer-landing/CustomerPainPoints";
import CustomerSolutions from "@/components/customer-landing/CustomerSolutions";
import CustomerFeatures from "@/components/customer-landing/CustomerFeatures";
import CustomerComparison from "@/components/customer-landing/CustomerComparison";
import CustomerHowItWorks from "@/components/customer-landing/CustomerHowItWorks";
import CustomerStats from "@/components/customer-landing/CustomerStats";
import CustomerTestimonials from "@/components/customer-landing/CustomerTestimonials";
import CustomerCTA from "@/components/customer-landing/CustomerCTA";
import Footer from "@/components/landing/Footer";
import ReducedMotionProvider from "@/components/common/ReducedMotionProvider";

export const metadata = {
  title: "웨딩한방 서비스 소개 — AI와 함께 정리하는 결혼 준비",
  description:
    process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon"
      ? "아모라 상담, 커플 일정·예산 공유, 견적 체크 등 정식 베타에서 준비 중인 기능을 미리 살펴보세요."
      : "아모라 상담, 커플 일정·예산 공유, 견적 체크 등 현재 제공 중인 주요 기능을 둘러보세요.",
};


export default function DemoPage() {
  return (
    <ReducedMotionProvider>
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[2000] rounded-lg bg-white px-4 py-3 font-semibold text-noir-800 shadow-lg focus:not-sr-only"
      >
        본문으로 건너뛰기
      </a>
      <CustomerNav demoMode />
      <main id="main-content">
        <CustomerHero />
        <CustomerPainPoints />
        <CustomerSolutions />
        <CustomerFeatures />
        <CustomerComparison />
        <CustomerHowItWorks />
        <CustomerStats />
        <CustomerTestimonials />
        <CustomerCTA />
      </main>
      <Footer />
    </ReducedMotionProvider>
  );
}
