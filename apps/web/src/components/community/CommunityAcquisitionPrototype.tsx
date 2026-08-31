"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpenText,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  HeartHandshake,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { communityPostLinkProps } from "@/lib/community/routes";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { PostWithAuthor } from "@/types/community.types";

export type CommunityPrototypeVariant = "decision" | "stories" | "clinic";

const variants: Array<{
  id: CommunityPrototypeVariant;
  shortLabel: string;
  label: string;
}> = [
  { id: "decision", shortLabel: "A", label: "결정 검색엔진" },
  { id: "stories", shortLabel: "B", label: "결정 매거진" },
  { id: "clinic", shortLabel: "C", label: "사람 답변 클리닉" },
];

const categoryLabels: Record<string, string> = {
  is_normal: "견적·계약",
  tour_review: "업체 경험",
  tips_v2: "준비 노하우",
  ama: "현직자 답변",
  free: "자유 이야기",
};

interface DecisionCase {
  id?: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  comments: number;
  resolved: boolean;
  example: boolean;
}

const exampleCases: DecisionCase[] = [
  {
    title: "홀 계약 직전인데 식대 외 추가 비용이 이 정도면 보통인가요?",
    excerpt:
      "보증 인원과 음료 비용까지 합치니 처음 받은 견적보다 커졌어요. 같은 지역에서 계약한 분들의 확인 포인트를 모았어요.",
    category: "견적·계약",
    author: "내년 봄 예식 준비중",
    comments: 8,
    resolved: true,
    example: true,
  },
  {
    title: "드레스 투어 세 곳, 하루에 잡아도 괜찮을까요?",
    excerpt:
      "이동 시간보다 피팅 뒤 비교 메모가 더 중요했어요. 실제로 다녀온 커플들이 추천한 동선과 준비물을 확인해 보세요.",
    category: "업체 경험",
    author: "서울 10월 예식",
    comments: 5,
    resolved: true,
    example: true,
  },
  {
    title: "본식 스냅 원본 비용은 계약 전에 꼭 확인해야 하나요?",
    excerpt:
      "앨범 구성, 원본 구매, 수정본 장수처럼 나중에 달라지기 쉬운 항목을 계약 전 질문 목록으로 정리했어요.",
    category: "준비 노하우",
    author: "촬영 계약 완료",
    comments: 3,
    resolved: false,
    example: true,
  },
];

const quickSearches = [
  "이 견적 괜찮나요?",
  "계약 전 뭘 확인하죠?",
  "추가금이 보통인가요?",
  "비슷한 커플 경험",
];

function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toDecisionCase(post: PostWithAuthor): DecisionCase {
  const excerpt = plainText(post.content);

  return {
    id: post.id,
    title: post.title,
    excerpt: excerpt || "본문에서 실제 경험과 확인 포인트를 살펴보세요.",
    category: categoryLabels[post.category] ?? "결혼 준비",
    author: post.author?.nickname || "커뮤니티 멤버",
    comments: post.comment_count,
    resolved: post.is_resolved,
    example: false,
  };
}

function PrototypeNotice({ variant }: { variant: CommunityPrototypeVariant }) {
  const current = variants.find((item) => item.id === variant) ?? variants[0];

  return (
    <div className="border-b border-[#dfd5c7] bg-[#f3ece2] px-4 py-2 text-center font-sans text-[11px] font-semibold tracking-[0.04em] text-[#6d655c]">
      개발용 비교 시안 {current.shortLabel} · {current.label} · 배포에는 노출되지 않아요
    </div>
  );
}

function TrustLine() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 font-sans text-[12px] font-medium text-[#5f6c68]">
      <span className="inline-flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-[#8F6662]" /> 사람의 경험을 먼저
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-[#8F6662]" /> 광고·운영자 글은 명확히 표시
      </span>
      <span className="inline-flex items-center gap-1.5">
        <BadgeCheck className="h-3.5 w-3.5 text-[#8F6662]" /> 해결된 질문은 결론부터
      </span>
    </div>
  );
}

