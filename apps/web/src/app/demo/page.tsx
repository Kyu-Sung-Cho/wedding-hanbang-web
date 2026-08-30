import Link from "next/link";
import CustomerNav from "@/components/customer-landing/CustomerNav";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "아모라 기능 미리보기 | 웨딩한방",
  description:
    "개발·검증 중인 아모라의 상담, 확인 후 반영, 커플 공유 흐름을 투명하게 미리 봅니다.",
  robots: { index: false, follow: false },
};

const previews = [
  {
    eyebrow: "01 · 대화와 기억",
    title: "앞에서 나눈 조건을 이어서 정리해요",
    description:
      "결혼일, 예산, 선호와 결정 내용을 대화 맥락에 맞춰 다시 확인합니다. 기억이 확실하지 않으면 추측하지 않고 되묻도록 설계하고 있어요.",
  },
  {
    eyebrow: "02 · 확인 후 반영",
    title: "일정과 예산은 내가 승인한 뒤 바뀌어요",
    description:
      "아모라가 변경안을 먼저 보여주고, 사용자가 확인한 항목만 일정이나 예산에 반영합니다. 중요한 변경을 대화만으로 몰래 실행하지 않아요.",
  },
  {
    eyebrow: "03 · 커플 공간",
    title: "함께 볼 것과 따로 말할 것을 구분해요",
    description:
      "로그인 전 체험은 함께 보기 대화만 지원합니다. 계정을 이용하면 파트너에게 비공개인 상담을 선택할 수 있고, 비공개 내용도 서비스 운영을 위해 저장·처리된다는 점을 화면에서 안내합니다.",
  },
  {
    eyebrow: "04 · 견적 확인",
    title: "가격을 단정하지 않고 확인할 질문을 만들어요",
    description:
      "사용자가 고른 포함·이용 안 함·확인 필요 상태를 정리하고 계약 전에 물어볼 질문을 제안합니다. 사기, 위법, 최저가 여부를 AI가 임의로 판정하지 않아요.",
  },
];

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]">
      <CustomerNav demoMode />
      <section className="px-5 pb-16 pt-32 sm:px-8 sm:pt-40">
        <div className="mx-auto max-w-5xl">
          <p className="mb-5 inline-flex min-h-11 items-center rounded-full border border-gold/40 bg-white px-4 text-sm font-medium text-charcoal">
            기능 미리보기 · 현재 개발·검증 중
          </p>
          <h1 className="max-w-3xl font-serif-kr text-[clamp(38px,7vw,68px)] font-light leading-[1.18]">
            아모라가 무엇을 하고,
            <br />무엇을 하지 않는지 먼저 보여드릴게요.
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-charcoal">
            아래 내용은 출시를 약속하는 실사용 통계나 고객 후기가 아니라 제품 동작 원칙을 설명하는 프리뷰입니다.
            실제 제공 범위와 요금은 정식 안내에서 다시 확인해 주세요.
          </p>
        </div>
      </section>

      <section aria-labelledby="preview-heading" className="bg-[var(--hb-surface-hover)] px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 id="preview-heading" className="sr-only">아모라 기능 원칙</h2>
          <div className="grid gap-5 md:grid-cols-2">
            {previews.map((preview) => (
              <article key={preview.eyebrow} className="rounded-[6px] border border-black/[0.06] bg-white p-7 shadow-[var(--shadow-overlay)] sm:p-9">
                <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-rose-700)]">{preview.eyebrow}</p>
                <h3 className="mt-4 font-serif-kr text-2xl font-medium leading-snug">{preview.title}</h3>
                <p className="mt-4 text-sm leading-7 text-charcoal">{preview.description}</p>
              </article>
            ))}
          </div>

          <div className="mt-10 rounded-[6px] bg-[var(--hb-primary)] px-7 py-9 text-white sm:flex sm:items-center sm:justify-between sm:px-10">
            <div>
              <h2 className="font-serif-kr text-2xl">현재 서비스 화면을 둘러보실래요?</h2>
              <p className="mt-2 text-sm leading-6 text-white/70">새 기능은 운영 검증 결과에 따라 순차적으로 열립니다.</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 sm:mt-0">
              <Link href="/wedding" className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-white px-6 text-sm font-semibold text-[var(--hb-text-strong)]">
                서비스 둘러보기
              </Link>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
