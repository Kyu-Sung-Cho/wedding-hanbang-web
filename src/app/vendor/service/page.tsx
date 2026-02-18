"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Shield,
  Zap,
  BarChart3,
  Users,
  Clock,
  CreditCard,
  ChevronDown,
  FileText,
  ArrowLeft,
} from "lucide-react";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

const PROCESS_STEPS = [
  { step: "01", title: "업체 등록 신청", desc: "기본 정보와 사업자 인증 서류를 제출합니다.", icon: FileText, duration: "5분" },
  { step: "02", title: "심사 및 검증", desc: "웨딩한방 팀이 사업자 정보와 서비스 품질을 검증합니다.", icon: Shield, duration: "1~3일" },
  { step: "03", title: "승인 및 상품 등록", desc: "승인 후 상품/패키지와 타임슬롯을 직접 설정합니다.", icon: Zap, duration: "자유" },
  { step: "04", title: "고객 노출 시작", desc: "AI 매칭을 통해 예산·취향에 맞는 고객이 연결됩니다.", icon: Users, duration: "즉시" },
];

const PRICING_FEATURES = [
  { label: "가입비", value: "무료", highlight: true },
  { label: "월 이용료", value: "무료 (베타 기간)", highlight: true },
  { label: "예약 수수료", value: "건당 5%", highlight: false },
  { label: "정산 주기", value: "주 1회", highlight: false },
  { label: "최소 계약 기간", value: "없음", highlight: true },
  { label: "해지 수수료", value: "없음", highlight: true },
];

const BENEFITS = [
  { icon: Users, title: "AI 고객 매칭", desc: "예산과 취향에 딱 맞는 고객을 자동으로 연결해드립니다." },
  { icon: BarChart3, title: "데이터 인사이트", desc: "경쟁사 비교, 트렌드 분석, 고객 선호도 리포트를 제공합니다." },
  { icon: Clock, title: "실시간 예약 관리", desc: "캐치테이블 스타일의 타임슬롯으로 예약을 효율적으로 관리합니다." },
  { icon: CreditCard, title: "투명한 비용", desc: "숨겨진 비용 없이 합리적인 수수료만 적용됩니다." },
  { icon: Zap, title: "카테고리별 상품 관리", desc: "업종에 맞는 전용 상품 관리 시스템으로 패키지를 쉽게 등록합니다." },
  { icon: Shield, title: "사전 고객 인사이트", desc: "상담 전 고객의 예산, 선호 스타일, 추가 구매 의향을 미리 파악합니다." },
];

const FAQ = [
  { q: "어떤 업종이 등록할 수 있나요?", a: "웨딩 스튜디오, 드레스샵, 메이크업, 예식장, 한복, 예물, 신혼여행 등 모든 웨딩 관련 업종이 등록 가능합니다." },
  { q: "심사는 얼마나 걸리나요?", a: "사업자등록증 확인 후 평균 1~3 영업일 내에 심사가 완료됩니다. 서류 불비 시 보완 요청이 있을 수 있습니다." },
  { q: "수수료는 어떻게 책정되나요?", a: "예약 건당 5%의 수수료만 적용됩니다. 가입비, 월 이용료, 해지 수수료는 없습니다. 베타 기간에는 수수료도 무료입니다." },
  { q: "상품은 어떻게 등록하나요?", a: "승인 후 업체 포털에서 카테고리에 맞는 전용 상품 등록 폼이 제공됩니다. 스튜디오는 촬영 패키지, 드레스샵은 대여 상품 등 각 업종에 최적화되어 있습니다." },
  { q: "기존 다른 플랫폼과 동시에 사용할 수 있나요?", a: "네, 타 플랫폼과 동시에 사용 가능합니다. 독점 계약은 요구하지 않습니다." },
  { q: "중도 해지는 가능한가요?", a: "네, 언제든지 해지 가능합니다. 해지 수수료는 없으며, 진행 중인 예약 건의 정산 완료 후 해지 처리됩니다." },
];

