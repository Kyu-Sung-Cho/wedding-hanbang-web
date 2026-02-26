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
  CalendarDays,
  AlertCircle,
} from "lucide-react";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

const PROCESS_STEPS = [
  { step: "01", title: "업체 등록 신청", desc: "기본 정보와 사업자 인증 서류를 제출합니다.", icon: FileText, duration: "5분" },
  { step: "02", title: "심사 및 검증", desc: "웨딩한방 팀이 사업자 정보와 서비스 품질을 검증합니다.", icon: Shield, duration: "1~3일" },
  { step: "03", title: "승인 및 상품 등록", desc: "승인 후 상품/패키지와 타임슬롯을 직접 설정합니다.", icon: Zap, duration: "자유" },
  { step: "04", title: "고객 노출 시작", desc: "AI 매칭을 통해 예산·취향에 맞는 고객이 연결됩니다.", icon: Users, duration: "즉시" },
];

/* ── 정식 요금 vs 베타 파트너 비교 ── */
const PRICING_COMPARISON = [
  { label: "월 이용료", regular: "199,000원 / 월", beta: "0원 / 월", highlight: true },
  { label: "예약 수수료", regular: "건당 10%", beta: "건당 7%", highlight: true },
  { label: "정산 주기", regular: "주 1회 (매주 월요일)", beta: "주 1회 (동일)", highlight: false },
  { label: "최소 계약 기간", regular: "6개월", beta: "없음", highlight: true },
  { label: "해지 수수료", regular: "없음", beta: "없음", highlight: false },
];

const BENEFITS = [
  { icon: Users, title: "AI 고객 매칭", desc: "예산과 취향에 딱 맞는 고객을 자동으로 연결해드립니다." },
  { icon: BarChart3, title: "데이터 인사이트", desc: "업종 평균 분석, 트렌드 분석, 고객 선호도 리포트를 제공합니다." },
  { icon: Clock, title: "실시간 예약 관리", desc: "캐치테이블 스타일의 타임슬롯으로 예약을 효율적으로 관리합니다." },
  { icon: CreditCard, title: "투명한 비용", desc: "모든 수수료와 요금을 사전에 공개하며, 숨겨진 비용은 일절 없습니다." },
  { icon: Zap, title: "카테고리별 상품 관리", desc: "업종에 맞는 전용 상품 관리 시스템으로 패키지를 쉽게 등록합니다." },
  { icon: Shield, title: "사전 고객 인사이트", desc: "상담 전 고객의 예산, 선호 스타일, 추가 구매 의향을 미리 파악합니다." },
];

const FAQ = [
  {
    q: "어떤 업종이 등록할 수 있나요?",
    a: "현재 베타 기간에는 스드메(스튜디오, 드레스, 메이크업) 업종만 등록 가능합니다. 정식 출시 이후 예식장, 한복, 예물, 신혼여행 등으로 확대할 예정입니다.",
  },
  {
    q: "심사는 얼마나 걸리나요?",
    a: "사업자등록증 확인 후 평균 1~3 영업일 내에 심사가 완료됩니다. 서류 불비 시 보완 요청이 있을 수 있습니다.",
  },
  {
    q: "베타 기간은 정확히 언제부터 언제까지인가요?",
    a: "2026년 3월 1일부터 5월 31일까지 총 3개월입니다. 이 기간에 가입하신 모든 파트너는 월 이용료(199,000원/월 × 3개월 = 597,000원)가 면제되고, 예약 수수료도 정식 10%에서 7%로 할인 적용됩니다.",
  },
  {
    q: "베타 종료 후 요금은 어떻게 되나요?",
    a: "2026년 6월 1일부터 정식 요금이 적용됩니다. 월 이용료 199,000원/월과 예약 건당 10% 수수료가 부과됩니다. 단, 베타 파트너에게는 정식 전환 시 별도 할인 혜택을 제공할 예정이며, 정식 전환 최소 1개월 전(5월 1일 이전)에 사전 안내드립니다.",
  },
  {
    q: "정산은 구체적으로 어떻게 이루어지나요?",
    a: "매주 월요일에 전주(월~일) 확정된 예약 건의 정산이 진행됩니다. 고객 결제 금액에서 수수료(정식: 10%, 베타 기간: 7%)를 제외한 금액이 등록된 사업자 계좌로 입금됩니다. 예를 들어 베타 기간에 100만원 결제 시 수수료 7만원을 제외한 93만원이 정산됩니다.",
  },
  {
    q: "기존 다른 플랫폼과 동시에 사용할 수 있나요?",
    a: "네, 타 플랫폼과 동시에 사용 가능합니다. 독점 계약은 요구하지 않습니다.",
  },
  {
    q: "중도 해지는 가능한가요?",
    a: "네, 베타 기간 중에도 언제든 해지 가능합니다. 해지 수수료는 없으며, 진행 중인 예약 건의 정산 완료 후 해지 처리됩니다. 최소 계약 기간이 없으므로 부담 없이 이용하실 수 있습니다.",
  },
];