function SearchBox({
  variant,
  initialValue = "",
  dark = false,
}: {
  variant: CommunityPrototypeVariant;
  initialValue?: string;
  dark?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialValue);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    const params = new URLSearchParams({
      search: normalized,
      feed: "all",
    });
    router.push(weddingPath(`/community?${params.toString()}#community-feed`));
  }

  return (
    <form
      onSubmit={submit}
      className={`flex min-h-14 items-center gap-3 rounded-full border p-1.5 pl-5 shadow-[var(--shadow-overlay)] ${
        dark
          ? "border-white/20 bg-white text-[var(--hb-text-strong)]"
          : "border-[#ddd3c5] bg-white text-[var(--hb-text-strong)]"
      }`}
      role="search"
    >
      <Search className="h-5 w-5 shrink-0 text-[#8F6662]" />
      <label htmlFor={`prototype-search-${variant}`} className="sr-only">
        결혼 준비 질문 검색
      </label>
      <input
        id={`prototype-search-${variant}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 bg-transparent font-sans text-[14px] outline-none placeholder:text-[#9a958e] sm:text-[15px]"
        placeholder="예: 홀 추가금, 스냅 원본, 드레스 투어"
      />
      <button
        type="submit"
        className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[var(--hb-primary)] px-5 font-sans text-[13px] font-bold text-white transition-colors hover:bg-[var(--hb-primary)]"
      >
        경험 찾기
      </button>
    </form>
  );
}

function CaseLink({ item, className }: { item: DecisionCase; className?: string }) {
  const linkProps = item.id
    ? communityPostLinkProps(item.id)
    : weddingLinkProps(
        `/community?search=${encodeURIComponent(item.title)}&feed=all#community-feed`,
      );

  return (
    <Link {...linkProps} className={className}>
      <span className="flex flex-wrap items-center gap-2 font-sans text-[11px] font-semibold">
        <span className="rounded-full bg-[#e8efe9] px-2.5 py-1 text-[var(--hb-text-strong)]">{item.category}</span>
        {item.resolved && (
          <span className="inline-flex items-center gap-1 text-[#65736e]">
            <Check className="h-3.5 w-3.5" /> 해결된 고민
          </span>
        )}
        {item.example && <span className="text-[#9b775f]">예시 데이터</span>}
      </span>
      <strong className="mt-3 block break-keep font-serif text-[20px] font-medium leading-[1.42] text-[var(--hb-text-strong)] sm:text-[23px]">
        {item.title}
      </strong>
      <span className="mt-2 block line-clamp-2 font-sans text-[13px] leading-6 text-[#69746f]">
        {item.excerpt}
      </span>
      <span className="mt-4 flex items-center justify-between gap-3 font-sans text-[11px] font-medium text-[#8b8881]">
        <span>{item.author}</span>
        <span className="inline-flex items-center gap-1">
          답변 {item.comments} <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </span>
    </Link>
  );
}

