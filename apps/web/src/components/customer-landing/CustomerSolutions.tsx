"use client";

import { motion } from "framer-motion";

const solutions = [
  {
    title: "필요할 때 질문하는 AI 웨딩 플래너",
    desc: "아모라는 입력한 결혼일, 예산과 준비 맥락을 참고해 다음 질문과 비교 기준을 정리합니다. AI 답변에는 오류가 있을 수 있으므로 계약·금액·법률 판단은 원문과 업체를 다시 확인하세요.",
    tags: ["AI 웨딩 플래너", "확인 질문 정리"],
    visual: (
      <div className="bg-gradient-to-br from-noir-800 to-noir-soft rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-rose-500/30 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
          </div>
          <span className="text-[11px] text-white/70">웨딩한방 AI 플래너</span>
          <div className="ml-auto flex -space-x-1.5">
            <div className="w-5 h-5 rounded-full bg-rose-500/60 border border-noir-800 text-[8px] text-white flex items-center justify-center">신부</div>
            <div className="w-5 h-5 rounded-full bg-gold/60 border border-noir-800 text-[8px] text-white flex items-center justify-center">신랑</div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="self-end max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-rose-500 text-white text-[13px] leading-relaxed">
            받은 견적에서 무엇을 다시 확인해야 해?
          </div>
          <div className="self-start max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-white/[0.08] text-white/90 text-[13px] leading-[1.7]">
            적정 가격을 단정하지 않고, 업체 답변과 계약서에서 직접 확인할 질문을 정리할게요.
          </div>
          <div className="self-start flex gap-2 flex-wrap">
            {["촬영 스타일", "보정 퀄리티", "패키지 구성", "추가비용"].map((tag) => (
              <span key={tag} className="px-2.5 py-1 rounded-lg bg-white/[0.06] text-[11px] text-white/70 border border-white/[0.06]">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "출처가 보이는 시세 참고",
    desc: "한국소비자원 공개 자료를 조사월·지역·포함 범위와 함께 확인합니다. 시장 참고 자료일 뿐 내 견적의 적정성이나 계약 안전성을 판정하지 않습니다.",
    tags: ["공식 자료", "개인 견적 판정 아님"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">공식 시세 자료 예시</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium">조사 범위 확인</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { name: "조사월", value: "2025년 12월", note: "자료 시점" },
            { name: "지역", value: "전국·14개 지역", note: "지역별 분리" },
            { name: "항목", value: "예식장·스드메", note: "별도 조사" },
          ].map((reference) => (
            <div key={reference.name} className="bg-white rounded-xl p-3.5 border border-black/[0.04] flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500/20 to-gold/20 flex items-center justify-center text-[11px] font-medium text-rose-500 shrink-0">
                {reference.name}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-noir-800 truncate">{reference.value}</div>
                <div className="text-[10px] text-taupe-500 mt-1">{reference.note}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-taupe-500">
          개인 견적은 포함 항목과 업체의 최신 서면 조건을 직접 확인하세요.
        </p>
      </div>
    ),
  },
  {
    title: "직접 기록하는 일정",
    desc: "확정한 날짜와 할 일을 직접 등록하고 커플과 같은 일정을 확인하세요. 일반적인 준비 순서는 참고 자료이며 개인 마감으로 표시하지 않습니다.",
    tags: ["직접 등록", "커플 공유"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">직접 등록한 일정</span>
          <span className="text-[11px] text-taupe-500 bg-white px-2 py-0.5 rounded-full font-medium">예식일 미정</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { title: "상담 일정", desc: "확정한 날짜를 직접 등록하세요" },
            { title: "계약서 확인", desc: "확인할 날짜가 생기면 추가하세요" },
            { title: "기타 준비", desc: "아직 모르면 미정으로 두세요" },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3 rounded-xl border border-black/[0.04] bg-white p-3.5">
              <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-taupe-400 bg-white" />
              <div className="flex-1">
                <h4 className="mb-[2px] text-[13px] font-medium text-noir-800">{item.title}</h4>
                <p className="text-[11px] text-taupe-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "커플 공유 예산 관리",
    desc: "카테고리별 계획 금액, 서명한 계약 총액, 지금까지 낸 금액을 서로 대신하지 않는 별도 기록으로 남기고 커플이 함께 확인하세요. 아모라는 사용자의 명시적 입력 없이 이 금액을 수정하지 않습니다.",
    tags: ["직접 기록", "커플 공유"],
    visual: (
      <div className="bg-gradient-to-br from-[#F0E8DD] to-[#E8DFD2] rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-4">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">커플 예산 현황</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">커플 공유 현황</span>
        </div>
        <div className="font-serif-kr text-[22px] font-light text-noir-800 mb-1">총 예산 미입력</div>
        <div className="text-[12px] text-taupe-500 mb-5">직접 입력한 금액만 합계에 표시합니다</div>
        <div className="flex flex-col gap-3">
          {[
            { label: "스튜디오", color: "bg-rose-500" },
            { label: "드레스", color: "bg-gold" },
            { label: "메이크업", color: "bg-taupe-500" },
            { label: "기타", color: "bg-noir-soft" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-[11px] font-medium w-[55px] text-right text-noir-soft">{item.label}</span>
              <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: "0%" }} />
              </div>
              <span className="w-12 text-[11px] font-medium text-taupe-500">미입력</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

export default function CustomerSolutions() {
  return (
    <section id="features" className="bg-ivory-warm py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Solution
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          흩어진 준비를 <em className="not-italic font-medium bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">웨딩한방</em>에서
          <br />
          차근차근 정리합니다
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          흩어진 준비 정보와 대화를 한곳에서 정리합니다.
          <br className="hidden md:block" />
          중요한 선택은 원문과 업체를 확인한 뒤 직접 결정하세요.
        </p>
        <p className="mt-4 text-[12px] text-taupe-500">
          화면 예시 · 실제 견적이나 추천 결과가 아닙니다
        </p>
      </motion.div>

      <div className="max-w-[1000px] mx-auto flex flex-col gap-[clamp(20px,3vw,32px)]">
        {solutions.map((sol, i) => (
          <motion.div
            key={sol.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className={`bg-white rounded-3xl overflow-hidden border border-black/[0.04] md:hover:-translate-y-1 md:hover:shadow-[0_24px_64px_rgba(27,28,28,0.08)] transition-all duration-500 grid grid-cols-2 items-stretch max-md:grid-cols-1 ${
              i % 2 === 1 ? "md:direction-rtl" : ""
            }`}
            style={i % 2 === 1 ? { direction: "rtl" } : undefined}
          >
            {/* 비주얼 */}
            <div className="min-h-[320px] max-md:min-h-[260px] p-3" style={{ direction: "ltr" }}>
              {sol.visual}
            </div>

            {/* 텍스트 */}
            <div className="p-10 max-md:p-7 flex flex-col justify-center" style={{ direction: "ltr" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="h-px flex-1 bg-gradient-to-r from-rose-500/20 to-transparent" />
              </div>
              <h3 className="font-serif-kr text-[clamp(18px,2.5vw,24px)] font-normal mb-3 tracking-tight leading-snug">
                {sol.title}
              </h3>
              <p className="text-[clamp(13px,1.5vw,14px)] leading-[1.8] text-charcoal font-light mb-5">
                {sol.desc}
              </p>
              <div className="flex gap-2 flex-wrap">
                {sol.tags.map((tag, j) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium ${
                      j === 0
                        ? "bg-[var(--rose-glow)] text-rose-500"
                        : "bg-noir-800/[0.04] text-charcoal"
                    }`}
                  >
                    {j === 0 && "✦ "}{tag}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
