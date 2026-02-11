"use client";

import { motion } from "framer-motion";

export default function Solutions() {
  return (
    <section id="features" className="bg-ivory-warm px-5 py-[100px] md:px-[60px] md:py-[140px]">
      {/* 헤더 */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="mx-auto mb-20 max-w-[640px] text-center"
      >
        <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
          <span className="h-px w-5 bg-rose-500" />
          Solution
        </div>
        <h2 className="mb-5 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em]">
          AI가 바꾸는
          <br />
          결혼 준비의 모든 것
        </h2>
        <p className="mx-auto max-w-[520px] text-base font-light leading-[1.75] text-charcoal">
          웨딩한방은 AI 기술로 결혼 준비의 본질적 문제를 해결합니다. 더 이상 정보 부족으로 고민하지 마세요.
        </p>
      </motion.div>

      {/* 쇼케이스 카드 */}
      <div className="mx-auto grid max-w-[1200px] gap-6 md:grid-cols-2">
        {/* AI 플래너 - 대형 카드 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="col-span-1 overflow-hidden rounded-3xl border border-black/[0.04] bg-white transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] md:col-span-2 md:grid md:grid-cols-2"
        >
          {/* 채팅 미리보기 */}
          <div className="flex h-80 flex-col justify-center bg-gradient-to-br from-noir-800 to-noir-soft p-8">
            <div className="flex flex-col gap-3.5">
              <div className="self-end rounded-2xl rounded-br-md bg-rose-500 px-4.5 py-3.5 text-[13.5px] leading-[1.6] text-white">
                스튜디오 어떻게 골라야 해?
              </div>
              <div className="self-start rounded-2xl rounded-bl-md bg-white/[0.08] px-4.5 py-3.5 text-[13.5px] leading-[1.6] text-white/85">
                D-120일 남으셨네요! 지금 시작하시면 딱 좋은 타이밍이에요
                <br />
                <br />
                스튜디오 선택 시 가장 중요한 4가지 포인트를 알려드릴게요. 촬영 스타일, 보정 퀄리티, 패키지 구성, 그리고 추가 비용이에요.
              </div>
              <div className="self-start rounded-2xl rounded-bl-md bg-white/[0.08] px-4.5 py-3.5">
                <div className="inline-flex gap-1">
                  <span className="h-[5px] w-[5px] animate-[typingBounce_1.4s_infinite] rounded-full bg-white/40" />
                  <span className="h-[5px] w-[5px] animate-[typingBounce_1.4s_infinite_0.2s] rounded-full bg-white/40" />
                  <span className="h-[5px] w-[5px] animate-[typingBounce_1.4s_infinite_0.4s] rounded-full bg-white/40" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center p-9">
            <div className="mb-4 font-display text-sm font-semibold text-rose-500">01</div>
            <h3 className="mb-3 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.02em]">
              24시간 AI 웨딩 플래너
            </h3>
            <p className="text-sm font-light leading-[1.7] text-charcoal">
              단순한 챗봇이 아닙니다. 당신의 결혼일, 예산, 선호도를 기억하고 실제 웨딩 플래너처럼 상황에 맞는 맞춤 조언을 제공합니다. 새벽 2시에 갑자기 든 고민도 바로 해결하세요.
            </p>
            <div className="mt-5 inline-flex items-center gap-[5px] self-start rounded-full bg-rose-glow px-3.5 py-1.5 text-xs font-medium text-rose-500">
              ✦ Claude AI 기반 맞춤 상담
            </div>
          </div>
        </motion.div>

        {/* 드레스 피팅 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="overflow-hidden rounded-3xl border border-black/[0.04] bg-white transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)]"
        >
          <div className="relative flex h-80 items-center justify-center bg-gradient-to-br from-ivory-deep to-[#EDE5DA]">
            <div className="relative h-[260px] w-[200px]">
              <div className="h-full w-full rounded-[40%_40%_50%_50%/30%_30%_45%_45%] bg-gradient-to-b from-rose-pale via-rose-light to-ivory-deep shadow-[0_20px_60px_rgba(196,150,126,0.2)]" />
              <div className="absolute top-0 -left-5 -right-5 h-[3px] animate-[scanLine_3s_ease-in-out_infinite] rounded-sm bg-[linear-gradient(90deg,transparent,var(--color-rose-500),transparent)] shadow-[0_0_20px_rgba(196,150,126,0.4)]" />
              <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-2 text-xs font-medium text-rose-500 shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
                ✦ AI 가상 피팅 중...
              </div>
            </div>
          </div>
          <div className="p-9">
            <div className="mb-4 font-display text-sm font-semibold text-rose-500">02</div>
            <h3 className="mb-3 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.02em]">
              AI 가상 드레스 피팅
            </h3>
            <p className="text-sm font-light leading-[1.7] text-charcoal">
              집에서 10분 만에 10벌의 드레스를 입어보세요. AI가 체형을 분석하고 드레스를 합성합니다.
            </p>
            <div className="mt-5 inline-flex items-center gap-[5px] rounded-full bg-rose-glow px-3.5 py-1.5 text-xs font-medium text-rose-500">
              ✦ 업계 최초 AI 피팅
            </div>
          </div>
        </motion.div>

        {/* 예산 관리 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="overflow-hidden rounded-3xl border border-black/[0.04] bg-white transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)]"
        >
          <div className="flex h-80 flex-col justify-center gap-4 bg-gradient-to-br from-ivory-deep to-[#E8DFD2] p-8">
            <div className="mb-2 font-serif text-[13px] font-medium text-noir-soft">스마트 예산 관리</div>
            <div className="mb-5 font-display text-4xl font-light text-noir-800">₩10,000,000</div>
            <div className="flex flex-col gap-3">
              {[
                { label: "스튜디오", pct: 75, color: "bg-rose-500" },
                { label: "드레스", pct: 45, color: "bg-gold" },
                { label: "메이크업", pct: 60, color: "bg-taupe-500" },
                { label: "스냅/DVD", pct: 30, color: "bg-noir-soft" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="w-[70px] text-right text-xs font-medium text-noir-soft">{item.label}</span>
                  <div className="flex-1 overflow-hidden rounded bg-white/60">
                    <div
                      className={`h-2 rounded ${item.color}`}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                  <span className="w-9 text-[11px] font-medium text-taupe-500">{item.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-9">
            <div className="mb-4 font-display text-sm font-semibold text-rose-500">03</div>
            <h3 className="mb-3 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.02em]">
              스마트 예산 관리
            </h3>
            <p className="text-sm font-light leading-[1.7] text-charcoal">
              카테고리별 예산 배분, 실시간 지출 추적, AI가 추가 비용을 미리 경고해드립니다.
            </p>
            <div className="mt-5 inline-flex items-center gap-[5px] rounded-full bg-rose-glow px-3.5 py-1.5 text-xs font-medium text-rose-500">
              ✦ 숨겨진 비용 사전 알림
            </div>
          </div>
        </motion.div>

        {/* 일정 관리 - 대형 카드 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="col-span-1 overflow-hidden rounded-3xl border border-black/[0.04] bg-white transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(26,26,31,0.08)] md:col-span-2 md:grid md:grid-cols-2"
        >
          <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep p-8 md:p-10">
            <div className="mb-6 font-serif text-[13px] font-medium text-noir-soft">
              D-120 · 웨딩 타임라인
            </div>
            <div className="relative flex flex-col pl-6">
              <div className="absolute top-2 bottom-2 left-[6px] w-[1.5px] bg-gradient-to-b from-rose-500 via-gold-light to-platinum" />
              {[
                { dday: "D-150", title: "스튜디오 계약 완료 ✓", sub: "OO스튜디오 · 280만원", active: true },
                { dday: "D-120", title: "드레스 투어 시작", sub: "AI 추천 3곳 · 가상 피팅 완료", active: true },
                { dday: "D-90", title: "메이크업 리허설", sub: "예약 필요 · AI가 알림 예정", active: false },
                { dday: "D-60", title: "본식 최종 리허설", sub: "모든 업체 연락 · 최종 확인", active: false },
              ].map((item) => (
                <div key={item.dday} className="relative flex items-start gap-4 py-3">
                  <div
                    className={`absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full border-2 border-rose-500 ${
                      item.active ? "bg-rose-500 shadow-[0_0_0_4px_rgba(196,150,126,0.2)]" : "bg-white"
                    }`}
                  />
                  <div>
                    <span className="text-[11px] font-medium text-rose-500">{item.dday}</span>
                    <h5 className="mb-0.5 text-sm font-medium">{item.title}</h5>
                    <p className="text-xs text-taupe-500">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center p-9">
            <div className="mb-4 font-display text-sm font-semibold text-rose-500">04</div>
            <h3 className="mb-3 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.02em]">
              AI 일정 관리 & D-day 가이드
            </h3>
            <p className="text-sm font-light leading-[1.7] text-charcoal">
              결혼일 기준으로 해야 할 일을 자동으로 제안하고, 적절한 시점에 알림을 보내드립니다. 20개 카테고리, 127개 체크리스트 항목을 체계적으로 관리하세요.
            </p>
            <div className="mt-5 inline-flex items-center gap-[5px] self-start rounded-full bg-rose-glow px-3.5 py-1.5 text-xs font-medium text-rose-500">
              ✦ D-day 맞춤 자동 플래닝
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
