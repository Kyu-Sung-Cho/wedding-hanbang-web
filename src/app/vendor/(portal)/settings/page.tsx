"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Store, Mail, Phone, FileText, Bell, LogOut, ChevronRight, Shield, Loader2 } from "lucide-react";
import { useVendorStore } from "@/stores/vendorStore";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function VendorSettingsPage() {
  const { vendor, updateSettings } = useVendorStore();
  const ns = vendor?.notificationSettings;
  const [notifications, setNotifications] = useState({
    booking: ns?.booking ?? true,
    message: ns?.message ?? true,
    marketing: ns?.marketing ?? false,
  });
  const [saving, setSaving] = useState(false);

  const handleToggle = async (key: "booking" | "message" | "marketing") => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    setSaving(true);
    await updateSettings(updated);
    setSaving(false);
  };

  return (
    <div className="max-w-[745px] mx-auto">
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center"><Store className="w-6 h-6 text-white" /></div>
          <div><h2 className="text-[21px] font-medium text-noir-800">{vendor?.name ?? "업체"}</h2><p className="text-[21px] text-taupe-500 font-light">{vendor?.category ?? ""} · {vendor?.location ?? ""}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-black/[0.02]"><Mail className="w-4 h-4 text-taupe-400" /><div><p className="text-[21px] text-taupe-400">이메일</p><p className="text-[21px] text-noir-800">{vendor?.email ?? "-"}</p></div></div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-black/[0.02]"><Phone className="w-4 h-4 text-taupe-400" /><div><p className="text-[21px] text-taupe-400">연락처</p><p className="text-[21px] text-noir-800">{vendor?.phone ?? "-"}</p></div></div>
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-noir-800 flex items-center justify-center"><FileText className="w-4 h-4 text-white" /></div>
          <div><h3 className="text-[21px] font-medium text-noir-800">사업자 정보</h3><p className="text-[21px] text-taupe-400 font-light">인증된 사업자 정보</p></div>
        </div>
        <div className="space-y-3">
          {[{ l: "사업자등록번호", v: vendor?.businessNumber ?? "-" }, { l: "대표자명", v: vendor?.ownerName ?? "-" }].map((item) => (
            <div key={item.l} className="flex items-center justify-between px-4 py-3 rounded-xl bg-ivory-50"><span className="text-[21px] text-taupe-500">{item.l}</span><span className="text-[21px] text-noir-800 font-medium">{item.v}</span></div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-ivory-50"><span className="text-[21px] text-taupe-500">인증 상태</span><span className={`flex items-center gap-1 text-[21px] font-medium ${vendor?.status === "approved" ? "text-[#2E7D5A]" : vendor?.status === "pending" ? "text-gold" : "text-red-400"}`}><Shield className="w-3.5 h-3.5" />{vendor?.status === "approved" ? "인증 완료" : vendor?.status === "pending" ? "심사 중" : "반려"}</span></div>
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center"><Bell className="w-4 h-4 text-white" /></div>
          <div className="flex items-center gap-2">
            <h3 className="text-[21px] font-medium text-noir-800">알림 설정</h3>
            {saving && <Loader2 className="w-3.5 h-3.5 text-taupe-400 animate-spin" />}
          </div>
        </div>
        <div className="space-y-1">
          {[
            { key: "booking" as const, label: "예약 알림", desc: "새 예약 및 예약 변경/취소 시 알림" },
            { key: "message" as const, label: "메시지 알림", desc: "고객이 문의 메시지를 보내면 알림" },
            { key: "marketing" as const, label: "프로모션 알림", desc: "웨딩한방 소식 및 이벤트" },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between px-4 py-3.5 rounded-xl hover:bg-ivory-50 transition-colors">
              <div><p className="text-[21px] font-medium text-noir-800">{item.label}</p><p className="text-[21px] text-taupe-400 font-light">{item.desc}</p></div>
              <button onClick={() => handleToggle(item.key)} className={`w-11 h-6 rounded-full transition-colors relative ${notifications[item.key] ? "bg-rose-500" : "bg-taupe-400/30"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notifications[item.key] ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-6">
        {[{ label: "파트너 이용약관" }, { label: "개인정보 처리방침" }, { label: "고객센터 (partner@hanbang.ai)" }, { label: "포털 버전", value: "v1.0.0 (Beta)" }].map((item, i) => (
          <button key={item.label} className={`w-full flex items-center justify-between px-6 py-4 hover:bg-ivory-50 transition-colors ${i > 0 ? "border-t border-black/[0.03]" : ""}`}>
            <span className="text-[21px] text-noir-800">{item.label}</span>
            {item.value ? <span className="text-[21px] text-taupe-400">{item.value}</span> : <ChevronRight className="w-4 h-4 text-taupe-400" />}
          </button>
        ))}
      </motion.div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.2 }}>
        <button className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-red-200 text-red-400 text-[21px] font-medium hover:bg-red-50 transition-colors"><LogOut className="w-4 h-4" />로그아웃</button>
      </motion.div>
    </div>
  );
}
