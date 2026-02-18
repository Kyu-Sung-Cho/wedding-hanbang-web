"use client";

import { motion } from "framer-motion";
import { ShopConfig } from "./data/types";

interface Props {
  config: ShopConfig;
  hasDraft: boolean;
  onStart: () => void;
  onResume: () => void;
}

export default function SurveyIntro({ config, hasDraft, onStart, onResume }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-ivory-50 to-ivory-warm flex items-center justify-center px-5 py-12">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-[560px] w-full"
      >
        {/* 헤더 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.15em] uppercase text-rose-500 font-medium mb-4">
            <span className="w-4 h-px bg-rose-500" />
            B2B Partnership
            <span className="w-4 h-px bg-rose-500" />
          </div>
          <h1 className="font-serif-kr text-[clamp(24px,4vw,36px)] font-light leading-[1.4] tracking-tight mb-4">
            웨딩 {config.shopTypeName}
            <br />
            파트너십 설문
          </h1>
          <p className="text-[14px] text-charcoal font-light leading-relaxed">
            AI 웨딩 플랫폼 &lsquo;웨딩한방&rsquo;이
            <br className="md:hidden" />
            {" "}{config.shopTypeName} 사장님께 여쭤봅니다
          </p>
        </div>

        {/* 공감 메시지 */}
        <div className="bg-white rounded-2xl border border-platinum p-6 mb-5">
          <p className="text-[15px] text-noir-800 font-medium mb-4 leading-relaxed">
            사장님들의 소중한 의견을 듣고, 정말 도움이 되는 서비스를 만들고 싶습니다.
          </p>
          <p className="text-[13px] text-charcoal font-light leading-relaxed">
            아래 설문에 응답해주시면, 사장님께 실질적으로 도움이 되는 기능을 우선 개발하는 데 반영하겠습니다.
          </p>
        </div>

        {/* Pain Points */}
        <div className="bg-noir-800 rounded-2xl p-6 mb-3">
          <p className="text-[12px] text-rose-light font-medium tracking-wide mb-3">
            이런 고민, 하고 계시죠?
          </p>
          <div className="flex flex-col gap-2.5">
            {config.painPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-rose-500 text-[14px] mt-0.5 shrink-0">&ldquo;</span>
                <p className="text-[13px] text-white/80 font-light leading-relaxed">
                  {point}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Solutions */}
        <div className="bg-[var(--rose-glow)] rounded-2xl p-6 mb-5 border border-rose-pale/30">
          <p className="text-[12px] text-rose-600 font-medium tracking-wide mb-3">
            웨딩한방이 이렇게 도와드릴 수 있어요
          </p>
          <div className="flex flex-col gap-2.5">
            {config.solutions.map((solution, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-rose-500 text-[13px] mt-0.5 shrink-0">&#x2713;</span>
                <p className="text-[13px] text-noir-800 font-light leading-relaxed">
                  {solution}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Extra Box (드레스/메이크업) */}
        {config.extraBox && (
          <div className="bg-ivory-deep rounded-2xl p-5 mb-5 border border-platinum">
            <p className="text-[13px] text-charcoal font-light leading-relaxed">
              {config.extraBox}
            </p>
          </div>
        )}

        {/* 안내 */}
        <div className="flex items-center justify-center gap-6 mb-8 text-[13px] text-taupe-500">
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
            약 5분 소요
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            익명 처리
          </span>
        </div>

        {/* 버튼 */}
        <div className="flex flex-col gap-3">
          <button
            onClick={hasDraft ? onResume : onStart}
            className="w-full py-4 rounded-full bg-noir-800 text-white text-[15px] font-medium hover:bg-noir-soft transition-colors"
          >
            {hasDraft ? "이어서 하기" : "설문 시작하기"}
          </button>
          {hasDraft && (
            <button
              onClick={onStart}
              className="w-full py-3 rounded-full border border-platinum text-[14px] text-taupe-500 hover:border-taupe-400 transition-colors"
            >
              처음부터 다시 하기
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
