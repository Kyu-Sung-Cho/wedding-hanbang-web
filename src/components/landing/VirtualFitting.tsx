"use client";

import { motion } from "framer-motion";

const steps = [
  { num: 1, title: "전신 사진 업로드", desc: "밝은 조명에서 정면 촬영한 사진을 올려주세요" },
  { num: 2, title: "드레스 선택", desc: "다양한 스타일의 드레스를 자유롭게 골라보세요" },
  { num: 3, title: "AI 피팅 결과 확인", desc: "30초 만에 드레스를 입은 모습을 확인하세요" },
];

export default function VirtualFitting() {
  return (
    <section
      id="fitting"
      className="relative overflow-hidden bg-gradient-to-b from-ivory-50 via-ivory-warm to-ivory-deep px-5 py-[100px] md:px-[60px] md:py-[140px]"
    >
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 md:grid-cols-2 md:gap-20">
        {/* 비주얼 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative flex h-[420px] items-center justify-center md:h-[520px]"
        >
          {/* 폰 프레임 */}
          <div className="relative z-[2] w-[220px] rounded-[36px] bg-noir-800 p-3 shadow-[0_40px_80px_rgba(0,0,0,0.15)] md:w-[280px] md:rounded-[44px]">
            <div className="relative flex h-[440px] flex-col items-center justify-center overflow-hidden rounded-[26px] bg-gradient-to-b from-ivory-deep to-[#FDF9F5] md:h-[536px] md:rounded-[34px]">
              <div className="h-[200px] w-[120px] rounded-[35%_35%_45%_45%/25%_25%_40%_40%] bg-gradient-to-b from-rose-pale to-rose-light" />
              <div className="absolute left-5 right-5 h-0.5 animate-[phoneScan_4s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,var(--color-rose-500),transparent)] shadow-[0_0_15px_rgba(196,150,126,0.4)]" />
              <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl bg-noir-800/85 px-5 py-2.5 text-xs font-medium text-white backdrop-blur-[10px]">
                ✦ AI 분석 중 · 체형 매칭
              </div>
            </div>
          </div>

          {/* 플로팅 카드 */}
          <div className="absolute top-[60px] right-0 z-[3] animate-[floatCard_6s_ease-in-out_infinite] rounded-2xl bg-white p-4 shadow-[0_8px_32px_rgba(0,0,0,0.08)] md:-right-5">
            <div className="mb-1.5 text-[11px] font-medium text-taupe-500">스타일 매칭</div>
            <div className="font-serif text-base font-semibold text-noir-800">A라인 · 내추럴</div>
            <div className="mt-1 text-[11px] text-rose-500">98% 적합도</div>
          </div>
          <div className="absolute bottom-20 -left-0 z-[3] animate-[floatCard_6s_ease-in-out_infinite_-3s] rounded-2xl bg-white p-4 shadow-[0_8px_32px_rgba(0,0,0,0.08)] md:-left-[30px]">
            <div className="mb-1.5 text-[11px] font-medium text-taupe-500">절약된 시간</div>
            <div className="font-serif text-base font-semibold text-noir-800">약 8시간</div>
            <div className="mt-1 text-[11px] text-rose-500">매장 방문 대비</div>
          </div>
        </motion.div>

        {/* 텍스트 */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
            <span className="h-px w-5 bg-rose-500" />
            AI Virtual Fitting
          </div>
          <h2 className="mb-5 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em]">
            드레스, 이제
            <br />
            집에서 입어보세요
          </h2>
          <p className="mb-8 max-w-[520px] text-base font-light leading-[1.75] text-charcoal">
            Decart AI의 최신 기술로 당신의 사진에 드레스를 합성합니다. 실시간 비디오 피팅도 곧 지원됩니다.
          </p>
          <div className="flex flex-col gap-5">
            {steps.map((step) => (
              <div key={step.num} className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-glow text-[13px] font-semibold text-rose-500">
                  {step.num}
                </div>
                <div>
                  <h5 className="mb-1 text-[15px] font-medium">{step.title}</h5>
                  <p className="text-[13px] font-light leading-[1.5] text-taupe-500">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