function DecisionSearchVariant({ cases, total }: { cases: DecisionCase[]; total: number }) {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]">
      <PrototypeNotice variant="decision" />

      <main>
        <section className="overflow-hidden border-b border-[#e2d9cd]">
          <div className="mx-auto grid w-full max-w-[1320px] gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] lg:items-center lg:px-8 lg:py-24">
            <div>
              <p className="font-sans text-[12px] font-bold text-[var(--color-rose-700)]">
                결혼 준비 판단 커뮤니티
              </p>
              <div role="heading" aria-level={1} className="mt-5 max-w-[760px] break-keep font-serif text-[42px] font-medium leading-[1.12] tracking-[-0.04em] text-[var(--hb-text-strong)] sm:text-[58px] lg:text-[68px]">
                결혼 준비,
                <br />이게 맞는지 함께 확인해요.
              </div>
              <p className="mt-6 max-w-[650px] break-keep font-sans text-[16px] leading-8 text-[#65716c] sm:text-[18px]">
                업체 목록보다 먼저 필요한 건 내 상황과 비슷한 사람의 결정 근거예요. 견적·계약·일정의
                애매함을 검색하고, 실제 경험에서 다음 행동을 찾으세요.
              </p>

              <div className="mt-8 max-w-[720px]">
                <SearchBox variant="decision" />
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {quickSearches.map((label) => (
                    <Link
                      key={label}
                      {...weddingLinkProps(
                        `/community?search=${encodeURIComponent(label)}&feed=all#community-feed`,
                      )}
                      className="shrink-0 rounded-[6px] border border-[#ddd3c5] bg-[#fffdf8] px-3 py-2 font-sans text-[11px] font-semibold text-[#5f6c68]"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mt-8 border-t border-[#ded5c8] pt-5">
                <TrustLine />
              </div>
            </div>

            <aside className="relative">
              <div className="absolute -left-8 -top-10 hidden h-28 w-28 rounded-full bg-[#eadbd7] blur-3xl lg:block" />
              <p className="mb-3 font-sans text-[11px] font-bold text-[var(--color-rose-700)]">
                먼저 읽어볼 결정 기록
              </p>
              <CaseLink
                item={cases[0]}
                className="relative block rounded-[6px] border border-[#d9cfc1] bg-[#fffdf8] p-6 shadow-[var(--shadow-overlay)] transition-transform hover:-translate-y-1 sm:p-8"
              />
              <p className="mt-3 text-center font-sans text-[11px] text-[#89857e]">
                {total > 0 ? `현재 확인할 수 있는 글 ${total.toLocaleString("ko-KR")}개` : "구조 확인용 예시 콘텐츠"}
              </p>
            </aside>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="font-sans text-[11px] font-bold text-[var(--color-rose-700)]">결정 라이브러리</p>
              <h2 className="mt-3 break-keep font-serif">
                정보가 아니라, 결정까지 읽어요
              </h2>
            </div>
            <Link
              {...weddingLinkProps("/community?feed=all#community-feed")}
              className="inline-flex items-center gap-1 self-start font-sans text-[13px] font-bold text-[var(--hb-text-strong)]"
            >
              모든 경험 보기 <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {cases.slice(0, 3).map((item, index) => (
              <CaseLink
                key={item.id ?? `${item.title}-${index}`}
                item={item}
                className="block min-h-[280px] rounded-[6px] border border-[#ded5c8] bg-white p-6 transition-colors hover:border-[#a9bab4]"
              />
            ))}
          </div>
        </section>

        <section className="bg-[var(--hb-primary)] text-white">
          <div className="mx-auto grid w-full max-w-[1320px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8 lg:py-16">
            <div>
              <p className="font-sans text-[11px] font-bold text-[#d7c1bb]">경험을 내 준비로</p>
              <h2 className="mt-3 max-w-[760px] break-keep font-serif">
                읽고 끝내지 말고, 우리 커플의 예산·일정·질문으로 정리하세요.
              </h2>
              <p className="mt-3 font-sans text-[14px] leading-7 text-white/70">
                아모라가 게시글의 결론을 대신 내리지 않고, 확인할 항목과 다음 행동을 정리해요.
              </p>
            </div>
            <Link
              {...weddingLinkProps("/chat?source=community_prototype")}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-surface-hover)] px-6 font-sans text-[13px] font-bold text-[var(--hb-text-strong)]"
            >
              <Sparkles className="h-4 w-4 text-[#8F6662]" /> 내 상황 정리하기
            </Link>
          </div>
        </section>
      </main>

      <PrototypeSwitcher current="decision" />
    </div>
  );
}

