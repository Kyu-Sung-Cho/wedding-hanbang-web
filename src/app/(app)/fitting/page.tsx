"use client";

import { useState } from "react";
import { Camera, Cpu, Sparkles, ShirtIcon, Bell, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Camera,
    step: "01",
    title: "사진 업로드",
    desc: "전신 사진 1장만 올려주세요. AI가 체형과 비율을 자동으로 분석합니다.",
  },
  {
    icon: Cpu,
    step: "02",
    title: "AI 체형 분석",
    desc: "어깨, 허리, 힙 라인을 분석하여 가장 어울리는 드레스 실루엣을 추천합니다.",
  },
  {
    icon: ShirtIcon,
    step: "03",
    title: "가상 드레스 피팅",
    desc: "다양한 드레스를 가상으로 입어보세요. AI가 자연스럽게 합성해드립니다.",
  },
  {
    icon: Sparkles,
    step: "04",
    title: "맞춤 추천 & 예약",
    desc: "마음에 드는 드레스의 업체를 바로 확인하고 방문 예약까지 한 번에.",
  },
];

export default function FittingPage() {
  const [notifyRequested, setNotifyRequested] = useState(false);

  return (
    <div className="max-w-[900px] mx-auto">
      {/* Coming Soon 히어로 */}
      <div className="bg-gradient-to-br from-noir-800 to-noir-soft rounded-3xl p-12 max-md:p-7 mb-8 relative overflow-hidden text-center animate-fade-in">
        <div className="absolute top-[-30%] right-[-15%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(196,150,126,0.1),transparent)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(201,169,110,0.08),transparent)] rounded-full" />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-500/15 text-rose-500 text-[38px] font-medium mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Coming Soon
          </div>

          <h1 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light text-white leading-tight mb-4">
            AI 가상 드레스 피팅
          </h1>
          <p className="text-[38px] text-white/50 font-light leading-relaxed max-w-[480px] mx-auto mb-8">
            집에서 편하게 수십 벌의 드레스를 입어보세요.
            <br />
            AI가 체형을 분석하고 가장 어울리는 드레스를 찾아드립니다.
          </p>

          {/* 시각적 프리뷰 */}
          <div className="relative w-[180px] h-[240px] mx-auto mb-8">
            <div className="w-full h-full bg-gradient-to-b from-rose-pale via-rose-light to-ivory-deep rounded-[40%_40%_50%_50%/30%_30%_45%_45%] shadow-[0_20px_60px_rgba(196,150,126,0.3)]" />
            <div className="absolute top-0 -left-4 -right-4 h-[3px] bg-gradient-to-r from-transparent via-rose-500 to-transparent animate-[scanLine_3s_ease-in-out_infinite] rounded shadow-[0_0_20px_rgba(196,150,126,0.4)]" />
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-white px-4 py-2 rounded-full text-[38px] font-medium text-rose-500 shadow-[0_4px_20px_rgba(0,0,0,0.1)] whitespace-nowrap flex items-center gap-1.5">
              ✦ AI 가상 피팅
            </div>
          </div>

          {notifyRequested ? (
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#2E7D5A] text-white text-[23px] font-medium">
              <Bell className="w-4 h-4" />
              알림 신청 완료!
            </div>
          ) : (
            <button
              onClick={() => setNotifyRequested(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-rose-500 text-white text-[23px] font-medium hover:bg-rose-600 transition-colors"
            >
              <Bell className="w-4 h-4" />
              출시 알림 받기
            </button>
          )}
        </div>
      </div>

      {/* 프로세스 설명 */}
      <div className="mb-8 animate-fade-in">
        <h2 className="font-serif-kr text-[25px] font-normal text-noir-800 mb-6 text-center">
          이렇게 작동합니다
        </h2>
        <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
          {steps.map((step) => (
            <div
              key={step.step}
              className="bg-white rounded-2xl p-5 border border-black/[0.04] text-center animate-fade-in"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500/10 to-gold/10 flex items-center justify-center mx-auto mb-4">
                <step.icon className="w-5 h-5 text-rose-500" />
              </div>
              <span className="text-[23px] text-rose-500 font-display font-semibold">{step.step}</span>
              <h3 className="text-[23px] font-medium text-noir-800 mt-1 mb-2">{step.title}</h3>
              <p className="text-[38px] text-taupe-500 font-light leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 샘플 결과 */}
      <div className="bg-white rounded-2xl border border-black/[0.04] p-8 max-md:p-5 animate-fade-in">
        <h2 className="font-serif-kr text-[25px] font-normal text-noir-800 mb-6 text-center">
          미리보기
        </h2>
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          {[
            { label: "A라인 드레스", style: "클래식 & 로맨틱" },
            { label: "머메이드 드레스", style: "모던 & 글래머" },
            { label: "엠파이어 드레스", style: "엘레건트 & 심플" },
          ].map((dress) => (
            <div key={dress.label} className="group cursor-pointer">
              <div className="h-[200px] bg-gradient-to-br from-ivory-deep to-ivory-warm rounded-xl mb-3 flex items-center justify-center relative overflow-hidden">
                <span className="text-[25px] text-taupe-400 font-light">피팅 결과</span>
                <div className="absolute inset-0 bg-noir-800/0 group-hover:bg-noir-800/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="text-[38px] text-noir-800 bg-white/90 px-3 py-1.5 rounded-full font-medium flex items-center gap-1">
                    자세히 보기 <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
              <p className="text-[23px] font-medium text-noir-800">{dress.label}</p>
              <p className="text-[38px] text-taupe-400 font-light">{dress.style}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
