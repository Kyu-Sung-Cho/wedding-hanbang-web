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

export const metadata = {
  title: "웨딩한방 Demo — AI가 이끄는 새로운 결혼 준비",
  description:
    "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지. 웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.",
};

export default function DemoPage() {
  return (
    <>
      <CustomerNav demoMode />
      <CustomerHero demoMode />
      <CustomerPainPoints />
      <CustomerSolutions />
      <CustomerFeatures />
      <CustomerComparison />
      <CustomerHowItWorks />
      <CustomerStats />
      <CustomerTestimonials />
      <CustomerCTA demoMode />
      <Footer />
    </>
  );
}