function StoriesVariant({ cases }: { cases: DecisionCase[] }) {
  const feature = cases[0];

  return (
    <div className="min-h-screen bg-[var(--hb-surface-hover)] text-[var(--hb-text-strong)]">
      <PrototypeNotice variant="stories" />

      <main>
        <section className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24">
          <div className="grid gap-10 border-b border-[#cfc4b6] pb-12 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-16 lg:pb-20">
            <aside className="order-2 lg:order-1">
              <p className="font-sans text-[11px] font-bold tracking-[0.18em] text-[var(--color-rose-700)]">WEDDING NOTES</p>
              <p className="mt-4 font-serif text-[20px] leading-8 text-[#53615c]">
                먼저 준비한 사람이
                <br />다음 커플에게 남긴
                <br />결정의 기록
              </p>
              <div className="mt-8 hidden space-y-3 border-t border-[#cfc4b6] pt-5 font-sans text-[12px] font-semibold text-[#65716c] lg:block">
                <p>01 견적·계약</p>
                <p>02 업체 경험</p>
                <p>03 일정·관계</p>
                <p>04 결혼 후 회고</p>
              </div>
            </aside>

            <div className="order-1 lg:order-2">
              <p className="font-sans text-[12px] font-bold text-[var(--color-rose-700)]">결정 매거진</p>
              <div role="heading" aria-level={1} className="mt-5 max-w-[970px] break-keep font-serif text-[46px] font-medium leading-[1.08] tracking-[-0.045em] sm:text-[66px] lg:text-[84px]">
                남의 선택을 구경하지 말고,
                <br />결정의 이유를 가져가세요.
              </div>
              <div className="mt-9 max-w-[720px]">
                <SearchBox variant="stories" />
              </div>
            </div>
          </div>

          <article className="grid gap-8 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.7fr)] lg:gap-16 lg:py-20">
            <div className="rounded-[6px] bg-[var(--hb-primary)] p-7 text-white sm:p-10 lg:min-h-[500px] lg:p-14">
              <div className="flex items-center justify-between gap-4 font-sans text-[11px] font-bold tracking-[0.14em] text-[#d8c4bd]">
                <span>DECISION STORY 01</span>
                {feature.example && <span>예시 데이터</span>}
              </div>
              <div role="heading" aria-level={2} className="mt-12 max-w-[760px] break-keep font-serif text-[34px] font-medium leading-[1.3] sm:text-[46px] lg:text-[54px]">
                {feature.title}
              </div>
              <p className="mt-8 max-w-[700px] font-sans text-[15px] leading-8 text-white/70">{feature.excerpt}</p>
              <div className="mt-10 flex flex-wrap gap-3 font-sans text-[12px] font-semibold">
                <span className="rounded-full border border-white/25 px-3 py-2">상황</span>
                <span className="rounded-full border border-white/25 px-3 py-2">비교 기준</span>
                <span className="rounded-full bg-white px-3 py-2 text-[var(--hb-text-strong)]">결정 후 결과</span>
              </div>
            </div>

            <div className="flex flex-col justify-between py-2">
              <div>
                <p className="font-sans text-[11px] font-bold text-[var(--color-rose-700)]">이 기록에서 가져갈 것</p>
                <ol className="mt-6 space-y-6">
                  {[
                    "처음 견적과 실제 결제액을 분리해 보기",
                    "추가금이 생기는 조건을 계약 전에 묻기",
                    "우리 커플의 우선순위로 다시 판단하기",
                  ].map((item, index) => (
                    <li key={item} className="grid grid-cols-[34px_1fr] gap-3 border-b border-[#d7ccbe] pb-5">
                      <span className="font-serif text-[18px] text-[#8F6662]">0{index + 1}</span>
                      <span className="break-keep font-sans text-[14px] font-semibold leading-6 text-[#53615c]">{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <Link
                {...(feature.id
                  ? communityPostLinkProps(feature.id)
                  : weddingLinkProps("/community?feed=all#community-feed"))}
                className="mt-8 inline-flex items-center gap-2 self-start border-b border-[var(--hb-primary)] pb-1 font-sans text-[13px] font-bold"
              >
                전체 결정 기록 읽기 <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </article>
        </section>

        <section className="border-y border-[#d8cec1] bg-[var(--hb-surface-page)]">
          <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-serif">같은 순간을 지난 사람들</h2>
              <BookOpenText className="h-7 w-7 text-[#8F6662]" />
            </div>
            <div className="mt-8 divide-y divide-[#d8cec1] border-y border-[#d8cec1]">
              {cases.slice(0, 3).map((item, index) => (
                <Link
                  key={item.id ?? `${item.title}-${index}`}
                  {...(item.id
                    ? communityPostLinkProps(item.id)
                    : weddingLinkProps("/community?feed=all#community-feed"))}
                  className="group grid gap-3 py-6 sm:grid-cols-[70px_140px_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
                >
                  <span className="font-serif text-[18px] text-[#9b775f]">0{index + 1}</span>
                  <span className="font-sans text-[11px] font-bold text-[#65716c]">{item.category}</span>
                  <span className="break-keep font-serif text-[20px] font-medium leading-7 sm:text-[24px]">{item.title}</span>
                  <ArrowRight className="hidden h-5 w-5 transition-transform group-hover:translate-x-1 sm:block" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <PrototypeSwitcher current="stories" />
    </div>
  );
}

function ClinicVariant({ cases }: { cases: DecisionCase[] }) {
  return (
    <div className="min-h-screen bg-[#fffdf8] text-[var(--hb-text-strong)]">
      <PrototypeNotice variant="clinic" />

      <main>
        <section className="bg-[var(--hb-primary)] text-white">
          <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.65fr)] lg:items-center lg:px-8 lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 font-sans text-[11px] font-bold text-[#e3cec7]">
                <span className="h-2 w-2 rounded-full bg-[#d9a79c]" /> 사람 답변 클리닉
              </p>
              <div role="heading" aria-level={1} className="mt-6 max-w-[780px] break-keep font-serif text-[44px] font-medium leading-[1.12] tracking-[-0.04em] sm:text-[62px] lg:text-[72px]">
                지금 막힌 한 가지,
                <br />경험자가 같이 봐드려요.
              </div>
              <p className="mt-6 max-w-[690px] break-keep font-sans text-[16px] leading-8 text-white/65">
                질문을 많이 쌓는 것보다 제대로 답해 주는 커뮤니티를 만듭니다. 내 상황을 구체적으로 적으면
                비슷한 단계를 지난 사람에게 먼저 보여줘요.
              </p>
              <div className="mt-8 max-w-[720px]">
                <SearchBox variant="clinic" dark />
              </div>
            </div>

            <aside className="rounded-[6px] border border-white/15 bg-white/5 p-6 backdrop-blur sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-2 font-sans text-[12px] font-bold text-[#e3cec7]">
                  <CircleHelp className="h-4 w-4" /> 질문 준비하기
                </span>
                <span className="font-sans text-[10px] text-white/50">약 1분</span>
              </div>
              <h2 className="mt-7 break-keep font-serif">
                검색해도 답이 없으면,
                <br />내 상황으로 질문하세요.
              </h2>
              <ul className="mt-6 space-y-3 font-sans text-[13px] text-white/65">
                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#d9a79c]" /> 지역·예식 시기·예산 범위를 함께</li>
                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#d9a79c]" /> 개인정보와 계약서는 가리고</li>
                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#d9a79c]" /> 해결되면 다음 커플에게 결론 공유</li>
              </ul>
              <Link
                {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
                className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-surface-hover)] px-5 font-sans text-[13px] font-bold text-[var(--hb-text-strong)]"
              >
                내 질문 시작하기 <ArrowRight className="h-4 w-4" />
              </Link>
            </aside>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
            <div>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="font-sans text-[11px] font-bold tracking-[0.15em] text-[var(--color-rose-700)]">ANSWER NEEDED</p>
                  <h2 className="mt-3 font-serif">지금 답이 필요한 질문</h2>
                </div>
                <Link
                  {...weddingLinkProps("/community?feed=all&sort=unanswered#community-feed")}
                  className="inline-flex items-center gap-1 self-start font-sans text-[13px] font-bold text-[var(--hb-text-strong)]"
                >
                  답변 대기 전체 보기 <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-7 space-y-3">
                {cases.slice(0, 3).map((item, index) => (
                  <Link
                    key={item.id ?? `${item.title}-${index}`}
                    {...(item.id
                      ? communityPostLinkProps(item.id)
                      : weddingLinkProps("/community?feed=all&sort=unanswered#community-feed"))}
                    className="group grid gap-4 rounded-[6px] border border-[#ded5c8] bg-white p-5 transition-colors hover:border-[#a9bab4] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-6"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f3e7e3] text-[#8F6662]">
                      <MessageCircle className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-sans text-[11px] font-semibold text-[#73807b]">
                        <span>{item.category}</span>
                        <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> 답변 기다리는 중</span>
                        {item.example && <span className="text-[#9b775f]">예시 데이터</span>}
                      </span>
                      <strong className="mt-2 block break-keep font-serif text-[20px] font-medium leading-7 sm:text-[23px]">{item.title}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 self-start font-sans text-[12px] font-bold text-[var(--hb-text-strong)] sm:self-center">
                      경험 보태기 <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <aside className="rounded-[6px] bg-[#edf1ec] p-6 sm:p-8 lg:self-start">
              <HeartHandshake className="h-7 w-7 text-[#8F6662]" />
              <h3 className="mt-5 break-keep font-serif">당신의 경험이 가장 필요한 질문만 보여드릴게요.</h3>
              <p className="mt-4 font-sans text-[13px] leading-6 text-[#65716c]">
                예식 지역과 준비 단계를 선택하면, 답할 수 있는 질문을 우선 연결하는 구조예요.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["홀 계약 완료", "드레스 투어 경험", "부산 예식", "결혼 완료"].map((label) => (
                  <span key={label} className="rounded-full border border-[#c9d4cb] bg-white px-3 py-2 font-sans text-[11px] font-semibold text-[#53615c]">
                    {label}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="border-t border-[#ded5c8] bg-[var(--hb-surface-page)]">
          <div className="mx-auto grid w-full max-w-[1320px] gap-5 px-4 py-12 sm:grid-cols-3 sm:px-6 lg:px-8 lg:py-16">
            {[
              ["01", "질문을 구체화해요", "지역·시기·예산과 이미 확인한 내용을 함께 적어요."],
              ["02", "경험자에게 연결해요", "같은 단계를 지나온 멤버에게 답변이 필요한 질문을 보여줘요."],
              ["03", "결론을 남겨요", "선택 뒤 결과를 한 줄로 남겨 다음 커플의 검색 답이 돼요."],
            ].map(([number, title, body]) => (
              <div key={number} className="border-l border-[#d8cec1] px-5 py-2">
                <span className="font-serif text-[18px] text-[#8F6662]">{number}</span>
                <h3 className="mt-4 font-serif">{title}</h3>
                <p className="mt-2 break-keep font-sans text-[13px] leading-6 text-[#69746f]">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <PrototypeSwitcher current="clinic" />
    </div>
  );
}

function PrototypeSwitcher({ current }: { current: CommunityPrototypeVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentIndex = variants.findIndex((item) => item.id === current);

  const move = useMemo(
    () => (direction: -1 | 1) => {
      const nextIndex = (currentIndex + direction + variants.length) % variants.length;
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", variants[nextIndex].id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [currentIndex, pathname, router, searchParams],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <nav
      aria-label="커뮤니티 프로토타입 시안 전환"
      className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-[#172723]/95 p-1.5 font-sans text-white shadow-[var(--shadow-overlay)] backdrop-blur"
    >
      <button
        type="button"
        onClick={() => move(-1)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="이전 시안"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="min-w-[168px] px-2 text-center">
        <span className="block text-[9px] font-semibold tracking-[0.15em] text-white/45">PROTOTYPE</span>
        <span className="mt-0.5 block text-[11px] font-bold">
          {variants[currentIndex].shortLabel} · {variants[currentIndex].label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => move(1)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="다음 시안"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

export function parseCommunityPrototypeVariant(
  value: string | null | undefined,
): CommunityPrototypeVariant | null {
  return variants.some((item) => item.id === value) ? (value as CommunityPrototypeVariant) : null;
}

export default function CommunityAcquisitionPrototype({
  variant,
  posts,
  total,
}: {
  variant: CommunityPrototypeVariant;
  posts: PostWithAuthor[];
  total: number;
}) {
  const cases = useMemo(() => {
    const actualCases = [...posts]
      .sort((a, b) => Number(b.is_resolved) - Number(a.is_resolved) || b.comment_count - a.comment_count)
      .slice(0, 3)
      .map(toDecisionCase);

    return actualCases.length >= 3 ? actualCases : [...actualCases, ...exampleCases].slice(0, 3);
  }, [posts]);

  if (variant === "stories") return <StoriesVariant cases={cases} />;
  if (variant === "clinic") return <ClinicVariant cases={cases} />;
  return <DecisionSearchVariant cases={cases} total={total} />;
}
