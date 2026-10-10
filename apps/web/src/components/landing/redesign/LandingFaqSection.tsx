import type { ReactNode } from "react";

import { landingContent } from "./landingContent";
import { eyebrowText, sectionTitle, shell } from "./notebook";

const policyLink =
  "text-[var(--color-paper-pen)] underline underline-offset-4 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)]";

type FaqItem = {
  id: string;
  question: string;
  answer: ReactNode;
};

const faqItems: readonly FaqItem[] = [
  {
    id: "faq-start",
    question: "예식일이나 예산이 미정이어도 시작할 수 있나요?",
    answer: (
      <p>
        네. 예식일과 예산은 미정으로 두고 시작할 수 있어요. 지금 떠오르는
        고민부터 이야기하고, 정해진 정보는 나중에 채워 주세요.
      </p>
    ),
  },
  {
    id: "faq-amora",
    question: "아모라와 이야기하려면 무엇이 필요한가요?",
    answer: (
      <p>
        로그인과 시작 설정이 필요해요. 결혼 준비 공간을 만들거나, 함께 준비할
        사람의 초대로 같은 공간에 연결하면 대화를 시작할 수 있어요.
      </p>
    ),
  },
  {
    id: "faq-ai",
    question: "아모라의 답을 그대로 결정해도 되나요?",
    answer: (
      <p>
        아모라는 AI라 틀리거나 빠진 답을 할 수 있어요. 계약 금액·취소 조건·중요
        일정은 업체의 최신 원문이나 담당 기관 안내를 다시 확인하고, 최종 결정은
        직접 내려 주세요. 자세한 내용은{" "}
        <a href="/ai-policy" className={policyLink}>AI 정책</a>과{" "}
        <a href="/terms" className={policyLink}>이용약관</a>에서 확인할 수 있어요.
      </p>
    ),
  },
  {
    id: "faq-privacy",
    question: "내 이야기는 함께 준비할 사람에게도 보이나요?",
    answer: (
      <p>
        ‘나만 상담’은 연결된 상대에게 보이지 않지만, 서비스에서 답변과 대화 내역
        제공을 위해 처리·보관해요. 공유 예산·할 일·일정은 연결된 상대에게 보여요.
        한 사람이 확인해 저장해도 공유 기록이 바뀌므로, 두 사람이 합의할 내용은
        먼저 이야기해 주세요. 자세한 범위는{" "}
        <a href="/privacy" className={policyLink}>개인정보 처리방침</a>에서 확인해 주세요.
      </p>
    ),
  },
  {
    id: "faq-price",
    question: "이용 비용은 어떻게 되나요?",
    answer: (
      <p>
        현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.
      </p>
    ),
  },
  {
    id: "faq-mobile",
    question: "휴대폰에서도 쓸 수 있나요?",
    answer: (
      <p>
        네. 휴대폰 브라우저에서도 웹 화면으로 이용할 수 있어요. 로그인하면
        휴대폰에서 준비를 이어갈 수 있어요.
      </p>
    ),
  },
];

export default function LandingFaqSection() {
  const { faq } = landingContent;
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="bg-[var(--color-ivory-50)] py-11 lg:py-16"
    >
      <div className={shell}>
        <div className="mx-auto max-w-[860px]">
          <p className={`mb-2.5 lg:text-center ${eyebrowText}`}>{faq.eyebrow}</p>
          <h2 id="faq-title" className={`${sectionTitle} lg:text-center`}>
            {faq.title}
          </h2>
          <div className="mt-6 border-t border-[var(--color-paper-edge)] lg:mt-8">
            {faqItems.map((item) => (
              <details
                key={item.id}
                id={item.id}
                className="group border-b border-[var(--color-paper-edge)]"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[14px] font-medium leading-[1.6] text-[var(--color-paper-ink)] hover:text-[var(--color-rose-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-ivory-50)] lg:text-[16px] [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-5 w-5 shrink-0 text-[var(--color-paper-ink-faint)]"
                  >
                    <path d="M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M10 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="group-open:hidden" />
                  </svg>
                </summary>
                <div className="max-w-[46rem] pb-5 pr-9 text-[14px] leading-[1.8] text-[var(--color-paper-ink-soft)] lg:text-[15px]">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
