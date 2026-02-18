"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Store, MapPin, FileText, ChevronRight, ChevronLeft, Check, Upload } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { VENDOR_CATEGORIES } from "@/data/mockVendors";
import type { VendorCategory } from "@/data/mockVendors";

const steps = [
  { num: 1, label: "기본 정보", icon: Store },
  { num: 2, label: "업체 상세", icon: MapPin },
  { num: 3, label: "사업자 인증", icon: FileText },
];

export default function VendorRegisterPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);

  const [shopName, setShopName] = useState("");
  const [category, setCategory] = useState<VendorCategory | "">("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [address, setAddress] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  const [businessNumber, setBusinessNumber] = useState("");

  const handleSubmit = () => {
    setCompleted(true);
  };

  if (completed) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl p-12 max-md:p-8 max-w-lg w-full text-center shadow-[0_8px_32px_rgba(0,0,0,0.06)]"
        >
          <div className="w-16 h-16 rounded-full bg-[#2E7D5A]/10 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-[#2E7D5A]" />
          </div>
          <h1 className="font-serif-kr text-[24px] font-light text-noir-800 mb-3">
            등록 신청이 완료되었습니다
          </h1>
          <p className="text-[14px] text-taupe-500 font-light leading-relaxed mb-2">
            심사가 완료되면 등록하신 연락처로 알려드리겠습니다.
          </p>
          <p className="text-[13px] text-taupe-400 mb-8">
            보통 1~2영업일 내에 심사가 완료됩니다.
          </p>
          <Link
            href="/vendor/dashboard"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors"
          >
            업체 대시보드 바로가기
            <ChevronRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory-50">
      <header className="bg-white border-b border-black/[0.04] px-8 py-5 max-md:px-5">
        <div className="max-w-[800px] mx-auto flex items-center justify-between">
          <Link href="/business" className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="font-serif-kr text-[15px] font-medium text-noir-800">업체 등록</span>
          </Link>
          <Link href="/business" className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors">
            돌아가기
          </Link>
        </div>
      </header>

      <div className="max-w-[800px] mx-auto px-8 py-10 max-md:px-5">
        {/* 스텝 인디케이터 */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {steps.map((step, i) => (
            <div key={step.num} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
                currentStep === step.num
                  ? "bg-noir-800 text-white"
                  : currentStep > step.num
                  ? "bg-[#2E7D5A]/10 text-[#2E7D5A]"
                  : "bg-ivory-warm text-taupe-400"
              }`}>
                {currentStep > step.num ? <Check className="w-4 h-4" /> : <step.icon className="w-4 h-4" />}
                <span className="max-md:hidden">{step.label}</span>
                <span className="md:hidden">{step.num}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px ${currentStep > step.num ? "bg-[#2E7D5A]" : "bg-taupe-400/20"}`} />
              )}
            </div>
          ))}
        </div>

        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-2xl border border-black/[0.04] p-8 max-md:p-6"
        >
          {currentStep === 1 && (
            <>
              <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1">기본 정보</h2>
              <p className="text-[13px] text-taupe-400 mb-6">업체의 기본 정보를 입력해주세요</p>
              <div className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업체명 *</label>
                  <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="예: 로즈스튜디오" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업종 *</label>
                  <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
                    {VENDOR_CATEGORIES.map((cat) => (
                      <button key={cat} onClick={() => setCategory(cat)} className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors border ${category === cat ? "bg-noir-800 text-white border-noir-800" : "bg-white text-charcoal border-platinum hover:border-rose-500"}`}>{cat}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">대표자명 *</label>
                    <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="홍길동" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">연락처 *</label>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="02-1234-5678" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">이메일 *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@studio.com" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                </div>
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1">업체 상세</h2>
              <p className="text-[13px] text-taupe-400 mb-6">고객에게 보여질 상세 정보를 입력해주세요</p>
              <div className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">주소 *</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="서울시 강남구 논현로 512, 3층" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">최소 가격 (만원)</label>
                    <input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="100" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">최대 가격 (만원)</label>
                    <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="300" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업체 소개 *</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="업체 소개를 자유롭게 작성해주세요..." rows={4} className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors resize-none" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">태그 (쉼표로 구분, 최대 5개)</label>
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="자연광 전문, 보정 퀄리티, 1:1 촬영" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">대표 사진</label>
                  <div className="border-2 border-dashed border-platinum rounded-xl p-8 text-center hover:border-rose-500 transition-colors cursor-pointer">
                    <Upload className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
                    <p className="text-[13px] text-taupe-400">클릭하여 업로드 (정식 출시 후 활성화)</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {currentStep === 3 && (
            <>
              <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1">사업자 인증</h2>
              <p className="text-[13px] text-taupe-400 mb-6">사업자 등록 정보를 입력해주세요. 심사에 필요합니다.</p>
              <div className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">사업자등록번호 *</label>
                  <input type="text" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} placeholder="123-45-67890" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">사업자등록증 업로드</label>
                  <div className="border-2 border-dashed border-platinum rounded-xl p-8 text-center hover:border-rose-500 transition-colors cursor-pointer">
                    <FileText className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
                    <p className="text-[13px] text-taupe-400">클릭하여 사업자등록증 업로드</p>
                    <p className="text-[11px] text-taupe-400/70 mt-1">PDF, JPG, PNG (최대 10MB) · 정식 출시 후 활성화</p>
                  </div>
                </div>
                <div className="bg-ivory-warm rounded-xl p-5">
                  <h4 className="text-[13px] font-medium text-noir-800 mb-2">심사 안내</h4>
                  <ul className="text-[12px] text-taupe-500 font-light space-y-1.5">
                    <li>• 등록 신청 후 1~2영업일 내에 심사가 진행됩니다.</li>
                    <li>• 심사 완료 시 등록하신 이메일/연락처로 결과를 안내드립니다.</li>
                    <li>• 승인 후 고객 서비스에 업체가 노출됩니다.</li>
                    <li>• 사업자등록증이 유효하지 않으면 심사가 반려될 수 있습니다.</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </motion.div>

        <div className="flex items-center justify-between mt-6">
          {currentStep > 1 ? (
            <button onClick={() => setCurrentStep((s) => s - 1)} className="flex items-center gap-2 px-5 py-3 rounded-full border border-platinum text-[14px] text-charcoal hover:border-noir-800 transition-colors">
              <ChevronLeft className="w-4 h-4" /> 이전
            </button>
          ) : <div />}

          {currentStep < 3 ? (
            <button onClick={() => setCurrentStep((s) => s + 1)} className="flex items-center gap-2 px-6 py-3 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors">
              다음 <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} className="flex items-center gap-2 px-8 py-3 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[14px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] transition-all">
              등록 신청하기 <Check className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
