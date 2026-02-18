"use client";

import { motion } from "framer-motion";

const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.8 },
};

export default function CustomerSolutions() {
  return (
    <section id="features" className="bg-ivory-warm py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div {...fadeInUp} className="text-center max-w-[640px] mx-auto mb-20">
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Solution
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          웨딩한방이 모든 걸
          <br />
          바꿔드립니다
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          AI 기술로 결혼 준비의 본질적 문제를 해결합니다.
          <br className="hidden md:block" />
          더 이상 정보 부족이나 시간 낭비로 고민하지 마세요.
        </p>
      </motion.div>

      <div className="max-w-[1200px] mx-auto grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        {/* 01: AI 플래너 - 풀 와이드 */}
        <motion.div {...fadeInUp} className="col-span-2 max-lg:col-span-1 bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] transition-all duration-500 grid grid-cols-2 max-lg:grid-cols-1">
          <div className="h-80 max-md:h-auto max-md:min-h-[300px] bg-gradient-to-br from-noir-800 to-noir-soft p-8 max-md:p-6 flex flex-col justify-center">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-rose-500/30 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                </div>
                <span className="text-[11px] text-white/40">웨딩한방 AI 플래너</span>
              </div>
              <div className="self-end max-w-[85%] px-[18px] py-3.5 rounded-2xl rounded-br-md bg-rose-500 text-white text-[13px] leading-relaxed">
                스튜디오 선택 기준이 뭐야? 유명한 곳이 좋을까?
              </div>
              <div className="self-start max-w-[85%] px-[18px] py-3.5 rounded-2xl rounded-bl-md bg-white/[0.08] text-white/90 text-[13px] leading-[1.7]">
                지은님, D-120일 남으셨네요! 지금 스튜디오를 알아보시면 딱 좋은 타이밍이에요 😊
                <br /><br />
                유명세보다 중요한 4가지를 체크해보세요:
              </div>
              <div className="self-start flex gap-2 flex-wrap max-w-[85%]">
                {["촬영 스타일", "보정 퀄리티", "패키지 구성", "추가비용"].map((tag) => (
                  <span key={tag} className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-[11px] text-white/70 border border-white/[0.06]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="p-10 max-md:p-7 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-5">
              <span className="font-display text-[14px] text-rose-500 font-semibold">01</span>
              <div className="h-px flex-1 bg-gradient-to-r from-rose-500/20 to-transparent" />
            </div>
            <h3 className="font-serif-kr text-[24px] font-normal mb-3 tracking-tight leading-snug max-md:text-[20px]">
              24시간 AI 웨딩 플래너
            </h3>
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-5">
              단순한 챗봇이 아닙니다. 결혼일, 예산, 선호도를 기억하고
              실제 웨딩 플래너처럼 맞춤 조언을 제공합니다.
              새벽 2시 갑자기 든 고민도 바로 해결하세요.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium">
                ✦ Claude AI 기반
              </span>
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-noir-800/[0.04] rounded-full text-[12px] text-charcoal font-medium">
                맞춤 상담
              </span>
            </div>
          </div>
        </motion.div>

        {/* 02: 드레스 피팅 */}
        <motion.div {...fadeInUp} className="bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] transition-all duration-500">
          <div className="h-80 max-md:h-64 bg-gradient-to-br from-ivory-deep to-[#EDE5DA] flex items-center justify-center relative">
            <div className="relative w-[180px] h-[240px]">
              <div className="w-full h-full bg-gradient-to-b from-rose-pale via-rose-light to-ivory-deep rounded-[40%_40%_50%_50%/30%_30%_45%_45%] shadow-[0_20px_60px_rgba(196,150,126,0.2)]" />
              <div className="absolute top-0 -left-5 -right-5 h-[3px] bg-gradient-to-r from-transparent via-rose-500 to-transparent animate-[scanLine_3s_ease-in-out_infinite] rounded shadow-[0_0_20px_rgba(196,150,126,0.4)]" />
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-white px-4 py-2 rounded-full text-[12px] font-medium text-rose-500 shadow-[0_4px_20px_rgba(0,0,0,0.08)] whitespace-nowrap flex items-center gap-1.5">
                ✦ AI 가상 피팅 중...
              </div>
            </div>
            {/* 좌우 드레스 썸네일 */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 max-md:left-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="w-10 h-12 rounded-lg bg-white/80 border border-rose-pale/30 shadow-sm flex items-center justify-center text-[10px] text-rose-500">
                  {n === 1 ? "A" : n === 2 ? "B" : "C"}
                </div>
              ))}
            </div>
          </div>
          <div className="p-9 max-md:p-7 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-5">
              <span className="font-display text-[14px] text-rose-500 font-semibold">02</span>
              <div className="h-px flex-1 bg-gradient-to-r from-rose-500/20 to-transparent" />
            </div>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug max-md:text-[20px]">
              AI 가상 드레스 피팅
            </h3>
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-5">
              집에서 10분 만에 10벌을 입어보세요.
              AI가 체형을 분석하고 드레스를 합성합니다.
              마음에 드는 것만 직접 방문해서 확인하세요.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium">
                ✦ 업계 최초 AI 피팅
              </span>
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-noir-800/[0.04] rounded-full text-[12px] text-charcoal font-medium">
                30초 완성
              </span>
            </div>
          </div>
        </motion.div>

        {/* 03: 예산 관리 */}
        <motion.div {...fadeInUp} className="bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] transition-all duration-500">
          <div className="h-80 max-md:h-auto max-md:min-h-[280px] bg-gradient-to-br from-[#F0E8DD] to-[#E8DFD2] p-8 max-md:p-6 flex flex-col justify-center">
            <div className="flex items-center justify-between mb-4">
              <span className="font-serif-kr text-[13px] font-medium text-noir-soft">커플 예산 현황</span>
              <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">실시간</span>
            </div>
            <div className="font-display text-[32px] max-md:text-[26px] font-light text-noir-800 mb-1">₩12,500,000</div>
            <div className="text-[12px] text-taupe-500 mb-5">예산 대비 68% 사용 · 잔여 ₩4,000,000</div>
            <div className="flex flex-col gap-3">
              {[
                { label: "스튜디오", width: "75%", color: "bg-rose-500", amt: "280만" },
                { label: "드레스", width: "50%", color: "bg-gold", amt: "200만" },
                { label: "메이크업", width: "35%", color: "bg-taupe-500", amt: "120만" },
                { label: "예비비", width: "20%", color: "bg-noir-soft", amt: "60만" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-[11px] font-medium w-[60px] text-right text-noir-soft">{item.label}</span>
                  <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                  </div>
                  <span className="text-[11px] text-taupe-500 w-10 font-medium">{item.amt}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-9 max-md:p-7 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-5">
              <span className="font-display text-[14px] text-rose-500 font-semibold">03</span>
              <div className="h-px flex-1 bg-gradient-to-r from-rose-500/20 to-transparent" />
            </div>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug max-md:text-[20px]">
              커플 공유 예산 관리
            </h3>
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-5">
              카테고리별 예산 배분부터 실시간 지출 추적까지.
              AI가 숨겨진 추가 비용을 미리 경고해드리고,
              커플이 함께 확인할 수 있습니다.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium">
                ✦ 숨겨진 비용 알림
              </span>
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-noir-800/[0.04] rounded-full text-[12px] text-charcoal font-medium">
                커플 실시간 공유
              </span>
            </div>
          </div>
        </motion.div>

        {/* 04: 일정 관리 - 풀 와이드 */}
        <motion.div {...fadeInUp} className="col-span-2 max-lg:col-span-1 bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] transition-all duration-500 grid grid-cols-2 max-lg:grid-cols-1">
          <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep p-10 max-md:p-7 flex flex-col justify-center">
            <div className="flex items-center justify-between mb-6">
              <span className="font-serif-kr text-[13px] font-medium text-noir-soft">D-120 · 웨딩 타임라인</span>
              <span className="text-[11px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-2 py-0.5 rounded-full font-medium">2/4 완료</span>
            </div>
            <div className="flex flex-col relative pl-6">
              <div className="absolute left-[6px] top-2 bottom-2 w-[1.5px] bg-gradient-to-b from-rose-500 via-gold-light to-platinum" />
              {[
                { dday: "D-150", title: "스튜디오 계약 완료", icon: "✓", desc: "OO스튜디오 · 280만원", done: true },
                { dday: "D-120", title: "드레스 투어 시작", icon: "→", desc: "AI 추천 3곳 · 가상 피팅 완료", done: true },
                { dday: "D-90", title: "메이크업 리허설", icon: "○", desc: "예약 필요 · AI가 알림 예정", done: false },
                { dday: "D-60", title: "본식 최종 리허설", icon: "○", desc: "모든 업체 연락 · 최종 확인", done: false },
              ].map((item) => (
                <div key={item.dday} className="flex items-start gap-4 py-3 relative">
                  <div className={`absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full border-2 ${item.done ? "border-rose-500 bg-rose-500 shadow-[0_0_0_4px_rgba(196,150,126,0.2)]" : "border-taupe-400 bg-white"}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-medium ${item.done ? "text-rose-500" : "text-taupe-400"}`}>{item.dday}</span>
                      {item.done && (
                        <span className="text-[10px] text-[#2E7D5A] bg-[#2E7D5A]/10 px-1.5 py-0.5 rounded">완료</span>
                      )}
                    </div>
                    <h5 className={`text-[14px] font-medium mb-[3px] ${item.done ? "text-noir-800" : "text-taupe-500"}`}>{item.title}</h5>
                    <p className="text-[12px] text-taupe-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-10 max-md:p-7 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-5">
              <span className="font-display text-[14px] text-rose-500 font-semibold">04</span>
              <div className="h-px flex-1 bg-gradient-to-r from-rose-500/20 to-transparent" />
            </div>
            <h3 className="font-serif-kr text-[24px] font-normal mb-3 tracking-tight leading-snug max-md:text-[20px]">
              AI D-day 플래닝
            </h3>
            <p className="text-[14px] leading-[1.8] text-charcoal font-light mb-5">
              결혼일 기준으로 해야 할 일을 자동으로 제안하고,
              적절한 시점에 알림을 보내드립니다.
              20개 카테고리, 127개 체크리스트를 체계적으로 관리하세요.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium">
                ✦ D-day 맞춤 자동 플래닝
              </span>
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-noir-800/[0.04] rounded-full text-[12px] text-charcoal font-medium">
                127개 체크리스트
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
