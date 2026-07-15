"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, CalendarClock, FileSearch, ListChecks } from "lucide-react";
import SectionLabel from "./SectionLabel";
import { weddingPath } from "@/lib/weddingPaths";

const RESEARCH_PRINCIPLES = [
  {
    title: "조사월을 함께 봅니다",
    description: "가격은 조사 시점 이후 달라질 수 있어 기준이 된 조사월을 값과 함께 표시합니다.",
    icon: CalendarClock,
  },
  {
    title: "항목을 나눠 봅니다",
    description: "식대·대관료·기본 장식·스드메처럼 원문이 구분한 항목을 임의로 합산하지 않습니다.",
    icon: ListChecks,
  },
  {
    title: "최종 계약은 다시 확인합니다",
    description: "공식 조사값도 개인 견적의 적정성을 판정하지 않습니다. 포함 범위와 추가 조건은 업체 원문과 계약서로 확인해야 합니다.",
    icon: FileSearch,
  },
] as const;

export default function OfficialPriceResearch() {
  return (
    <section className="bg-white px-[clamp(20px,5vw,60px)] py-[clamp(96px,14vw,180px)]">
      <div className="mx-auto max-w-[1240px]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 max-w-3xl md:mb-20"
        >
          <SectionLabel label="공식 가격 조사" />
          <h2 className="mb-5 font-serif-kr text-[clamp(32px,5vw,56px)] font-light leading-[1.2] tracking-[-0.01em] text-noir-800">
            숫자보다 먼저
            <br />
            <em className="not-italic text-rose-500">조사 범위</em>를 봅니다.
          </h2>
          <p className="text-[15px] font-light leading-[1.9] text-charcoal md:text-base">
            웨딩한방은 한국소비자원 참가격의 공개 조사 자료를 원문 기준으로 보여줍니다. 특정 금액을
            적정가로 제시하거나, 여러 항목을 더해 개인의 결혼비용처럼 안내하지 않습니다.
          </p>
        </motion.div>

        <div className="grid border-y border-platinum/70 md:grid-cols-3 md:divide-x md:divide-platinum/70">
          {RESEARCH_PRINCIPLES.map(({ title, description, icon: Icon }, index) => (
            <motion.article
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: index * 0.08 }}
              className="border-b border-platinum/70 px-2 py-10 last:border-b-0 md:border-b-0 md:px-8 md:py-14 md:first:pl-0 md:last:pr-0"
            >
              <Icon aria-hidden="true" className="mb-6 h-6 w-6 text-rose-500" strokeWidth={1.5} />
              <h3 className="mb-3 text-lg font-medium text-noir-800">{title}</h3>
              <p className="text-sm font-light leading-[1.8] text-charcoal">{description}</p>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-14"
        >
          <Link
            href={weddingPath("/market-prices")}
            className="group inline-flex items-center gap-2 border-b border-noir-800 pb-2 text-[14px] font-medium tracking-[0.02em] text-noir-800 transition-colors hover:border-rose-500 hover:text-rose-500"
          >
            조사월·지역·항목별 공식 조사 자료 보기
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
