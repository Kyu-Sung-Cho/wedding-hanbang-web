"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Plus, Edit2, Trash2, Check, X, Clock,
  Loader2, UserCheck, UserX, ChevronDown, ChevronUp,
} from "lucide-react";

interface StaffTimeslot {
  day: number;
  hour: number;
  max_bookings: number;
}

interface Staff {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  timeslots: StaffTimeslot[];
}

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8시~21시

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

export default function VendorStaffPage() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 폼 상태
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formSlots, setFormSlots] = useState<Set<string>>(new Set());

  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/staff");
      if (res.ok) {
        const data = await res.json();
        setStaffList(data.staff ?? []);
      }
    } catch (err) {
      console.error("Fetch staff error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const toggleSlot = (day: number, hour: number) => {
    const key = `${day}:${hour}`;
    setFormSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resetForm = () => {
    setFormName("");
    setFormRole("");
    setFormDesc("");
    setFormSlots(new Set());
  };

  const startEdit = (staff: Staff) => {
    setEditingId(staff.id);
    setFormName(staff.name);
    setFormRole(staff.role ?? "");
    setFormDesc(staff.description ?? "");
    setFormSlots(new Set(staff.timeslots.map((t) => `${t.day}:${t.hour}`)));
    setShowAdd(false);
  };

  const startAdd = () => {
    setEditingId(null);
    resetForm();
    setShowAdd(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    resetForm();
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);

    const timeslots = Array.from(formSlots).map((key) => {
      const [d, h] = key.split(":").map(Number);
      return { day: d, hour: h, maxBookings: 1 };
    });

    try {
      if (editingId) {
        await fetch("/api/vendor/staff", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingId,
            name: formName.trim(),
            role: formRole.trim() || null,
            description: formDesc.trim() || null,
            timeslots,
          }),
        });
      } else {
        await fetch("/api/vendor/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            role: formRole.trim() || null,
            description: formDesc.trim() || null,
            timeslots,
          }),
        });
      }

      cancelEdit();
      fetchStaff();
    } catch (err) {
      console.error("Save staff error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 스태프를 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/vendor/staff?id=${id}`, { method: "DELETE" });
      fetchStaff();
    } catch (err) {
      console.error("Delete staff error:", err);
    }
  };

  const handleToggleActive = async (staff: Staff) => {
    try {
      await fetch("/api/vendor/staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: staff.id, isActive: !staff.is_active }),
      });
      fetchStaff();
    } catch (err) {
      console.error("Toggle staff error:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
      </div>
    );
  }

  const isEditing = editingId !== null || showAdd;

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[20px] font-medium text-noir-800">스태프 관리</h1>
            <p className="text-[12px] text-taupe-400 font-light">담당자별 예약 시간 관리</p>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-noir-800 text-white text-[13px] font-medium hover:bg-noir-soft transition-colors"
          >
            <Plus className="w-4 h-4" />
            스태프 추가
          </button>
        )}
      </motion.div>

      {/* 통계 카드 */}
      <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.05 }} className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 text-center">
          <p className="text-[12px] text-taupe-400 mb-1">전체 스태프</p>
          <p className="text-[24px] font-semibold text-noir-800 font-cormorant">{staffList.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 text-center">
          <p className="text-[12px] text-taupe-400 mb-1">활성</p>
          <p className="text-[24px] font-semibold text-[#2E7D5A] font-cormorant">{staffList.filter((s) => s.is_active).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 text-center">
          <p className="text-[12px] text-taupe-400 mb-1">비활성</p>
          <p className="text-[24px] font-semibold text-taupe-400 font-cormorant">{staffList.filter((s) => !s.is_active).length}</p>
        </div>
      </motion.div>

      {/* 추가/수정 폼 */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6"
          >
            <div className="bg-white rounded-2xl border border-rose-500/20 p-6">
              <h2 className="text-[15px] font-medium text-noir-800 mb-4">
                {editingId ? "스태프 수정" : "새 스태프 추가"}
              </h2>

              <div className="grid grid-cols-2 gap-4 mb-4 max-md:grid-cols-1">
                <div>
                  <label className="text-[12px] text-taupe-400 font-medium block mb-1">이름 *</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="홍길동"
                    className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[14px] outline-none focus:border-rose-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-taupe-400 font-medium block mb-1">직급/역할</label>
                  <input
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    placeholder="원장, 실장, 디자이너 등"
                    className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[14px] outline-none focus:border-rose-500 transition-colors"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[12px] text-taupe-400 font-medium block mb-1">소개</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="경력, 전문 분야 등"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[14px] outline-none focus:border-rose-500 transition-colors resize-none"
                />
              </div>

              {/* 타임슬롯 그리드 */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-rose-500" />
                  <span className="text-[13px] font-medium text-noir-800">가능 시간</span>
                  <span className="text-[11px] text-taupe-400">({formSlots.size}개 선택)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-center">
                    <thead>
                      <tr>
                        <th className="w-12 text-[11px] text-taupe-400 font-medium pb-2" />
                        {DAYS.map((d) => (
                          <th key={d} className="text-[11px] text-taupe-400 font-medium pb-2 px-0.5">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {HOURS.map((hour) => (
                        <tr key={hour}>
                          <td className="text-[10px] text-taupe-400 pr-1 py-0.5">{hour}:00</td>
                          {DAYS.map((_, di) => {
                            const isSelected = formSlots.has(`${di}:${hour}`);
                            return (
                              <td key={di} className="px-0.5 py-0.5">
                                <button
                                  onClick={() => toggleSlot(di, hour)}
                                  className={`w-full h-6 rounded-sm transition-colors ${
                                    isSelected
                                      ? "bg-rose-500"
                                      : "bg-ivory-warm hover:bg-rose-500/20"
                                  }`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="px-4 py-2 rounded-lg text-[13px] text-taupe-400 hover:bg-ivory-warm transition-colors">
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formName.trim() || saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-noir-800 text-white text-[13px] font-medium hover:bg-noir-soft transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {editingId ? "수정" : "추가"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 스태프 목록 */}
      <div className="space-y-3">
        {staffList.map((staff, idx) => (
          <motion.div
            key={staff.id}
            {...fadeIn}
            transition={{ ...fadeIn.transition, delay: 0.05 * (idx + 1) }}
            className={`bg-white rounded-2xl border ${staff.is_active ? "border-black/[0.04]" : "border-black/[0.04] opacity-60"} overflow-hidden`}
          >
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  staff.is_active ? "bg-rose-500/10" : "bg-taupe-400/10"
                }`}>
                  <span className="text-[16px] font-medium text-noir-800">{staff.name[0]}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-medium text-noir-800">{staff.name}</h3>
                    {staff.role && (
                      <span className="px-2 py-0.5 rounded-full bg-ivory-warm text-[11px] text-charcoal font-medium">{staff.role}</span>
                    )}
                    {!staff.is_active && (
                      <span className="px-2 py-0.5 rounded-full bg-taupe-400/10 text-[11px] text-taupe-400 font-medium">비활성</span>
                    )}
                  </div>
                  {staff.description && (
                    <p className="text-[12px] text-taupe-400 font-light mt-0.5">{staff.description}</p>
                  )}
                  <p className="text-[11px] text-taupe-400 mt-1">
                    가능 시간: {staff.timeslots.length}개 슬롯
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setExpandedId(expandedId === staff.id ? null : staff.id)}
                  className="p-2 rounded-lg hover:bg-ivory-warm transition-colors"
                  title="시간표 보기"
                >
                  {expandedId === staff.id ? <ChevronUp className="w-4 h-4 text-taupe-400" /> : <ChevronDown className="w-4 h-4 text-taupe-400" />}
                </button>
                <button
                  onClick={() => handleToggleActive(staff)}
                  className="p-2 rounded-lg hover:bg-ivory-warm transition-colors"
                  title={staff.is_active ? "비활성화" : "활성화"}
                >
                  {staff.is_active ? <UserCheck className="w-4 h-4 text-[#2E7D5A]" /> : <UserX className="w-4 h-4 text-taupe-400" />}
                </button>
                <button
                  onClick={() => startEdit(staff)}
                  className="p-2 rounded-lg hover:bg-ivory-warm transition-colors"
                  title="수정"
                >
                  <Edit2 className="w-4 h-4 text-taupe-400" />
                </button>
                <button
                  onClick={() => handleDelete(staff.id)}
                  className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                  title="삭제"
                >
                  <Trash2 className="w-4 h-4 text-taupe-400 hover:text-red-400" />
                </button>
              </div>
            </div>

            {/* 타임슬롯 미니 그리드 */}
            <AnimatePresence>
              {expandedId === staff.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-black/[0.04] overflow-hidden"
                >
                  <div className="p-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-center">
                        <thead>
                          <tr>
                            <th className="w-12 text-[10px] text-taupe-400 font-medium pb-1" />
                            {DAYS.map((d) => (
                              <th key={d} className="text-[10px] text-taupe-400 font-medium pb-1">{d}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {HOURS.map((hour) => (
                            <tr key={hour}>
                              <td className="text-[9px] text-taupe-400 pr-1">{hour}:00</td>
                              {DAYS.map((_, di) => {
                                const hasSlot = staff.timeslots.some((t) => t.day === di && t.hour === hour);
                                return (
                                  <td key={di} className="px-0.5 py-px">
                                    <div className={`w-full h-4 rounded-sm ${hasSlot ? "bg-rose-500/70" : "bg-ivory-warm"}`} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>

      {staffList.length === 0 && !isEditing && (
        <div className="text-center py-16">
          <Users className="w-12 h-12 text-taupe-400/20 mx-auto mb-3" />
          <p className="text-[14px] text-taupe-400 mb-1">등록된 스태프가 없습니다</p>
          <p className="text-[12px] text-taupe-400/70 font-light mb-4">스태프를 추가하면 고객이 예약 시 담당자를 선택할 수 있습니다</p>
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-noir-800 text-white text-[13px] font-medium hover:bg-noir-soft transition-colors"
          >
            <Plus className="w-4 h-4" />
            첫 스태프 추가하기
          </button>
        </div>
      )}
    </div>
  );
}
