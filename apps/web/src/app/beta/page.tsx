import { createClient } from "@supabase/supabase-js";
import CustomerNav from "@/components/customer-landing/CustomerNav";
import Footer from "@/components/landing/Footer";
import BetaForm from "./BetaForm";
import { Check } from "lucide-react";

// 서버 페치 — 실제 신청 수
export const revalidate = 60;

const BETA_TOTAL = 50;

async function getBetaCount(): Promise<number> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return 0;
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { count } = await admin
      .from("preregistrations")
      .select("id", { count: "exact", head: true })
      .eq("is_beta_candidate", true);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export const metadata = {
  title: "베타 신청 · 웨딩한방",
  description: "6주간 함께해 주실 50쌍을 찾습니다. 실거래가 · Contract Diff 무료 Premium, 정식 출시 시 6개월 연장.",
};

const BENEFITS = [
  "실거래가 · Contract Diff 무료 Premium",
  "아모라 풀 기능 우선 사용",
  "종료 후 6개월 무료 연장",
  "정식 출시 시 선배 신부 인증",
];

const CONDITIONS = [
  "2026년 6~12월 결혼 예정",
  "신부 · 신랑 모두 참여 가능",
  "주 1회 짧은 피드백",
];

export default async function BetaPage() {
  const current = await getBetaCount();
  const progress = Math.min(100, (current / BETA_TOTAL) * 100);
  const isFull = current >= BETA_TOTAL;

  return (
    <main className="min-h-screen bg-noir-800">
      <CustomerNav />

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
            베타 모집
          </p>
          <h1 className="font-serif-kr text-[clamp(34px,5.5vw,68px)] font-light text-white leading-[1.15] tracking-[-0.015em] max-w-3xl">
            6주간 함께해 주실
            <br />
            <em className="not-italic text-rose-light">50쌍</em>을 찾습니다.
          </h1>
          <p className="text-white/70 text-[15px] md:text-[17px] leading-[1.9] font-light max-w-xl mt-8">
            아모라의 전 기능을 6주간 먼저 경험하고,
            <br />
            정식 출시 후에도 6개월 무료로 이어집니다.
          </p>
        </div>
      </section>

      {/* Body: 좌측 혜택·조건 + 우측 신청 카드 */}
      <section className="px-[clamp(20px,5vw,60px)] pb-[clamp(80px,10vw,140px)]">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-20 items-start">
          {/* 좌측 */}
          <div className="space-y-14">
            {/* Benefits */}
            <div>
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-7 font-medium">
                베타 참여 혜택
              </p>
              <ul className="space-y-6">
                {BENEFITS.map((benefit, idx) => (
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
                {CONDITIONS.map((cond) => (
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
                  이메일로 참여 확정 안내 (2~3일 이내)
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">03</span>
                  아모라 계정 생성 + 6주 동행
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">04</span>
                  종료 후 6개월 무료 연장 + 선배 신부 인증
                </li>
              </ul>
            </div>
          </div>

          {/* 우측: Form or Full */}
          <div className="lg:sticky lg:top-24">
            {isFull ? (
              <div className="border border-white/15 rounded-[28px] p-10 md:p-12 backdrop-blur-sm bg-white/[0.03]">
                <Check className="w-8 h-8 text-rose-light mb-6" />
                <h2 className="font-serif-kr text-[24px] md:text-[28px] text-white font-light leading-snug mb-4">
                  베타 50쌍 <em className="not-italic text-rose-light">모집 완료</em>
                </h2>
                <p className="text-white/70 text-[15px] leading-[1.8] font-light mb-6">
                  많은 관심 감사드립니다.
                  <br />
                  베타 종료 후 정식 출시 소식을 전해드릴게요.
                </p>
                <p className="text-white/50 text-[12px] tracking-[0.18em]">
                  현재 {current} / {BETA_TOTAL}
                </p>
              </div>
            ) : (
              <BetaForm current={current} total={BETA_TOTAL} progress={progress} />
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
