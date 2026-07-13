"use client";

import { motion } from "framer-motion";

const solutions = [
  {
    title: "필요할 때 질문하는 AI 웨딩 플래너",
    desc: "아모라는 입력한 결혼일, 예산과 준비 맥락을 참고해 다음 질문과 비교 기준을 정리합니다. AI 답변에는 오류가 있을 수 있으므로 계약·금액·법률 판단은 원문과 업체를 다시 확인하세요.",
    tags: ["AI 웨딩 플래너", "커플 대화 공유"],
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
            스튜디오 선택 기준이 뭐야? 유명한 곳이 좋을까?
          </div>
          <div className="self-start max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-white/[0.08] text-white/90 text-[13px] leading-[1.7]">
            지은님, 민수님! D-120일 남으셨네요 😊
            <br /><br />
            유명세보다 중요한 4가지를 체크해보세요:
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
    title: "조건 기반 업체 탐색",
    desc: "예산, 지역과 선호도를 바탕으로 검토할 업체 후보와 비교 질문을 정리합니다. 추천은 선택을 돕는 참고자료이며 최신 가격·가능 일정·계약 조건은 업체에 직접 확인해야 합니다.",
    tags: ["검토 후보", "비교 질문 정리"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">업체 비교 예시</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium">직접 확인 필요</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { name: "A 스튜디오", match: "후보 1", tags: ["야외촬영", "자연광"], price: "가격 확인" },
            { name: "B 드레스", match: "후보 2", tags: ["머메이드", "프리미엄"], price: "가격 확인" },
            { name: "C 메이크업", match: "후보 3", tags: ["내추럴", "본식전문"], price: "가격 확인" },
          ].map((vendor) => (
            <div key={vendor.name} className="bg-white rounded-xl p-3.5 border border-black/[0.04] flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500/20 to-gold/20 flex items-center justify-center text-[11px] font-medium text-rose-500 shrink-0">
                {vendor.match}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-noir-800 truncate">{vendor.name}</div>
                <div className="flex gap-1.5 mt-1">
                  {vendor.tags.map((tag) => (
                    <span key={tag} className="text-[10px] text-taupe-500 bg-ivory-warm px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                  <span className="text-[10px] text-rose-500 font-medium ml-auto">{vendor.price}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "D-day 기준 준비 정리",
    desc: "결혼일을 기준으로 준비 카테고리와 기본 체크리스트를 확인하고 직접 완료 상태와 일정을 기록하세요. 아모라는 다음 할 일을 설명하지만 사용자 확인 없이 일정을 변경하지 않습니다.",
    tags: ["D-day 체크리스트", "직접 확인·수정"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">D-120 · 웨딩 타임라인</span>
          <span className="text-[11px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-2 py-0.5 rounded-full font-medium">2/4 완료</span>
        </div>
        <div className="flex flex-col relative pl-6">
          <div className="absolute left-[6px] top-2 bottom-2 w-[1.5px] bg-gradient-to-b from-rose-500 via-gold-light to-platinum" />
          {[
            { dday: "D-150", title: "스튜디오 계약 완료", desc: "A 스튜디오 · 280만원", done: true },
            { dday: "D-120", title: "드레스 투어 시작", desc: "후보 3곳 비교 · 질문 정리", done: true },
            { dday: "D-90", title: "메이크업 리허설", desc: "일정 확인 후 직접 등록", done: false },
            { dday: "D-60", title: "본식 최종 리허설", desc: "모든 업체 연락 · 최종 확인", done: false },
          ].map((item) => (
            <div key={item.dday} className="flex items-start gap-4 py-2.5 relative">
              <div className={`absolute -left-[21px] top-3.5 w-2.5 h-2.5 rounded-full border-2 ${item.done ? "border-rose-500 bg-rose-500 shadow-[0_0_0_4px_rgba(121,82,82,0.2)]" : "border-taupe-400 bg-white"}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium ${item.done ? "text-rose-500" : "text-taupe-400"}`}>{item.dday}</span>
                  {item.done && <span className="text-[10px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-1.5 py-0.5 rounded">완료</span>}
                </div>
                <h4 className={`text-[13px] font-medium mb-[2px] ${item.done ? "text-noir-800" : "text-taupe-500"}`}>{item.title}</h4>
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
    desc: "카테고리별 예산과 실제 지출을 직접 기록하고 커플이 같은 현황을 확인하세요. 아모라의 설명이나 계산 제안은 사용자의 확인 없이 예산을 수정하지 않습니다.",
    tags: ["직접 기록", "커플 공유"],
    visual: (
      <div className="bg-gradient-to-br from-[#F0E8DD] to-[#E8DFD2] rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-4">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">커플 예산 현황</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">커플 공유 현황</span>
        </div>
        <div className="font-display text-[28px] font-light text-noir-800 mb-1">₩12,500,000</div>
        <div className="text-[12px] text-taupe-500 mb-5">예산 대비 68% 사용 · 잔여 ₩4,000,000</div>
        <div className="flex flex-col gap-3">
          {[
            { label: "스튜디오", width: "75%", color: "bg-rose-500", amt: "280만" },
            { label: "드레스", width: "50%", color: "bg-gold", amt: "200만" },
            { label: "메이크업", width: "35%", color: "bg-taupe-500", amt: "120만" },
            { label: "예비비", width: "20%", color: "bg-noir-soft", amt: "60만" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-[11px] font-medium w-[55px] text-right text-noir-soft">{item.label}</span>
              <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
              </div>
              <span className="text-[11px] text-taupe-500 w-9 font-medium">{item.amt}</span>
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
