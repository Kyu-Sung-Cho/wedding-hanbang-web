"use client";

import { motion } from "framer-motion";

const solutions = [
  {
    title: "24시간 AI 웨딩 플래너",
    desc: "결혼일, 직접 저장한 예산과 선호를 대화 맥락에 이어서 상담합니다. 커플이 같은 채팅방에서 확인하니 따로 옮겨 적지 않고, 필요한 시간에 함께 정리할 수 있어요.",
    tags: ["AI 웨딩 플래너", "커플 동시 상담"],
    visual: (
      <div className="bg-gradient-to-br from-noir-800 to-noir-soft rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-rose-500/30 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
          </div>
          <span className="text-[11px] text-white/40">웨딩한방 AI 플래너</span>
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
            예시 커플님, 저장한 일정에 맞춰 함께 확인해볼게요 😊
            <br /><br />
            유명세보다 먼저 확인할 기준이에요:
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
    title: "AI 맞춤 업체 추천",
    desc: "사용자가 말한 지역·예산·스타일 조건과 운영자가 검수한 공시가 범위 안에서 후보를 정리합니다. 결과는 품질 보증이 아니며, 최신 가격과 제공 범위는 업체 서면으로 다시 확인해요.",
    tags: ["조건 기반 탐색", "검수된 공시가"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">AI 맞춤 추천</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium">예시 화면</span>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { name: "샘플 스튜디오 A", match: "조건", tags: ["야외촬영", "자연광"], price: "공시가 확인" },
            { name: "샘플 드레스 B", match: "조건", tags: ["머메이드", "대여 조건"], price: "공시가 확인" },
            { name: "샘플 메이크업 C", match: "조건", tags: ["내추럴", "본식 안내"], price: "공시가 확인" },
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
    title: "AI D-day 플래닝",
    desc: "결혼일과 저장한 준비 상태를 기준으로 다음 할 일을 정리합니다. 항목별 체크리스트와 알림은 두 분의 실제 일정에 맞게 직접 수정할 수 있어요.",
    tags: ["D-day 일정 정리", "항목별 체크리스트"],
    visual: (
      <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-5">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">예시 · 웨딩 타임라인</span>
          <span className="text-[11px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-2 py-0.5 rounded-full font-medium">직접 수정 가능</span>
        </div>
        <div className="flex flex-col relative pl-6">
          <div className="absolute left-[6px] top-2 bottom-2 w-[1.5px] bg-gradient-to-b from-rose-500 via-gold-light to-platinum" />
          {[
            { dday: "완료", title: "스튜디오 계약", desc: "샘플 스튜디오 · 입력한 금액 저장", done: true },
            { dday: "진행", title: "드레스 투어", desc: "저장한 후보와 일정 확인", done: true },
            { dday: "D-90", title: "메이크업 리허설", desc: "예약 필요 · AI가 알림 예정", done: false },
            { dday: "D-60", title: "본식 최종 리허설", desc: "모든 업체 연락 · 최종 확인", done: false },
          ].map((item) => (
            <div key={item.dday} className="flex items-start gap-4 py-2.5 relative">
              <div className={`absolute -left-[21px] top-3.5 w-2.5 h-2.5 rounded-full border-2 ${item.done ? "border-rose-500 bg-rose-500 shadow-[0_0_0_4px_rgba(121,82,82,0.2)]" : "border-taupe-400 bg-white"}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium ${item.done ? "text-rose-500" : "text-taupe-400"}`}>{item.dday}</span>
                  {item.done && <span className="text-[10px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-1.5 py-0.5 rounded">완료</span>}
                </div>
                <h5 className={`text-[13px] font-medium mb-[2px] ${item.done ? "text-noir-800" : "text-taupe-500"}`}>{item.title}</h5>
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
    desc: "직접 입력한 카테고리별 예산과 지출을 커플이 함께 확인합니다. 포함·별도 여부를 확인할 항목과 저장한 예산 초과도 한 화면에서 점검할 수 있어요.",
    tags: ["포함 항목 확인", "커플 실시간 공유"],
    visual: (
      <div className="bg-gradient-to-br from-[#F0E8DD] to-[#E8DFD2] rounded-2xl p-6 h-full flex flex-col justify-center">
        <div className="flex items-center justify-between mb-4">
          <span className="font-serif-kr text-[13px] font-medium text-noir-soft">커플 예산 현황</span>
          <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">실시간</span>
        </div>
        <div className="font-serif-kr text-[24px] font-light text-noir-800 mb-1">직접 입력한 예산</div>
        <div className="text-[12px] text-taupe-500 mb-5">저장한 지출과 잔여 예산을 함께 확인</div>
        <div className="flex flex-col gap-3">
          {[
            { label: "스튜디오", width: "75%", color: "bg-rose-500", amt: "저장됨" },
            { label: "드레스", width: "50%", color: "bg-gold", amt: "저장됨" },
            { label: "메이크업", width: "35%", color: "bg-taupe-500", amt: "확인 전" },
            { label: "예비비", width: "20%", color: "bg-noir-soft", amt: "입력 전" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-[11px] font-medium w-[55px] text-right text-noir-soft">{item.label}</span>
              <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
              </div>
                  <span className="text-[11px] text-taupe-500 w-12 font-medium">{item.amt}</span>
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
          <em className="not-italic font-medium bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">웨딩한방</em>이 모든 걸
          <br />
          바꿔드립니다
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          AI 기술로 결혼 준비의 본질적 문제를 해결합니다.
          <br className="hidden md:block" />
          더 이상 정보 부족이나 시간 낭비로 고민하지 마세요.
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