export default function VendorServicePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);

  return (
    <div className="min-h-screen bg-ivory-50">
      {/* 헤더 */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/business" className="flex items-center gap-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            파트너 랜딩으로
          </Link>
          <Link href="/vendor/register" className="px-4 py-2 bg-noir-800 text-white rounded-lg text-[13px] font-medium hover:bg-noir-soft transition-colors">
            업체 등록하기
          </Link>
        </div>
      </nav>

      {/* 히어로 */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-noir-800 to-noir-soft" />
        <div className="relative max-w-[1100px] mx-auto px-6 py-20 text-center">
          <motion.div {...fadeIn} transition={{ duration: 0.6 }}>
            <span className="inline-block px-4 py-1.5 rounded-full bg-rose-500/20 text-rose-light text-[12px] font-medium mb-6">
              Wedding Business Partner
            </span>
            <h1 className="font-serif-kr text-[32px] md:text-[42px] font-normal text-white leading-tight mb-4">
              웨딩한방 파트너 서비스 안내
            </h1>
            <p className="text-[15px] text-white/60 font-light max-w-[600px] mx-auto leading-relaxed">
              AI가 예산과 취향이 맞는 고객을 찾아 연결해드립니다.<br />
              합리적인 수수료로 더 많은 고객을 만나보세요.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-[1100px] mx-auto px-6">
        {/* 입점 절차 */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">입점 절차</h2>
            <p className="text-[14px] text-taupe-500 font-light">간단한 4단계로 파트너가 될 수 있습니다</p>
          </motion.div>
          <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-sm:grid-cols-1">
            {PROCESS_STEPS.map((s, i) => (
              <motion.div key={s.step} {...fadeIn} transition={{ duration: 0.5, delay: i * 0.08 }} className="bg-white rounded-2xl border border-black/[0.04] p-6 text-center relative">
                {i < 3 && <ArrowRight className="absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-taupe-400 max-md:hidden z-10" />}
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-[11px] text-rose-500 font-medium">{s.step}</span>
                <h3 className="text-[15px] font-medium text-noir-800 mt-1 mb-2">{s.title}</h3>
                <p className="text-[12px] text-taupe-500 font-light leading-relaxed mb-3">{s.desc}</p>
                <span className="inline-block px-2.5 py-1 rounded-full bg-ivory-warm text-[11px] text-taupe-500 font-medium">{s.duration}</span>
              </motion.div>
            ))}
          </div>
        </section>

        {/* 요금제 */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">투명한 요금 구조</h2>
            <p className="text-[14px] text-taupe-500 font-light">숨겨진 비용 없이, 성과가 있을 때만 수수료가 발생합니다</p>
          </motion.div>
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="max-w-[500px] mx-auto bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
            <div className="bg-gradient-to-r from-noir-800 to-noir-soft p-6 text-center">
              <span className="text-[12px] text-rose-light font-medium">BETA PARTNER</span>
              <h3 className="font-display text-[36px] font-light text-white mt-1">무료</h3>
              <p className="text-[13px] text-white/60 font-light mt-1">베타 기간 동안 모든 수수료 면제</p>
            </div>
            <div className="p-6">
              {PRICING_FEATURES.map((f) => (
                <div key={f.label} className="flex items-center justify-between py-3 border-b border-black/[0.03] last:border-0">
                  <span className="text-[14px] text-noir-800">{f.label}</span>
                  <span className={`text-[14px] font-medium ${f.highlight ? "text-[#2E7D5A]" : "text-noir-800"}`}>
                    {f.highlight && <Check className="w-3.5 h-3.5 inline mr-1" />}
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* 혜택 */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">파트너 혜택</h2>
            <p className="text-[14px] text-taupe-500 font-light">업체 성장을 위한 다양한 도구를 제공합니다</p>
          </motion.div>
          <div className="grid grid-cols-3 gap-4 max-md:grid-cols-2 max-sm:grid-cols-1">
            {BENEFITS.map((b, i) => (
              <motion.div key={b.title} {...fadeIn} transition={{ duration: 0.5, delay: i * 0.06 }} className="bg-white rounded-2xl border border-black/[0.04] p-6">
                <div className="w-10 h-10 rounded-xl bg-noir-800 flex items-center justify-center mb-4">
                  <b.icon className="w-5 h-5 text-rose-light" />
                </div>
                <h3 className="text-[15px] font-medium text-noir-800 mb-2">{b.title}</h3>
                <p className="text-[13px] text-taupe-500 font-light leading-relaxed">{b.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">자주 묻는 질문</h2>
          </motion.div>
          <div className="max-w-[700px] mx-auto space-y-2">
            {FAQ.map((faq, i) => (
              <motion.div key={i} {...fadeIn} transition={{ duration: 0.4, delay: i * 0.04 }} className="bg-white rounded-xl border border-black/[0.04] overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                  <span className="text-[14px] font-medium text-noir-800 pr-4">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-taupe-400 flex-shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-[13px] text-taupe-500 font-light leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* 약관 동의 + 등록 CTA */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="max-w-[600px] mx-auto">
            <div className="bg-white rounded-2xl border border-black/[0.04] p-8">
              <h2 className="font-serif-kr text-[20px] text-noir-800 text-center mb-6">파트너 등록을 시작하세요</h2>
              <div className="space-y-3 mb-6">
                <label className="flex items-start gap-3 p-4 rounded-xl bg-ivory-50 cursor-pointer hover:bg-ivory-warm transition-colors">
                  <input type="checkbox" checked={agreedTerms} onChange={(e) => setAgreedTerms(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-rose-500" />
                  <div>
                    <span className="text-[14px] font-medium text-noir-800">파트너 이용약관 동의</span>
                    <span className="text-[11px] text-rose-500 ml-1">(필수)</span>
                    <p className="text-[12px] text-taupe-400 font-light mt-0.5">서비스 이용 조건, 수수료 정책, 정산 규정 등을 포함합니다.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-4 rounded-xl bg-ivory-50 cursor-pointer hover:bg-ivory-warm transition-colors">
                  <input type="checkbox" checked={agreedPrivacy} onChange={(e) => setAgreedPrivacy(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-rose-500" />
                  <div>
                    <span className="text-[14px] font-medium text-noir-800">개인정보 처리방침 동의</span>
                    <span className="text-[11px] text-rose-500 ml-1">(필수)</span>
                    <p className="text-[12px] text-taupe-400 font-light mt-0.5">사업자 정보 및 대표자 개인정보의 수집·이용에 동의합니다.</p>
                  </div>
                </label>
              </div>
              <Link
                href={agreedTerms && agreedPrivacy ? "/vendor/register" : "#"}
                onClick={(e) => { if (!agreedTerms || !agreedPrivacy) e.preventDefault(); }}
                className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-[14px] font-medium transition-all ${
                  agreedTerms && agreedPrivacy
                    ? "bg-gradient-to-r from-rose-500 to-gold text-white hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)]"
                    : "bg-taupe-400/20 text-taupe-400 cursor-not-allowed"
                }`}
              >
                업체 등록 신청하기 <ArrowRight className="w-4 h-4" />
              </Link>
              {(!agreedTerms || !agreedPrivacy) && (
                <p className="text-[12px] text-taupe-400 text-center mt-3">약관에 모두 동의해야 등록을 진행할 수 있습니다.</p>
              )}
            </div>
          </motion.div>
        </section>
      </div>

      {/* 하단 문의 */}
      <div className="bg-noir-800 py-10 text-center">
        <p className="text-[14px] text-white/60 font-light mb-2">입점 관련 문의</p>
        <a href="mailto:partner@hanbang.ai" className="text-[15px] text-rose-light font-medium hover:text-white transition-colors">
          partner@hanbang.ai
        </a>
      </div>
    </div>
  );
}
