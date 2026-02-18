import SparkleCanvas from "@/components/landing/SparkleCanvas";
import Navigation from "@/components/landing/Navigation";
import Hero from "@/components/landing/Hero";
import PainPoints from "@/components/landing/PainPoints";
import Solutions from "@/components/landing/Solutions";
import Comparison from "@/components/landing/Comparison";
import VirtualFitting from "@/components/landing/VirtualFitting";
import Stats from "@/components/landing/Stats";
import HowItWorks from "@/components/landing/HowItWorks";
import Testimonials from "@/components/landing/Testimonials";
import CTA from "@/components/landing/CTA";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "웨딩한방 — AI가 이끄는 새로운 결혼 준비",
  description:
    "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지. 웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.",
};

export default function CustomerPage() {
  return (
    <>
      <SparkleCanvas />
      <Navigation />
      <Hero />
      <PainPoints />
      <Solutions />
      <Comparison />
      <VirtualFitting />
      <Stats />
      <HowItWorks />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}
