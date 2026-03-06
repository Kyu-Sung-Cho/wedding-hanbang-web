"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import {
  User,
  Calendar,
  Wallet,
  Heart,
  Bell,
  LogOut,
  ChevronRight,
  Copy,
  Check,
  Pencil,
  Save,
  X,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useNotificationPrefs } from "@/hooks/useNotifications";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function SettingsPage() {
  const { profile, partner, couple, journey, signOut, updateJourney, updateProfile } = useAuthStore();
  const { prefs: notifications, togglePref: toggleNotification } = useNotificationPrefs();
  const [copied, setCopied] = useState(false);
  const [coupleCode, setCoupleCode] = useState("");
  const [isFullyLinked, setIsFullyLinked] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 수정 모드
  const [editingName, setEditingName] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteReasonOther, setDeleteReasonOther] = useState("");

  useEffect(() => {
    if (couple) {
      fetch("/api/couple/code")
        .then((r) => r.json())
        .then((d) => {
          if (d.inviteCode) setCoupleCode(d.inviteCode);
          if (d.isFullyLinked) setIsFullyLinked(true);
        })
        .catch(() => {});
    }
  }, [couple]);

  const handleCopy = () => {
    if (!coupleCode) return;
    navigator.clipboard.writeText(coupleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/couple/code", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.inviteCode) {
        setCoupleCode(data.inviteCode);
      }
    } catch {
      // 실패 시 무시
    } finally {
      setRegenerating(false);
    }
  };

  // 이름 저장
  const saveName = async () => {
    if (!nameInput.trim()) return;
    setSaving(true);
    await updateProfile({ name: nameInput.trim() });
    setSaving(false);
    setEditingName(false);
  };

  // 날짜 저장
  const saveDate = async () => {
    setSaving(true);
    await updateJourney({ wedding_date: dateInput || null });
    setSaving(false);
    setEditingDate(false);
  };

  // 예산 저장
  const saveBudget = async () => {
    const value = parseInt(budgetInput) * 10000;
    if (isNaN(value) || value <= 0) return;
    setSaving(true);
    await updateJourney({ total_budget: value });
    setSaving(false);
    setEditingBudget(false);
  };

  const DELETE_REASONS = [
    { value: "unsatisfied", label: "서비스 불만족" },
    { value: "alternative", label: "다른 서비스 이용" },
    { value: "wedding_done", label: "결혼 준비 완료" },
    { value: "privacy", label: "개인정보 우려" },
    { value: "low_usage", label: "사용 빈도 낮음" },
    { value: "other", label: "기타 (직접 입력)" },
  ];

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "탈퇴합니다" || !deleteReason) return;
    setDeleting(true);
    setDeleteError("");

    const reason = deleteReason === "other"
      ? (deleteReasonOther.trim() || "기타")
      : DELETE_REASONS.find(r => r.value === deleteReason)?.label ?? deleteReason;

    try {
      const res = await fetch("/api/auth/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();

      if (!res.ok) {
        setDeleteError(data.error ?? "계정 삭제에 실패했습니다.");
        return;
      }

      document.cookie = "onboarding_complete=; path=/; max-age=0";
      document.cookie = "demo_mode=; path=/; max-age=0";
      window.location.href = "/login";
    } catch {
      setDeleteError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  const userName = profile?.name ?? "사용자";
  const userEmail = profile?.email ?? "";
  const userRole = profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : "";
  const initials = userName.slice(0, 2).toUpperCase();

  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;
  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";
  const totalBudget = journey?.total_budget ?? 0;
  const budgetStr = totalBudget > 0
    ? `₩${(totalBudget / 10000).toLocaleString()}만원`
    : "미설정";

  const partnerName = partner?.name;
  const partnerRole = partner?.role === "bride" ? "신부" : partner?.role === "groom" ? "신랑" : "";

  return (
    <div className="max-w-[700px] mx-auto">
      {/* 프로필 카드 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
            <span className="font-display text-[24px] text-white font-light">{initials}</span>
          </div>
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                  className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-[16px] text-noir-800 outline-none w-[150px]"
                  autoFocus
                />
                <button onClick={saveName} disabled={saving} className="w-7 h-7 rounded-lg bg-[#2E7D5A] flex items-center justify-center text-white">
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingName(false)} className="w-7 h-7 rounded-lg bg-taupe-400/20 flex items-center justify-center text-taupe-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-[18px] font-medium text-noir-800">{userName}</h2>
                {userRole && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-medium">
                    {userRole}
                  </span>
                )}
                <button
                  onClick={() => { setNameInput(userName); setEditingName(true); }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-taupe-400 hover:text-rose-500 hover:bg-rose-500/5 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
            <p className="text-[13px] text-taupe-500 font-light mt-0.5">{userEmail}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {/* 결혼 예정일 */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-ivory-50 border border-black/[0.02]">
            <Calendar className="w-5 h-5 text-rose-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-taupe-400">결혼 예정일</p>
              {editingDate ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="px-2 py-1 rounded-md border border-rose-500/30 text-[13px] text-noir-800 outline-none"
                    autoFocus
                  />
                  <button onClick={saveDate} disabled={saving} className="w-6 h-6 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-3 h-3" />
                  </button>
                  <button onClick={() => setEditingDate(false)} className="w-6 h-6 rounded-md bg-taupe-400/20 flex items-center justify-center text-taupe-500">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[14px] font-medium text-noir-800">{dateStr}</p>
                  <button
                    onClick={() => { setDateInput(journey?.wedding_date ?? ""); setEditingDate(true); }}
                    className="w-5 h-5 rounded flex items-center justify-center text-taupe-400 hover:text-rose-500 transition-colors"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 설정 예산 */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-ivory-50 border border-black/[0.02]">
            <Wallet className="w-5 h-5 text-gold flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-taupe-400">설정 예산</p>
              {editingBudget ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                      className="w-[80px] px-2 py-1 rounded-md border border-rose-500/30 text-[13px] text-noir-800 outline-none text-right"
                      autoFocus
                    />
                    <span className="text-[12px] text-taupe-400 ml-1">만원</span>
                  </div>
                  <button onClick={saveBudget} disabled={saving} className="w-6 h-6 rounded-md bg-[#2E7D5A] flex items-center justify-center text-white">
                    <Save className="w-3 h-3" />
                  </button>
                  <button onClick={() => setEditingBudget(false)} className="w-6 h-6 rounded-md bg-taupe-400/20 flex items-center justify-center text-taupe-500">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="text-[14px] font-medium text-noir-800">{budgetStr}</p>
                  <button
                    onClick={() => { setBudgetInput(String(totalBudget / 10000)); setEditingBudget(true); }}
                    className="w-5 h-5 rounded flex items-center justify-center text-taupe-400 hover:text-rose-500 transition-colors"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* 커플 연동 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
            <Heart className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-noir-800">커플 연동</h3>
            <p className="text-[12px] text-taupe-500 font-light">파트너와 함께 준비 현황을 공유하세요</p>
          </div>
        </div>

        <div className="bg-ivory-50 rounded-xl p-4 border border-black/[0.02]">
          {coupleCode && !isFullyLinked && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] text-taupe-400 mb-1">나의 커플 코드</p>
                  <p className="text-[16px] font-display font-medium text-noir-800 tracking-wider">{coupleCode}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[12px] text-charcoal hover:border-rose-500 hover:text-rose-500 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#2E7D5A]" />
                        <span className="text-[#2E7D5A]">복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        복사
                      </>
                    )}
                  </button>
                </div>
              </div>
              <button
                onClick={handleRegenerateCode}
                disabled={regenerating}
                className="mt-2 text-[11px] text-taupe-400 hover:text-rose-500 transition-colors disabled:opacity-50"
              >
                {regenerating ? "재발급 중..." : "코드 재발급"}
              </button>
            </div>
          )}

          {partner ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-[#2E7D5A]/20">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center">
                <span className="text-[13px] text-white font-medium">{partnerName?.slice(0, 2)}</span>
              </div>
              <div className="flex-1">
                <p className="text-[13px] text-noir-800 font-medium">{partnerName}</p>
                <p className="text-[11px] text-[#2E7D5A]">{partnerRole} · 연동 완료</p>
              </div>
              <Check className="w-5 h-5 text-[#2E7D5A]" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-dashed border-taupe-400/30">
              <div className="w-10 h-10 rounded-full bg-ivory-warm flex items-center justify-center">
                <User className="w-5 h-5 text-taupe-400" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] text-taupe-400 font-light">파트너 미연동</p>
                <p className="text-[11px] text-taupe-400/70">코드를 공유해서 파트너를 초대하세요</p>
              </div>
              <ChevronRight className="w-4 h-4 text-taupe-400" />
            </div>
          )}
        </div>
      </motion.div>

      {/* 알림 설정 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center">
            <Bell className="w-4.5 h-4.5 text-white" />
          </div>
          <h3 className="text-[15px] font-medium text-noir-800">알림 설정</h3>
        </div>

        <div className="flex flex-col gap-1">
          {[
            { key: "schedule" as const, label: "일정 알림", desc: "D-day 체크리스트 리마인더" },
            { key: "budget" as const, label: "예산 알림", desc: "예산 초과 및 변동 알림" },
            { key: "ai" as const, label: "AI 추천 알림", desc: "맞춤 업체 추천, 꿀팁 안내" },
            { key: "marketing" as const, label: "마케팅 알림", desc: "이벤트, 할인 정보" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between px-4 py-3.5 rounded-xl hover:bg-ivory-50 transition-colors"
            >
              <div>
                <p className="text-[14px] font-medium text-noir-800">{item.label}</p>
                <p className="text-[12px] text-taupe-400 font-light">{item.desc}</p>
              </div>
              <button
                onClick={() => toggleNotification(item.key)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  notifications[item.key] ? "bg-rose-500" : "bg-taupe-400/30"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    notifications[item.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 기타 메뉴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-6"
      >
        {[
          { label: "이용약관" },
          { label: "개인정보 처리방침" },
          { label: "고객센터" },
          { label: "앱 버전", value: "v1.0.0 (Beta)" },
        ].map((item, i) => (
          <button
            key={item.label}
            className={`w-full flex items-center justify-between px-6 py-4 hover:bg-ivory-50 transition-colors ${
              i > 0 ? "border-t border-black/[0.03]" : ""
            }`}
          >
            <span className="text-[14px] text-noir-800">{item.label}</span>
            {item.value ? (
              <span className="text-[13px] text-taupe-400">{item.value}</span>
            ) : (
              <ChevronRight className="w-4 h-4 text-taupe-400" />
            )}
          </button>
        ))}
      </motion.div>

      {/* 로그아웃 & 탈퇴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-col gap-3"
      >
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-red-200 text-red-400 text-[14px] font-medium hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 text-taupe-400 text-[13px] font-light hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          계정 탈퇴
        </button>
      </motion.div>

      {/* 계정 탈퇴 모달 */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[400px] bg-white rounded-3xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>

              <h3 className="text-[20px] font-semibold text-noir-800 text-center mb-2">
                정말 탈퇴하시겠어요?
              </h3>
              <p className="text-[13px] text-taupe-400 text-center leading-relaxed mb-6">
                탈퇴하면 모든 데이터가 영구 삭제되며
                <br />
                복구할 수 없습니다.
              </p>

              {/* 탈퇴 사유 */}
              <div className="mb-5">
                <p className="text-[12px] text-taupe-500 mb-3">탈퇴 사유를 선택해주세요</p>
                <div className="space-y-2">
                  {DELETE_REASONS.map((r) => (
                    <label key={r.value} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                      deleteReason === r.value ? "border-rose-500/30 bg-rose-500/5" : "border-black/[0.04] hover:bg-ivory-50"
                    }`}>
                      <input
                        type="radio"
                        name="deleteReason"
                        value={r.value}
                        checked={deleteReason === r.value}
                        onChange={() => setDeleteReason(r.value)}
                        className="w-4 h-4 accent-rose-500"
                      />
                      <span className="text-[13px] text-noir-800">{r.label}</span>
                    </label>
                  ))}
                </div>
                {deleteReason === "other" && (
                  <textarea
                    value={deleteReasonOther}
                    onChange={(e) => setDeleteReasonOther(e.target.value)}
                    placeholder="탈퇴 사유를 알려주세요..."
                    rows={2}
                    className="w-full mt-2 px-3 py-2 rounded-xl border border-black/[0.06] text-[13px] outline-none resize-none focus:border-rose-500/50"
                  />
                )}
              </div>

              <div className="mb-5">
                <p className="text-[12px] text-taupe-500 mb-2">
                  확인을 위해 <span className="font-semibold text-red-400">탈퇴합니다</span>를 입력해주세요
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="탈퇴합니다"
                  className="w-full px-4 py-3 rounded-xl border border-black/[0.06] bg-white text-[14px] text-noir-800 outline-none focus:border-red-400 transition-colors placeholder:text-taupe-400"
                />
              </div>

              {deleteError && (
                <p className="text-[12px] text-red-500 text-center mb-4">{deleteError}</p>
              )}

              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "탈퇴합니다" || !deleteReason || (deleteReason === "other" && !deleteReasonOther.trim()) || deleting}
                className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all mb-3 bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {deleting ? "삭제 중..." : "계정 영구 삭제"}
              </button>

              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText("");
                  setDeleteError("");
                  setDeleteReason("");
                  setDeleteReasonOther("");
                }}
                className="w-full py-3 rounded-2xl text-[14px] font-medium text-taupe-500 hover:text-noir-800 hover:bg-black/[0.02] transition-all"
              >
                취소
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
