"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Store, MapPin, FileText, ChevronRight, ChevronLeft, Check, Upload, Loader2 } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import type { VendorCategory } from "@/data/mockVendors";

const BETA_CATEGORIES: VendorCategory[] = ["스튜디오", "드레스", "메이크업"];

const steps = [
  { num: 1, label: "기본 정보", icon: Store },
  { num: 2, label: "업체 상세", icon: MapPin },
  { num: 3, label: "사업자 인증", icon: FileText },
];

export default function VendorRegisterPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateStep = useCallback((step: number): boolean => {
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!shopName.trim()) errors.shopName = "업체명을 입력해 주세요";
      if (!category) errors.category = "업종을 선택해 주세요";
      if (!ownerName.trim()) errors.ownerName = "대표자명을 입력해 주세요";
      if (!phone.trim()) errors.phone = "연락처를 입력해 주세요";
      if (!email.trim()) errors.email = "이메일을 입력해 주세요";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "올바른 이메일 형식을 입력해 주세요";
    }

    if (step === 2) {
      if (!address.trim()) errors.address = "주소를 입력해 주세요";
      if (!description.trim()) errors.description = "업체 소개를 입력해 주세요";
    }

    if (step === 3) {
      if (!businessNumber.trim()) errors.businessNumber = "사업자등록번호를 입력해 주세요";
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      const firstErrorKey = Object.keys(errors)[0];
      setTimeout(() => {
        document.getElementById(`field-${firstErrorKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }

    return Object.keys(errors).length === 0;
  }, [shopName, category, ownerName, phone, email, address, description, businessNumber]);

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return;

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/vendor/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: shopName,
          category,
          ownerName,
          phone,
          email,
          address,
          priceMin: priceMin ? parseInt(priceMin) * 10000 : 0,
          priceMax: priceMax ? parseInt(priceMax) * 10000 : 0,
          description,
          tags,
          businessNumber,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || "등록에 실패했습니다.");
        return;
      }

      setCompleted(true);
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const FieldError = ({ field }: { field: string }) =>
    fieldErrors[field] ? (
      <p className="text-[12px] text-rose-600 mt-1.5">{fieldErrors[field]}</p>
    ) : null;

  const inputClass = (field: string) =>
    `w-full px-4 py-3 border rounded-xl text-[14px] outline-none transition-colors ${
      fieldErrors[field] ? "border-rose-500 bg-rose-500/[0.03]" : "border-platinum focus:border-rose-500"
    }`;

  if (completed) {
    const roadmap = [
      { label: "등록 신청", desc: "완료되었습니다", done: true },
      { label: "심사 및 검증", desc: "1~2 영업일 소요", done: false },
      { label: "승인 및 상품 등록", desc: "포탈에서 상품/패키지 등록", done: false },
      { label: "고객 노출 시작", desc: "AI 매칭으로 고객 연결", done: false },
    ];

    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl p-12 max-md:p-8 max-w-[540px] w-full shadow-[0_8px_32px_rgba(0,0,0,0.06)]"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-[#2E7D5A]/10 flex items-center justify-center mx-auto mb-5">
              <Check className="w-8 h-8 text-[#2E7D5A]" />
            </div>
            <h1 className="font-serif-kr text-[24px] font-light text-noir-800 mb-2">
              등록 신청이 완료되었습니다
            </h1>
            <p className="text-[14px] text-taupe-500 font-light leading-relaxed">
              심사가 완료되면 등록하신 이메일/연락처로 안내드립니다.
            </p>
          </div>

          <div className="bg-ivory-50 rounded-2xl p-6 mb-8">
            <p className="text-[12px] text-taupe-400 font-medium uppercase tracking-wider mb-4">앞으로의 절차</p>
            <div className="space-y-0">
              {roadmap.map((step, i) => (
                <div key={step.label} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      step.done
                        ? "bg-[#2E7D5A] text-white"
                        : "border-2 border-taupe-400/20 text-taupe-400"
                    }`}>
                      {step.done ? <Check className="w-3.5 h-3.5" /> : <span className="text-[11px] font-medium">{i + 1}</span>}
                    </div>
                    {i < roadmap.length - 1 && (
                      <div className={`w-px h-8 ${step.done ? "bg-[#2E7D5A]/30" : "bg-taupe-400/15"}`} />
                    )}
                  </div>
                  <div className="pt-1 pb-4">
                    <p className={`text-[14px] font-medium ${step.done ? "text-[#2E7D5A]" : "text-noir-800"}`}>
                      {step.label}
                    </p>
                    <p className="text-[12px] text-taupe-400 font-light mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Link
              href="/vendor/dashboard"
              className="flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors"
            >
              업체 대시보드 바로가기
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link
              href="/business"
              className="flex items-center justify-center px-8 py-3 rounded-full text-[13px] text-taupe-400 hover:text-rose-500 transition-colors"
            >
              파트너 랜딩으로 돌아가기
            </Link>
          </div>
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
                <div id="field-shopName">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업체명 <span className="text-rose-500">*</span></label>
                  <input type="text" value={shopName} onChange={(e) => { setShopName(e.target.value); clearFieldError("shopName"); }} placeholder="업체명을 입력해 주세요" className={inputClass("shopName")} />
                  <FieldError field="shopName" />
                </div>
                <div id="field-category">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업종 <span className="text-rose-500">*</span></label>
                  <p className="text-[12px] text-taupe-400 font-light mb-2">현재 베타 기간에는 스드메(스튜디오, 드레스, 메이크업) 업종만 등록 가능합니다.</p>
                  <div className="grid grid-cols-3 gap-2 max-md:grid-cols-3">
                    {BETA_CATEGORIES.map((cat) => (
                      <button key={cat} onClick={() => { setCategory(cat); clearFieldError("category"); }} className={`px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors border ${category === cat ? "bg-noir-800 text-white border-noir-800" : "bg-white text-charcoal border-platinum hover:border-rose-500"}`}>{cat}</button>
                    ))}
                  </div>
                  <FieldError field="category" />
                </div>
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                  <div id="field-ownerName">
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">대표자명 <span className="text-rose-500">*</span></label>
                    <input type="text" value={ownerName} onChange={(e) => { setOwnerName(e.target.value); clearFieldError("ownerName"); }} placeholder="대표자명" className={inputClass("ownerName")} />
                    <FieldError field="ownerName" />
                  </div>
                  <div id="field-phone">
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">연락처 <span className="text-rose-500">*</span></label>
                    <input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); clearFieldError("phone"); }} placeholder="010-0000-0000" className={inputClass("phone")} />
                    <FieldError field="phone" />
                  </div>
                </div>
                <div id="field-email">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">이메일 <span className="text-rose-500">*</span></label>
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }} placeholder="email@example.com" className={inputClass("email")} />
                  <FieldError field="email" />
                </div>
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1">업체 상세</h2>
              <p className="text-[13px] text-taupe-400 mb-6">고객에게 보여질 상세 정보를 입력해주세요</p>
              <div className="space-y-5">
                <div id="field-address">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">주소 <span className="text-rose-500">*</span></label>
                  <input type="text" value={address} onChange={(e) => { setAddress(e.target.value); clearFieldError("address"); }} placeholder="사업장 주소를 입력해 주세요" className={inputClass("address")} />
                  <FieldError field="address" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">최소 가격 (만원)</label>
                    <input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="100" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-noir-800 mb-2">최대 가격 (만원)</label>
                    <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="500" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <div id="field-description">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">업체 소개 <span className="text-rose-500">*</span></label>
                  <textarea value={description} onChange={(e) => { setDescription(e.target.value); clearFieldError("description"); }} placeholder="업체의 특징과 강점을 자유롭게 작성해 주세요" rows={4} className={`${inputClass("description")} resize-none`} />
                  <FieldError field="description" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">태그 (쉼표로 구분, 최대 5개)</label>
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: 자연광, 감성 촬영, 1:1 맞춤" className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors" />
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
                <div id="field-businessNumber">
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">사업자등록번호 <span className="text-rose-500">*</span></label>
                  <input type="text" value={businessNumber} onChange={(e) => { setBusinessNumber(e.target.value); clearFieldError("businessNumber"); }} placeholder="000-00-00000" className={inputClass("businessNumber")} />
                  <FieldError field="businessNumber" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-noir-800 mb-2">사업자등록증 업로드</label>
                  <div className="border-2 border-dashed border-platinum rounded-xl p-8 text-center hover:border-rose-500 transition-colors cursor-pointer">
                    <FileText className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
                    <p className="text-[13px] text-taupe-400">클릭하여 사업자등록증 업로드</p>
                    <p className="text-[11px] text-taupe-400/70 mt-1">PDF, JPG, PNG (최대 10MB) · 정식 출시 후 활성화</p>
                  </div>
                </div>

                {/* 베타 파트너 혜택 안내 */}
                <div className="bg-gradient-to-br from-noir-800 to-noir-900 rounded-xl p-5 text-white">
                  <h4 className="text-[13px] font-medium mb-3 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-rose-500 to-gold text-[10px] font-semibold">BETA</span>
                    베타 파트너 혜택
                  </h4>
                  <ul className="text-[12px] text-white/70 font-light space-y-1.5">
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-[#6BCB9A] flex-shrink-0" /> 월 이용료 면제 (199,000원/월 → 0원)</li>
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-[#6BCB9A] flex-shrink-0" /> 예약 수수료 할인 (10% → 7%)</li>
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-[#6BCB9A] flex-shrink-0" /> 최소 계약 기간 없음, 위약금 없음</li>
                  </ul>
                  <p className="text-[11px] text-white/40 mt-3">베타 기간: 2026.03.01 ~ 05.31 (3개월)</p>
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
            <button onClick={() => { setCurrentStep((s) => s - 1); setFieldErrors({}); }} className="flex items-center gap-2 px-5 py-3 rounded-full border border-platinum text-[14px] text-charcoal hover:border-noir-800 transition-colors">
              <ChevronLeft className="w-4 h-4" /> 이전
            </button>
          ) : <div />}

          {currentStep < 3 ? (
            <button onClick={handleNext} className="flex items-center gap-2 px-6 py-3 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors">
              다음 <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={isSubmitting} className="flex items-center gap-2 px-8 py-3 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[14px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] transition-all disabled:opacity-50">
              {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> 등록 중...</> : <>등록 신청하기 <Check className="w-4 h-4" /></>}
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-600">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
