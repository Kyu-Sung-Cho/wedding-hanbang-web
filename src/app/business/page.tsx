import B2BNav from "@/components/b2b-landing/B2BNav";
import B2BHero from "@/components/b2b-landing/B2BHero";
import B2BPainPoints from "@/components/b2b-landing/B2BPainPoints";
import B2BSolutions from "@/components/b2b-landing/B2BSolutions";
import B2BComparison from "@/components/b2b-landing/B2BComparison";
import B2BFeatures from "@/components/b2b-landing/B2BFeatures";
// [숨김] 초기 단계라 의미 있는 숫자가 없어 비활성화. 데이터 쌓이면 import 주석 해제
// import B2BStats from "@/components/b2b-landing/B2BStats";
import B2BPartnerTypes from "@/components/b2b-landing/B2BPartnerTypes";
import B2BCTA from "@/components/b2b-landing/B2BCTA";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "웨딩 업체 파트너십 | 웨딩한방",
  description:
    "합리적 수수료, AI 고객 매칭, 데이터 분석 리포트까지. 웨딩한방과 함께 매출을 키우세요.",
};

export default function BusinessPage() {
  return (
    <>
      <B2BNav />
      <B2BHero />
      <B2BPainPoints />
      <B2BSolutions />
      <B2BComparison />
      <B2BFeatures />
      {/* [숨김] 초기 단계라 의미 있는 숫자가 없어 비활성화. 데이터 쌓이면 주석 해제 */}
      {/* <B2BStats /> */}
      <B2BPartnerTypes />
      <B2BCTA />
      <Footer />
    </>
  );
}
