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
  title: "웨딩한방 Demo — AI와 함께 정리하는 결혼 준비",
  description:
    "아모라 상담, 커플 일정·예산 공유, 견적 체크 등 현재 제공 중인 주요 기능을 둘러보세요.",
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
