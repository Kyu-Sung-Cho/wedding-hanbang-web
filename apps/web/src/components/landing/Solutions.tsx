"use client";

import { motion } from "framer-motion";

const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.8 },
};

export default function Solutions() {
  return (
    <section id="features" className="bg-ivory-warm py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      {/* 헤더 */}
      <motion.div {...fadeInUp} className="text-center max-w-[640px] mx-auto mb-20">
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Solution
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          흩어진 준비를
          <br />
          한곳에서 이어가세요
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          저장한 일정과 예산, 검수된 공시가, 커플의 결정 기록을
          필요한 순간에 함께 확인할 수 있습니다.
        </p>
      </motion.div>

      {/* 쇼케이스 */}
      <div className="max-w-[1200px] mx-auto grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        {/* AI 플래너 - 큰 카드 */}
        <motion.div {...fadeInUp} className="col-span-2 max-lg:col-span-1 bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(27,28,28,0.08)] transition-all duration-500 grid grid-cols-2 max-lg:grid-cols-1">
          <div className="h-80 max-md:h-auto max-md:min-h-[280px] bg-gradient-to-br from-noir-800 to-noir-soft p-8 max-md:p-6 flex flex-col justify-center">
            <div className="flex flex-col gap-3.5">
              <div className="self-end max-w-[80%] px-[18px] py-3.5 rounded-2xl rounded-br-md bg-rose-500 text-white text-[13.5px] leading-relaxed">
                스튜디오 어떻게 골라야 해? 🤔
              </div>
              <div className="self-start max-w-[80%] px-[18px] py-3.5 rounded-2xl rounded-bl-md bg-white/[0.08] text-white/85 text-[13.5px] leading-relaxed">
                저장한 일정과 두 분의 조건부터 확인해볼게요 😊
                <br /><br />
                촬영 스타일, 보정 범위, 패키지 구성과 포함·별도 항목을 같은 기준으로 볼게요.
              </div>
              <div className="self-start max-w-[80%] px-[18px] py-3.5 rounded-2xl rounded-bl-md bg-white/[0.08] text-white/85 text-[13.5px]">
                <div className="inline-flex gap-1">
                  <span className="w-[5px] h-[5px] rounded-full bg-white/40 animate-[typingBounce_1.4s_infinite]" />
                  <span className="w-[5px] h-[5px] rounded-full bg-white/40 animate-[typingBounce_1.4s_infinite_0.2s]" />
                  <span className="w-[5px] h-[5px] rounded-full bg-white/40 animate-[typingBounce_1.4s_infinite_0.4s]" />
                </div>
              </div>
            </div>
          </div>
          <div className="p-9 flex flex-col justify-center">
            <span className="font-display text-[14px] text-rose-500 font-semibold mb-4">01</span>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug">
              24시간 AI 웨딩 플래너
            </h3>
            <p className="text-[14px] leading-relaxed text-charcoal font-light">
              두 분이 직접 저장한 결혼일, 예산, 선호를 대화 맥락에 이어서
              다음 확인 질문과 준비 항목을 정리합니다.
              중요한 가격과 계약 조건은 원문과 업체 서면 안내를 기준으로 확인해요.
            </p>
            <div className="inline-flex items-center gap-[5px] mt-5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium w-fit">
              ✦ OpenAI 기반 대화형 준비 도우미
            </div>
          </div>
        </motion.div>

        {/* 드레스 피팅 */}
        <motion.div {...fadeInUp} className="bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(27,28,28,0.08)] transition-all duration-500">
          <div className="h-80 max-md:h-64 bg-gradient-to-br from-ivory-deep to-[#EDE5DA] flex items-center justify-center relative">
            <div className="relative w-[200px] h-[260px]">
              <div className="w-full h-full bg-gradient-to-b from-rose-pale via-rose-light to-ivory-deep rounded-[40%_40%_50%_50%/30%_30%_45%_45%] shadow-[0_20px_60px_rgba(121,82,82,0.2)]" />
              <div className="absolute top-0 -left-5 -right-5 h-[3px] bg-gradient-to-r from-transparent via-rose-500 to-transparent animate-[scanLine_3s_ease-in-out_infinite] rounded shadow-[0_0_20px_rgba(121,82,82,0.4)]" />
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-white px-4 py-2 rounded-full text-[12px] font-medium text-rose-500 shadow-[0_4px_20px_rgba(0,0,0,0.08)] whitespace-nowrap flex items-center gap-1.5">
                ✦ AI 가상 피팅 중...
              </div>
            </div>
          </div>
          <div className="p-9 flex flex-col justify-center">
            <span className="font-display text-[14px] text-rose-500 font-semibold mb-4">02</span>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug">
              AI 가상 드레스 피팅
            </h3>
            <p className="text-[14px] leading-relaxed text-charcoal font-light">
              업로드한 사진으로 드레스 이미지를 미리 비교해보세요.
              생성 결과는 실제 색감·핏과 다를 수 있어 참고용으로 사용합니다.
            </p>
            <div className="inline-flex items-center gap-[5px] mt-5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium w-fit">
              ✦ 참고용 AI 이미지
            </div>
          </div>
        </motion.div>

        {/* 예산 관리 */}
        <motion.div {...fadeInUp} className="bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(27,28,28,0.08)] transition-all duration-500">
          <div className="h-80 max-md:h-auto max-md:min-h-[260px] bg-gradient-to-br from-[#F0E8DD] to-[#E8DFD2] p-8 max-md:p-6 flex flex-col justify-center gap-4">
            <div className="font-serif-kr text-[13px] font-medium text-noir-soft mb-2">스마트 예산 관리</div>
            <div className="font-serif-kr text-[28px] max-md:text-[24px] font-light text-noir-800 mb-5">직접 입력한 예산</div>
            <div className="flex flex-col gap-3">
              {[
                { label: "스튜디오", width: "75%", color: "bg-rose-500", pct: "저장됨" },
                { label: "드레스", width: "45%", color: "bg-gold", pct: "저장됨" },
                { label: "메이크업", width: "60%", color: "bg-taupe-500", pct: "확인 전" },
                { label: "스냅/DVD", width: "30%", color: "bg-noir-soft", pct: "입력 전" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-[12px] font-medium w-[70px] text-right text-noir-soft">{item.label}</span>
                  <div className="flex-1 h-2 bg-white/60 rounded overflow-hidden">
                    <div className={`h-full rounded ${item.color}`} style={{ width: item.width }} />
                  </div>
                  <span className="text-[12px] text-taupe-500 w-12 font-medium">{item.pct}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-9 flex flex-col justify-center">
            <span className="font-display text-[14px] text-rose-500 font-semibold mb-4">03</span>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug">
              스마트 예산 관리
            </h3>
            <p className="text-[14px] leading-relaxed text-charcoal font-light">
              카테고리별 예산과 실제 지출을 함께 보고,
              포함·별도 여부를 확인할 항목을 놓치지 않게 정리합니다.
            </p>
            <div className="inline-flex items-center gap-[5px] mt-5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium w-fit">
              ✦ 포함·별도 항목 확인
            </div>
          </div>
        </motion.div>

        {/* 일정 관리 - 큰 카드 */}
        <motion.div {...fadeInUp} className="col-span-2 max-lg:col-span-1 bg-white rounded-3xl overflow-hidden border border-black/[0.04] hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(27,28,28,0.08)] transition-all duration-500 grid grid-cols-2 max-lg:grid-cols-1">
          <div className="bg-gradient-to-br from-ivory-50 to-ivory-deep p-10 flex flex-col justify-center">
            <div className="font-serif-kr text-[13px] font-medium text-noir-soft mb-6">예시 · 웨딩 타임라인</div>
            <div className="flex flex-col relative pl-6">
              <div className="absolute left-[6px] top-2 bottom-2 w-[1.5px] bg-gradient-to-b from-rose-500 via-gold-light to-platinum" />
              {[
                { dday: "완료", title: "스튜디오 계약 ✓", desc: "샘플 스튜디오 · 입력한 금액 저장", active: true },
                { dday: "진행", title: "드레스 투어", desc: "저장한 후보와 일정 확인", active: true },
                { dday: "D-90", title: "메이크업 리허설", desc: "예약 필요 · AI가 알림 예정", active: false },
                { dday: "D-60", title: "본식 최종 리허설", desc: "모든 업체 연락 · 최종 확인", active: false },
              ].map((item) => (
                <div key={item.dday} className="flex items-start gap-4 py-3 relative">
                  <div className={`absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full border-2 border-rose-500 ${item.active ? "bg-rose-500 shadow-[0_0_0_4px_rgba(121,82,82,0.2)]" : "bg-white"}`} />
                  <div>
                    <span className="text-[12px] text-rose-500 font-medium">{item.dday}</span>
                    <h5 className="text-[14px] font-medium mb-[3px]">{item.title}</h5>
                    <p className="text-[12px] text-taupe-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-9 flex flex-col justify-center">
            <span className="font-display text-[14px] text-rose-500 font-semibold mb-4">04</span>
            <h3 className="font-serif-kr text-[22px] font-normal mb-3 tracking-tight leading-snug">
              AI 일정 관리 & D-day 가이드
            </h3>
            <p className="text-[14px] leading-relaxed text-charcoal font-light">
              결혼일과 저장한 준비 상태를 기준으로 다음 할 일을 제안하고,
              두 분의 실제 일정에 맞게 항목과 알림을 직접 수정할 수 있습니다.
            </p>
            <div className="inline-flex items-center gap-[5px] mt-5 px-3.5 py-1.5 bg-[var(--rose-glow)] rounded-full text-[12px] text-rose-500 font-medium w-fit">
              ✦ D-day 맞춤 자동 플래닝
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
