"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Save, Upload, Eye, MapPin, Star, Sparkles, Loader2 } from "lucide-react";
import { VENDOR_CATEGORIES } from "@/data/mockVendors";
import { useVendorStore } from "@/stores/vendorStore";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function VendorProfilePage() {
  const { vendor, updateProfile } = useVendorStore();

  const [name, setName] = useState(vendor?.name ?? "");
  const [category, setCategory] = useState(vendor?.category ?? "스튜디오");
  const [description, setDescription] = useState(vendor?.description ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [priceMin, setPriceMin] = useState(String((vendor?.priceMin ?? 0) / 10000));
  const [priceMax, setPriceMax] = useState(String((vendor?.priceMax ?? 0) / 10000));
  const [tagInput, setTagInput] = useState((vendor?.tags ?? []).join(", "));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const success = await updateProfile({
      name,
      category,
      description,
      address,
      phone,
      priceMin: Number(priceMin) * 10000,
      priceMax: Number(priceMax) * 10000,
      tags: tagInput.split(",").map(t => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (success) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  return (
    <div className="max-w-[1000px] mx-auto">
      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        <div className="col-span-3 space-y-6">
          <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="bg-white rounded-2xl border border-black/[0.04] p-6">
            <h3 className="font-serif-kr text-[21px] font-normal text-noir-800 mb-5">기본 정보</h3>
            <div className="space-y-4">
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">업체명</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">업종</label><div className="flex flex-wrap gap-2">{VENDOR_CATEGORIES.map((cat) => (<button key={cat} onClick={() => setCategory(cat)} className={`px-3 py-1.5 rounded-lg text-[38px] font-medium transition-colors border ${category === cat ? "bg-noir-800 text-white border-noir-800" : "text-charcoal border-platinum hover:border-rose-500"}`}>{cat}</button>))}</div></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">소개</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors resize-none" /></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">주소</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">연락처</label><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div>
              <div className="grid grid-cols-2 gap-4"><div><label className="block text-[25px] font-medium text-noir-800 mb-2">최소 가격 (만원)</label><input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div><div><label className="block text-[25px] font-medium text-noir-800 mb-2">최대 가격 (만원)</label><input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">태그 (쉼표로 구분)</label><input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} className="w-full px-4 py-3 border border-platinum rounded-xl text-[23px] outline-none focus:border-rose-500 transition-colors" /></div>
              <div><label className="block text-[25px] font-medium text-noir-800 mb-2">대표 사진</label><div className="grid grid-cols-3 gap-3">{[1, 2, 3].map((n) => (<div key={n} className="aspect-[4/3] bg-ivory-warm rounded-xl border-2 border-dashed border-platinum flex items-center justify-center hover:border-rose-500 transition-colors cursor-pointer"><Upload className="w-5 h-5 text-taupe-400" /></div>))}</div></div>
            </div>
          </motion.div>
          <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }}><button onClick={handleSave} disabled={saving} className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[23px] font-medium transition-all ${saved ? "bg-[#2E7D5A] text-white" : "bg-noir-800 text-white hover:bg-noir-soft"} ${saving ? "opacity-70 cursor-not-allowed" : ""}`}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? "저장 중..." : saved ? "저장되었습니다!" : "변경사항 저장"}</button></motion.div>
        </div>
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="col-span-2">
          <div className="sticky top-[88px]">
            <div className="flex items-center gap-2 mb-3"><Eye className="w-4 h-4 text-taupe-400" /><span className="text-[38px] text-taupe-400 font-medium">고객에게 보이는 모습</span></div>
            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              <div className="h-[140px] bg-gradient-to-br from-ivory-deep to-ivory-warm flex items-center justify-center"><span className="text-[25px] text-taupe-400 font-light">{category} 사진</span></div>
              <div className="p-5">
                {vendor?.aiRecommend && <span className="flex items-center gap-1 text-[25px] text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full font-medium w-fit mb-2"><Sparkles className="w-2.5 h-2.5" />AI 추천</span>}
                <h3 className="text-[25px] font-medium text-noir-800 mb-1">{name || "업체명"}</h3>
                <div className="flex items-center gap-2 mb-2"><Star className="w-3.5 h-3.5 text-gold fill-gold" /><span className="text-[25px] text-noir-800 font-medium">{vendor?.rating ?? 0}</span><span className="text-[23px] text-taupe-400">({vendor?.reviewCount ?? 0})</span></div>
                <div className="flex items-center gap-1.5 mb-3"><MapPin className="w-3.5 h-3.5 text-taupe-400" /><span className="text-[38px] text-taupe-500">{address ? address.split(",")[0] : "주소"}</span><span className="text-[38px] text-taupe-400 mx-1">·</span><span className="text-[38px] text-rose-500 font-medium">{priceMin && priceMax ? `${priceMin}~${priceMax}만원` : "가격 미설정"}</span></div>
                <div className="flex gap-1.5 flex-wrap">{tagInput.split(",").filter(Boolean).slice(0, 5).map((tag) => (<span key={tag} className="px-2 py-0.5 rounded-full bg-ivory-warm text-[25px] text-charcoal font-medium">{tag.trim()}</span>))}</div>
                {description && <p className="text-[38px] text-taupe-500 font-light mt-3 line-clamp-3">{description}</p>}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