export default function VendorServicePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-ivory-50">
      {/* 헤더 */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/business" className="flex items-center gap-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            파트너 랜딩으로
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/vendor/login" className="px-4 py-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
              기존 업체 로그인
            </Link>
            <Link href="/vendor/register" className="px-4 py-2 bg-noir-800 text-white rounded-lg text-[13px] font-medium hover:bg-noir-soft transition-colors">
              업체 등록하기
            </Link>
          </div>
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

        {/* 요금제 — 정식 vs 베타 카드 2장 */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-5">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">투명한 요금 구조</h2>
            <p className="text-[14px] text-taupe-500 font-light">숨겨진 비용 없이, 모든 요금을 사전에 명확히 안내합니다</p>
          </motion.div>

          {/* 베타 파트너 정의 */}
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="max-w-[820px] mx-auto mb-8">
            <div className="rounded-2xl border border-rose-500/15 bg-[var(--rose-glow)] p-6">
              <h3 className="text-[15px] font-medium text-noir-800 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[10px] font-semibold">BETA</span>
                베타 파트너란?
              </h3>
              <p className="text-[13px] text-taupe-500 font-light leading-relaxed mb-3">
                2026년 3월~5월 베타 기간에 가입한 초기 파트너 업체입니다. 서비스 초기에 함께해 주시는 대표님들께
                월 이용료 면제와 예약 수수료 할인(10% → 7%) 혜택을 드리며, 서비스 개선에 직접 의견을 반영하실 수 있습니다.
              </p>
              <div className="flex flex-wrap gap-3 text-[12px]">
                <span className="px-3 py-1 rounded-full bg-white border border-black/[0.06] text-noir-800 font-medium">월 이용료 0원</span>
                <span className="px-3 py-1 rounded-full bg-white border border-black/[0.06] text-noir-800 font-medium">수수료 7%</span>
                <span className="px-3 py-1 rounded-full bg-white border border-black/[0.06] text-noir-800 font-medium">최소 계약 없음</span>
                <span className="px-3 py-1 rounded-full bg-white border border-black/[0.06] text-noir-800 font-medium">정식 전환 시 추가 할인</span>
              </div>
            </div>
          </motion.div>

          {/* 베타 기간 배지 */}
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.08 }} className="flex items-center justify-center gap-2 mb-10">
            <CalendarDays className="w-4 h-4 text-rose-500" />
            <span className="text-[14px] font-medium text-noir-800">
              베타 기간: 2026년 3월 1일 ~ 5월 31일{" "}
              <span className="text-rose-500 font-semibold">(3개월)</span>
            </span>
          </motion.div>

          {/* 카드 2장 나란히 */}
          <div className="max-w-[820px] mx-auto grid grid-cols-2 gap-5 max-md:grid-cols-1 max-md:max-w-[420px]">

            {/* ── 정식 요금 카드 ── */}
            <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="px-7 pt-7 pb-5 border-b border-black/[0.04]">
                <span className="text-[11px] tracking-[0.15em] uppercase text-taupe-400 font-medium">Standard</span>
                <h3 className="font-serif-kr text-[22px] text-noir-800 mt-1">정식 요금</h3>
                <p className="text-[12px] text-taupe-400 font-light mt-1">베타 종료 후 적용되는 요금</p>
              </div>
              {/* 가격 리스트 */}
              <div className="px-7 py-5 flex-1 flex flex-col gap-4">
                {PRICING_COMPARISON.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-[13px] text-taupe-500 font-light">{item.label}</span>
                    <span className="text-[14px] text-noir-800 font-medium">{item.regular}</span>
                  </div>
                ))}
              </div>
              {/* 하단 */}
              <div className="px-7 py-5 bg-ivory-50 border-t border-black/[0.04]">
                <p className="text-[12px] text-taupe-400 font-light leading-relaxed text-center">
                  2026년 6월 1일부터 적용
                </p>
              </div>
            </motion.div>

            {/* ── 베타 파트너 카드 (다크 프리미엄) ── */}
            <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.2 }} className="relative rounded-2xl overflow-hidden flex flex-col">
              {/* 배경 */}
              <div className="absolute inset-0 bg-gradient-to-br from-noir-800 via-noir-900 to-noir-800" />
              <div className="absolute top-[-40%] right-[-20%] w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(196,150,126,0.15),transparent)] rounded-full" />
              <div className="absolute bottom-[-30%] left-[-10%] w-[250px] h-[250px] bg-[radial-gradient(circle,rgba(201,169,110,0.1),transparent)] rounded-full" />

              {/* BEST 뱃지 */}
              <div className="absolute top-5 right-5 z-10">
                <span className="px-3 py-1 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[11px] font-semibold tracking-wide">
                  LIMITED 50
                </span>
              </div>

              {/* 헤더 */}
              <div className="relative px-7 pt-7 pb-5 border-b border-white/[0.08]">
                <span className="text-[11px] tracking-[0.15em] uppercase text-rose-light font-medium">Beta Partner</span>
                <h3 className="font-serif-kr text-[22px] text-white mt-1">베타 파트너 혜택</h3>
                <p className="text-[12px] text-white/40 font-light mt-1">2026.03.01 ~ 05.31 가입 시 적용</p>
              </div>

              {/* 가격 리스트 */}
              <div className="relative px-7 py-5 flex-1 flex flex-col gap-4">
                {PRICING_COMPARISON.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-[13px] text-white/50 font-light">{item.label}</span>
                    <div className="flex items-center gap-2">
                      {item.highlight && (
                        <span className="text-[12px] text-white/30 line-through">{item.regular}</span>
                      )}
                      <span className={`text-[14px] font-semibold ${item.highlight ? "text-[#6BCB9A]" : "text-white/80"}`}>
                        {item.highlight && <Check className="w-3.5 h-3.5 inline mr-0.5 -mt-0.5" />}
                        {item.beta}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 절약 요약 */}
              <div className="relative px-7 py-5 border-t border-white/[0.08] bg-white/[0.03]">
                <div className="flex items-center justify-between max-sm:flex-col max-sm:gap-2 max-sm:text-center">
                  <span className="text-[12px] text-white/40 font-light">3개월 예상 절약</span>
                  <span className="text-[18px] font-bold bg-gradient-to-r from-rose-light to-gold bg-clip-text text-transparent">
                    최소 597,000원+
                  </span>
                </div>
                <p className="text-[11px] text-white/30 font-light mt-2 leading-relaxed">
                  월 이용료 199,000원 × 3개월 = 597,000원 절약, 수수료 10%→7% 할인
                </p>
              </div>
            </motion.div>
          </div>

          {/* 카드 아래 CTA */}
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.25 }} className="flex justify-center mt-10">
            <Link
              href="/vendor/register"
              className="inline-flex items-center gap-2 px-10 py-4 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[15px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all"
            >
              베타 파트너로 등록하기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>

          {/* 베타 종료 후 안내 */}
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.3 }} className="max-w-[820px] mx-auto mt-6">
            <div className="rounded-2xl border border-black/[0.04] bg-white p-6">
              <h4 className="text-[14px] font-medium text-noir-800 mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-taupe-400" />
                베타 종료 후 안내 사항
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 max-sm:grid-cols-1">
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 text-[13px] mt-0.5 flex-shrink-0">①</span>
                  <span className="text-[13px] text-taupe-500 font-light leading-relaxed">
                    정식 전환: <strong className="text-noir-800 font-medium">2026년 6월 1일</strong>부터 정식 요금(월 199,000원 + 건당 10%) 적용
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 text-[13px] mt-0.5 flex-shrink-0">②</span>
                  <span className="text-[13px] text-taupe-500 font-light leading-relaxed">
                    사전 안내: <strong className="text-noir-800 font-medium">5월 1일 이전</strong>까지 최소 1개월 전 안내
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 text-[13px] mt-0.5 flex-shrink-0">③</span>
                  <span className="text-[13px] text-taupe-500 font-light leading-relaxed">
                    베타 전용: 정식 전환 시 <strong className="text-noir-800 font-medium">별도 할인 혜택</strong> 제공 예정
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 text-[13px] mt-0.5 flex-shrink-0">④</span>
                  <span className="text-[13px] text-taupe-500 font-light leading-relaxed">
                    자유 해지: <strong className="text-noir-800 font-medium">위약금 없이 즉시 해지</strong> 가능
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* 혜택 */}
        <section className="py-16">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-serif-kr text-[24px] text-noir-800 mb-2">파트너 혜택</h2>
            <p className="text-[14px] text-taupe-500 font-light">베타 기간 동안 월 이용료 면제, 수수료 할인과 함께 아래 기능을 이용하실 수 있습니다</p>
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
