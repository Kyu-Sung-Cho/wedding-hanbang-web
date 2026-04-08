"use client";

import { motion } from "framer-motion";

const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.8 },
};

export default function VirtualFitting() {
  return (
    <section id="fitting" className="bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep py-[140px] px-[60px] relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="grid grid-cols-2 gap-20 items-center max-w-[1200px] mx-auto max-lg:grid-cols-1 max-lg:gap-12">
        {/* 폰 비주얼 */}
        <motion.div {...fadeInUp} className="relative h-[520px] flex items-center justify-center max-md:h-[420px]">
          <div className="w-[280px] h-[560px] bg-noir-800 rounded-[44px] p-3 shadow-[0_40px_80px_rgba(0,0,0,0.15)] relative z-10 max-md:w-[220px] max-md:h-[440px] max-md:rounded-[36px]">
            <div className="w-full h-full bg-gradient-to-b from-ivory-deep to-ivory-50 rounded-[34px] overflow-hidden flex flex-col items-center justify-center relative">
              <div className="w-[120px] h-[200px] bg-gradient-to-b from-rose-pale to-rose-light rounded-[35%_35%_45%_45%/25%_25%_40%_40%]" />
              <div className="absolute left-5 right-5 h-[2px] bg-gradient-to-r from-transparent via-rose-500 to-transparent animate-[phoneScan_4s_ease-in-out_infinite] shadow-[0_0_15px_rgba(196,150,126,0.4)]" />
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-noir-800/85 backdrop-blur-[10px] text-white px-5 py-2.5 rounded-xl text-[12px] font-medium whitespace-nowrap flex items-center gap-2">
                ✦ AI 분석 중 · 체형 매칭
              </div>
            </div>
          </div>

          {/* 플로팅 카드 1 */}
          <div className="absolute top-[60px] right-[-20px] max-md:right-2 max-md:top-4 bg-white rounded-2xl px-5 py-4 max-md:px-3.5 max-md:py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-20 animate-[floatCard_6s_ease-in-out_infinite]">
            <div className="text-[11px] text-taupe-500 font-medium mb-1.5">스타일 매칭</div>
            <div className="text-[16px] max-md:text-[14px] font-semibold text-noir-800 font-serif-kr">A라인 · 내추럴</div>
            <div className="text-[11px] text-rose-500 mt-1">98% 적합도</div>
          </div>

          {/* 플로팅 카드 2 */}
          <div className="absolute bottom-20 left-[-30px] max-md:left-2 max-md:bottom-10 bg-white rounded-2xl px-5 py-4 max-md:px-3.5 max-md:py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-20 animate-[floatCard_6s_ease-in-out_infinite_-3s]">
            <div className="text-[11px] text-taupe-500 font-medium mb-1.5">절약된 시간</div>
            <div className="text-[16px] max-md:text-[14px] font-semibold text-noir-800 font-serif-kr">약 8시간</div>
            <div className="text-[11px] text-rose-500 mt-1">매장 방문 대비</div>
          </div>
        </motion.div>

        {/* 텍스트 */}
        <motion.div {...fadeInUp}>
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
            <span className="w-5 h-px bg-rose-500" />
            AI Virtual Fitting
          </div>
          <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
            드레스, 이제
            <br />
            집에서 입어보세요
          </h2>
          <p className="text-[16px] leading-relaxed text-charcoal font-light max-w-[520px] mb-8">
            Decart AI의 최신 기술로 당신의 사진에 드레스를 합성합니다.
            실시간 비디오 피팅도 곧 지원됩니다.
          </p>
          <div className="flex flex-col gap-5">
            {[
              { num: "1", title: "전신 사진 업로드", desc: "밝은 조명에서 정면 촬영한 사진을 올려주세요" },
              { num: "2", title: "드레스 선택", desc: "다양한 스타일의 드레스를 자유롭게 골라보세요" },
              { num: "3", title: "AI 피팅 결과 확인", desc: "30초 만에 드레스를 입은 모습을 확인하세요" },
            ].map((step) => (
              <div key={step.num} className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-[var(--rose-glow)] text-rose-500 flex items-center justify-center text-[13px] font-semibold shrink-0">
                  {step.num}
                </div>
                <div>
                  <h5 className="text-[15px] font-medium mb-1">{step.title}</h5>
                  <p className="text-[13px] text-taupe-500 leading-normal font-light">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
