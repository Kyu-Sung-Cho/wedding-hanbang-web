"use client";

import Image from "next/image";

export default function CustomerLogoShowcase() {
  return (
    <section className="relative bg-noir-800 py-24 md:py-32 overflow-hidden">
      {/* 배경 그라데이션 */}
      <div className="absolute inset-0">
        <div className="absolute top-[-30%] left-[50%] -translate-x-1/2 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(196,150,126,0.1),transparent_60%)] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] rounded-full" />
      </div>

      {/* 상단 그라데이션 라인 */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 flex flex-col items-center">
        {/* 로고 이미지 */}
        <div className="w-[120px] h-[120px] md:w-[160px] md:h-[160px] mb-6 relative">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-500/20 to-gold/20 blur-2xl" />
          <Image
            src="/images/logo-512.png"
            alt="웨딩한방 로고"
            width={160}
            height={160}
            className="relative object-contain drop-shadow-[0_4px_24px_rgba(196,150,126,0.3)]"
            priority
          />
        </div>

        {/* 브랜드명 */}
        <h2 className="font-serif-kr text-[clamp(24px,4vw,36px)] font-light tracking-tight bg-gradient-to-r from-rose-500 via-gold to-rose-500 bg-clip-text text-transparent mb-4">
          웨딩한방
        </h2>

        {/* 태그라인 */}
        <p className="text-[14px] md:text-[15px] text-white/40 font-light tracking-wide">
          AI가 이끄는 새로운 결혼 준비
        </p>
      </div>

      {/* 하단 그라데이션 라인 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </section>
  );
}
