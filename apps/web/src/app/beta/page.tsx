import CustomerNav from "@/components/customer-landing/CustomerNav";
import Footer from "@/components/landing/Footer";
import BetaForm from "./BetaForm";
import { getBetaCount } from "@/lib/beta-count";
import {
  USER_RESEARCH_COHORT_BENEFITS,
  USER_RESEARCH_COHORT_CONDITIONS,
} from "@/constants/beta";
import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

// 서버 페치 — 실제 신청 수 (ISR: 60초)
export const revalidate = 60;

export const metadata = {
  title: "사용자 연구 코호트 신청 · 웨딩한방",
  description: "베타 계정 이용과 별도로, 6주간 아모라와 준비 흐름을 함께 검증할 사용자 연구 참여자 최대 50명을 찾습니다.",
};

export default async function BetaPage() {
  const applicationsEnabled = isResearchCohortApplicationsEnabled();
  const current = applicationsEnabled ? await getBetaCount() : 0;

  return (
    <main className="min-h-screen bg-noir-800">
      <CustomerNav darkAtTop />

      {/* Hero */}
      <section className="relative pt-[120px] md:pt-[160px] pb-[clamp(60px,8vw,100px)] px-[clamp(20px,5vw,60px)] overflow-hidden">
        <div
          className="absolute top-[20%] right-[-10%] w-[min(720px,85vw)] h-[min(720px,85vw)] bg-[radial-gradient(circle,rgba(212,175,160,0.18),transparent_65%)] rounded-full pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute bottom-[-20%] left-[-8%] w-[min(520px,80vw)] h-[min(520px,80vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.10),transparent_62%)] rounded-full pointer-events-none"
          aria-hidden
        />

        <div className="relative z-10 max-w-[1240px] mx-auto">
          <p className="text-[11px] tracking-[0.3em] text-rose-light mb-6 font-medium">
            사용자 연구 코호트 모집
          </p>
          <h1 className="font-serif-kr text-[clamp(34px,5.5vw,68px)] font-light text-white leading-[1.15] tracking-[-0.015em] max-w-3xl">
            6주간 함께해 주실
            <br />
            <em className="not-italic text-rose-light">최대 50명</em>을 찾습니다.
          </h1>
          <p className="text-white/70 text-[15px] md:text-[17px] leading-[1.9] font-light max-w-xl mt-8">
            일반 베타 계정 이용과 별도로, 이 페이지에서는
            <br />
            6주간 심층 피드백에 참여할 사용자 연구 코호트를 모집합니다.
          </p>
        </div>
      </section>

      {/* Body: 좌측 혜택·조건 + 우측 신청 카드 */}
      <section id="cta" className="scroll-mt-24 px-[clamp(20px,5vw,60px)] pb-[clamp(80px,10vw,140px)]">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-20 items-start">
          {/* 좌측 */}
          <div className="order-2 space-y-14 lg:order-1">
            {/* Benefits */}
            <div>
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-7 font-medium">
                사용자 연구 참여 혜택
              </p>
              <ul className="space-y-6">
                {USER_RESEARCH_COHORT_BENEFITS.map((benefit, idx) => (
                  <li
                    key={benefit}
                    className="flex items-baseline gap-6 text-[16px] md:text-[18px] text-white/90 font-light leading-[1.65]"
                  >
                    <span className="font-display text-rose-light/70 text-sm shrink-0 w-7">
                      0{idx + 1}
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conditions */}
            <div className="pt-10 border-t border-white/10">
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-6 font-medium">
                참여 조건
              </p>
              <ul className="space-y-4 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.85]">
                {USER_RESEARCH_COHORT_CONDITIONS.map((cond) => (
                  <li key={cond} className="flex items-baseline gap-5">
                    <span className="text-rose-light/40">·</span>
                    <span>{cond}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 과정 */}
            <div className="pt-10 border-t border-white/10">
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-6 font-medium">
                신청 이후 과정
              </p>
              <ul className="space-y-4 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.85]">
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">01</span>
                  신청 접수 (이 페이지)
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">02</span>
                  선정 결과와 다음 단계를 이메일로 안내
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">03</span>
                  선정된 분께 사용자 연구 시작일과 참여 방법 안내
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">04</span>
                  6주 연구 종료 후 확인된 개선 사항 안내
                </li>
              </ul>
            </div>
          </div>

          {/* 우측: Form or Full */}
          <div className="order-1 lg:order-2 lg:sticky lg:top-24">
            <BetaForm current={current} applicationsEnabled={applicationsEnabled} />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
