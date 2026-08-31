import CustomerNav from "@/components/customer-landing/CustomerNav";
import ProblemReframe from "@/components/landing/ProblemReframe";
import FiveRoles from "@/components/landing/FiveRoles";
import NumbersAnchor from "@/components/landing/NumbersAnchor";
import CompareToHumanPlanner from "@/components/landing/CompareToHumanPlanner";
import Footer from "@/components/landing/Footer";

// ⚠️ 여기 `export const revalidate = 60` 이 있었다. 주석 그대로 "60초마다 베타 카운트
// 새로고침" 이 이유였는데, 2026-08-29 파운더 결정으로 베타를 안 하게 되면서
// `getBetaCount()` 호출이 없어졌다. 남은 것은 **아무것도 다시 읽지 않으면서 60초마다
// 다시 그리는 페이지**였다(이 파일에 await·fetch·DB 호출이 0건이다).
// 정적으로 되돌린다. 다시 동적 데이터를 쓰게 되면 그때 근거와 함께 넣어라.

export const metadata = {
  title: "이 브랜드의 이야기 — 웨딩한방",
  description:
    "결혼 준비가 진짜 힘든 이유, 견적·예산·일정으로 이어지는 아모라의 준비 도구, 정부 공식 데이터로 보는 시세.",
};

export default async function AboutPage() {
  return (
    <main className="min-h-screen bg-[var(--hb-surface-page)]">
      <CustomerNav />

      {/* 간단한 상단 타이틀 */}
      <section className="pt-[120px] md:pt-[160px] pb-[clamp(60px,8vw,100px)] px-[clamp(20px,5vw,60px)] bg-[var(--hb-surface-page)]">
        <div className="max-w-[1240px] mx-auto">
          <p className="text-[11px] text-[var(--color-rose-700)] mb-5 font-medium">
            이 브랜드의 이야기
          </p>
          <h1 className="font-serif-kr text-[clamp(36px,5vw,64px)] font-light text-[var(--hb-text-strong)] leading-[1.15] tracking-normal max-w-3xl">
            우리가 믿는
            <br />
            <em className="not-italic text-[var(--hb-accent-hover)]">결혼 준비의 원칙.</em>
          </h1>
        </div>
      </section>

      <ProblemReframe />
      <FiveRoles />
      <NumbersAnchor />
      <CompareToHumanPlanner />
      <Footer />
    </main>
  );
}
