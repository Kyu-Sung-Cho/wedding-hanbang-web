import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  Building2,
  Camera,
  CheckCircle2,
  Flower,
  Flower2,
  Gem,
  Gift,
  Heart,
  Home,
  Key,
  Lightbulb,
  Mail,
  MessageSquareQuote,
  Mic,
  Package,
  Palette,
  Plane,
  Shirt,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import type { ElementType } from "react";

import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { weddingLinkProps } from "@/lib/weddingPaths";
import {
  getChecklistCategoryGuide,
  type ChecklistConversationAudience,
} from "@hanbang/shared/checklist-guides";
import ChecklistCategoryTasks from "./ChecklistCategoryTasks";
import CopyScriptButton from "./CopyScriptButton";

const ICONS: Record<string, ElementType> = {
  Users,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Key,
  Mail,
  Video,
  Sparkles,
  Flower,
  Gift,
  Mic,
  Package,
  Heart,
  Box,
};

const AUDIENCE_STYLE: Record<ChecklistConversationAudience, string> = {
  partner: "bg-[#36534e] text-white",
  parents: "bg-[#8f5150] text-white",
  vendor: "bg-[#9d6f36] text-white",
  helper: "bg-[#6d637d] text-white",
};

function BulletList({ items, tone = "default" }: { items: string[]; tone?: "default" | "warning" }) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[14px] leading-7 text-[#3d4a45]">
          <span
            aria-hidden="true"
            className={`mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full ${tone === "warning" ? "bg-[#b06b55]" : "bg-[#55716a]"}`}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ChecklistCategoryView({ categoryKey }: { categoryKey: string }) {
  const template = CHECKLIST_MAP[categoryKey];
  const guide = getChecklistCategoryGuide(categoryKey);
  if (!template || !guide) return null;

  const index = CATEGORY_CHECKLISTS.findIndex((category) => category.key === categoryKey);
  const previous = index > 0 ? CATEGORY_CHECKLISTS[index - 1] : null;
  const next = index >= 0 && index < CATEGORY_CHECKLISTS.length - 1
    ? CATEGORY_CHECKLISTS[index + 1]
    : null;
  const relatedGuides = guide.relatedMannersSlugs
    .map((slug) => MANNERS_PARTS.find((part) => part.slug === slug))
    .filter((part): part is NonNullable<typeof part> => Boolean(part));
  const Icon = ICONS[template.icon] ?? CheckCircle2;
  const chatPrefill = `${template.label} 준비를 시작하려고 해. 우리 상황에 맞게 먼저 합의할 질문과 확인 순서를 정리해줘.`;

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 py-7 sm:px-6 sm:py-10">
      <nav aria-label="이동 경로" className="flex items-center gap-2 text-[12.5px] text-[#6b746f]">
        <Link {...weddingLinkProps("/checklist")} className="font-semibold text-[#36534e] hover:underline hover:underline-offset-4">
          웨딩 체크리스트
        </Link>
        <span aria-hidden>›</span>
        <span aria-current="page">{template.label}</span>
      </nav>

      <header className="mt-5 border-b border-[#dfd6c5] pb-7 sm:pb-9">
        <div className="flex items-start gap-4 sm:gap-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[#36534e] text-white sm:h-14 sm:w-14">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-[#9d6f36]">WEDDING CHECKLIST GUIDE</p>
            <h1 className="mt-1.5 font-serif-kr text-[30px] font-medium leading-[1.25] text-[#172a27] sm:text-[38px]">
              {template.label}
            </h1>
            <p className="mt-3 max-w-[760px] text-[14px] leading-7 text-[#53615c] sm:text-[15px]">
              {guide.introduction}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-[12px] text-[#5e6965]">
          <span className="rounded-full border border-[#ddd5c7] bg-white px-3 py-1.5">
            기본 확인 항목 {template.items.length}개
          </span>
          <span className="rounded-full border border-[#ddd5c7] bg-white px-3 py-1.5">
            기본 확인 순서 D-{template.ddayStart} ~ D-{template.ddayDeadline}
          </span>
        </div>
        <p className="mt-3 text-[11.5px] leading-5 text-[#7a827e]">
          D-day 표시는 화면 정렬을 위한 기본 예시예요. 가족·업체와 정한 실제 날짜와 계약서가 항상 우선합니다.
        </p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,760px)_260px] lg:items-start lg:gap-12">
        <div className="min-w-0 space-y-12">
          <section id="align-first" aria-labelledby="align-first-heading" className="scroll-mt-24">
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-[#55716a]" />
              <h2 id="align-first-heading" className="text-[22px] font-semibold text-[#172a27]">둘이 먼저 맞출 것</h2>
            </div>
            <BulletList items={guide.alignFirst} />
            <p className="mt-5 rounded-[16px] border border-[#d9cfba] bg-[#fffaf0] px-4 py-3.5 text-[13px] leading-6 text-[#665a46]">
              <span className="font-semibold">이 페이지를 마치면 · </span>
              {guide.completion}
            </p>
          </section>

          <ChecklistCategoryTasks categoryKey={categoryKey} />

          <section id="tips" aria-labelledby="tips-heading" className="scroll-mt-24">
            <div className="flex items-center gap-2.5">
              <Lightbulb className="h-5 w-5 text-[#9d6f36]" />
              <h2 id="tips-heading" className="text-[22px] font-semibold text-[#172a27]">준비가 쉬워지는 팁</h2>
            </div>
            <BulletList items={guide.tips} />
          </section>

          <section id="conversation" aria-labelledby="conversation-heading" className="scroll-mt-24">
            <div className="flex items-center gap-2.5">
              <MessageSquareQuote className="h-5 w-5 text-[#8f5150]" />
              <h2 id="conversation-heading" className="text-[22px] font-semibold text-[#172a27]">이렇게 말해보세요</h2>
            </div>
            <div className="mt-5 divide-y divide-[#e4ddd1] border-y border-[#e4ddd1]">
              {guide.conversations.map((conversation) => (
                <article key={`${conversation.audience}-${conversation.title}`} className="py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${AUDIENCE_STYLE[conversation.audience]}`}>
                        {conversation.label}
                      </span>
                      <h3 className="mt-2.5 text-[15px] font-semibold text-[#243832]">{conversation.title}</h3>
                    </div>
                    <CopyScriptButton
                      text={conversation.say}
                      label={`${conversation.title} 대화 문장`}
                    />
                  </div>
                  <blockquote className="mt-3 border-l-2 border-[#c9a96e] pl-4 text-[15px] leading-7 text-[#2f403b]">
                    “{conversation.say}”
                  </blockquote>
                  <p className="mt-2 pl-[18px] text-[12.5px] leading-6 text-[#69736f]">{conversation.note}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="cautions" aria-labelledby="cautions-heading" className="scroll-mt-24 rounded-[18px] border border-[#e2cfc5] bg-[#fff8f4] px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 text-[#b06b55]" />
              <h2 id="cautions-heading" className="text-[21px] font-semibold text-[#5e352d]">놓치기 쉬운 주의점</h2>
            </div>
            <BulletList items={guide.cautions} tone="warning" />
          </section>

          <section id="more-help" aria-labelledby="more-help-heading" className="scroll-mt-24">
            <div className="flex items-center gap-2.5">
              <BookOpen className="h-5 w-5 text-[#55716a]" />
              <h2 id="more-help-heading" className="text-[22px] font-semibold text-[#172a27]">더 깊이 알아보기</h2>
            </div>
            {relatedGuides.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {relatedGuides.map((part) => (
                  <li key={part.slug}>
                    <Link
                      href={`/wedding/manners/${part.slug}`}
                      prefetch={false}
                      className="block h-full rounded-[16px] border border-[#dcd5c9] bg-white px-4 py-4 transition-colors hover:border-[#8f5150]/45"
                    >
                      <p className="text-[11px] font-semibold tracking-wide text-[#8f5150]">관련 예절 가이드</p>
                      <p className="mt-1.5 text-[15px] font-semibold text-[#243832]">{part.title}</p>
                      <p className="mt-1 text-[12.5px] leading-5 text-[#65706d]">{part.subtitle}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] leading-6 text-[#65706d]">
                이 분야의 공개 예절 가이드는 검증해서 준비 중이에요. 체크 항목과 대화 예시는 지금 바로 사용할 수 있습니다.
              </p>
            )}
            <Link
              {...weddingLinkProps(`/chat?${new URLSearchParams({ prefill: chatPrefill })}`)}
              className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2b4541]"
            >
              아모라와 우리 상황 정리하기
            </Link>
          </section>
        </div>

        <aside className="hidden lg:sticky lg:top-[96px] lg:block" aria-label="페이지 바로가기">
          <p className="text-[11.5px] font-semibold tracking-[0.12em] text-[#9d6f36]">이 페이지에서</p>
          <nav className="mt-3 border-l border-[#d9d1c2]">
            {[
              ["#align-first", "둘이 먼저 맞출 것"],
              ["#checklist-tasks", "실제 체크리스트"],
              ["#tips", "준비 팁"],
              ["#conversation", "대화 예시"],
              ["#cautions", "주의점"],
              ["#more-help", "관련 가이드"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="block border-l-2 border-transparent px-3 py-2 text-[12.5px] font-medium text-[#65706d] hover:border-[#8f5150] hover:text-[#8f5150]">
                {label}
              </a>
            ))}
          </nav>
          <div className="mt-6 rounded-[16px] border border-[#ddd5c7] bg-[#fffdf8] px-4 py-4">
            <p className="text-[12px] font-semibold text-[#36534e]">한 줄 기준</p>
            <p className="mt-1.5 text-[12.5px] leading-6 text-[#5d6864]">{template.tip}</p>
          </div>
        </aside>
      </div>

      <nav aria-label="다른 체크리스트 분야" className="mt-12 grid gap-3 border-t border-[#dfd6c5] pt-6 sm:grid-cols-2">
        {previous ? (
          <Link {...weddingLinkProps(`/checklist/${previous.key}`)} className="group flex min-h-[68px] items-center gap-3 rounded-[14px] border border-[#ddd5c7] bg-white px-4 py-3 hover:border-[#9d6f36]/50">
            <ArrowLeft className="h-4 w-4 text-[#9d6f36]" />
            <span>
              <span className="block text-[11px] text-[#7a827e]">이전 분야</span>
              <span className="mt-0.5 block text-[13.5px] font-semibold text-[#243832]">{previous.label}</span>
            </span>
          </Link>
        ) : <span />}
        {next && (
          <Link {...weddingLinkProps(`/checklist/${next.key}`)} className="group flex min-h-[68px] items-center justify-end gap-3 rounded-[14px] border border-[#ddd5c7] bg-white px-4 py-3 text-right hover:border-[#9d6f36]/50">
            <span>
              <span className="block text-[11px] text-[#7a827e]">다음 분야</span>
              <span className="mt-0.5 block text-[13.5px] font-semibold text-[#243832]">{next.label}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#9d6f36]" />
          </Link>
        )}
      </nav>
    </div>
  );
}
