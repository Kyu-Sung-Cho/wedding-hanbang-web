"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  FileText,
  Edit3,
  Trash2,
  Copy,
  X,
  Save,
  Check,
  Star,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import type {
  ContractTemplate,
  VendorContractTemplate,
  ContractClause,
  CancellationPolicyItem,
} from "@/types/contract.types";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

// 기본 취소 정책
const DEFAULT_CANCELLATION_POLICY: CancellationPolicyItem[] = [
  { daysBefore: 30, refundPercent: 100, label: "30일 전: 100% 환불" },
  { daysBefore: 14, refundPercent: 80, label: "14일 전: 80% 환불" },
  { daysBefore: 7, refundPercent: 50, label: "7일 전: 50% 환불" },
  { daysBefore: 3, refundPercent: 30, label: "3일 전: 30% 환불" },
  { daysBefore: 0, refundPercent: 0, label: "당일: 환불 불가" },
];

// ─── 템플릿 편집 모달 ───
function TemplateEditModal({
  template,
  standardTemplates,
  onSave,
  onClose,
}: {
  template: VendorContractTemplate | null;
  standardTemplates: ContractTemplate[];
  onSave: (data: {
    baseTemplateId?: string;
    title: string;
    content: ContractClause[];
    cancellationPolicy: CancellationPolicyItem[];
    depositRate: number;
    isDefault: boolean;
  }) => void;
  onClose: () => void;
}) {
  const isNew = !template;

  const [title, setTitle] = useState(template?.title ?? "");
  const [content, setContent] = useState<ContractClause[]>(
    template?.content ?? [{ title: "", body: "" }]
  );
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyItem[]>(
    template?.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY
  );
  const [depositRate, setDepositRate] = useState(template?.depositRate ?? 0.3);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [baseTemplateId, setBaseTemplateId] = useState(template?.baseTemplateId ?? "");
  const [saving, setSaving] = useState(false);

  // 표준 템플릿 선택 시 내용 불러오기
  const handleLoadStandardTemplate = (id: string) => {
    setBaseTemplateId(id);
    const found = standardTemplates.find((t) => t.id === id);
    if (found) {
      setTitle(found.title + " (커스텀)");
      setContent(found.content);
      setCancellationPolicy(found.cancellationPolicy);
      setDepositRate(found.defaultDepositRate);
    }
  };

  const handleAddClause = () => {
    setContent([...content, { title: "", body: "" }]);
  };

  const handleRemoveClause = (idx: number) => {
    setContent(content.filter((_, i) => i !== idx));
  };

  const handleClauseChange = (idx: number, field: "title" | "body", value: string) => {
    setContent(content.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const handleAddPolicy = () => {
    setCancellationPolicy([
      ...cancellationPolicy,
      { daysBefore: 0, refundPercent: 0, label: "" },
    ]);
  };

  const handleRemovePolicy = (idx: number) => {
    setCancellationPolicy(cancellationPolicy.filter((_, i) => i !== idx));
  };

  const handlePolicyChange = (
    idx: number,
    field: "daysBefore" | "refundPercent" | "label",
    value: string | number
  ) => {
    setCancellationPolicy(
      cancellationPolicy.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    if (content.length === 0 || !content[0].title.trim()) return;
    setSaving(true);
    await onSave({
      baseTemplateId: baseTemplateId || undefined,
      title: title.trim(),
      content,
      cancellationPolicy,
      depositRate,
      isDefault,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-noir-800/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-[750px] mx-4 overflow-hidden"
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-black/[0.04] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-[21px] font-medium text-noir-800">
            {isNew ? "계약 템플릿 생성" : "계약 템플릿 수정"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-ivory-50 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-taupe-400" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* 표준 템플릿 선택 (신규일 때만) */}
          {isNew && standardTemplates.length > 0 && (
            <div>
              <h3 className="text-[21px] font-medium text-taupe-500 mb-3 uppercase tracking-wider">
                표준 템플릿 기반으로 시작 (선택)
              </h3>
              <select
                value={baseTemplateId}
                onChange={(e) => handleLoadStandardTemplate(e.target.value)}
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 transition-colors bg-white"
              >
                <option value="">직접 작성하기</option>
                {standardTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.category}] {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 기본 정보 */}
          <div>
            <h3 className="text-[21px] font-medium text-taupe-500 mb-3 uppercase tracking-wider">
              기본 정보
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[21px] font-medium text-noir-800 mb-1.5">
                  템플릿 이름 *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 스튜디오 촬영 표준 계약서"
                  className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[21px] font-medium text-noir-800 mb-1.5">
                    계약금 비율 (%)
                  </label>
                  <input
                    type="number"
                    value={Math.round(depositRate * 100)}
                    onChange={(e) =>
                      setDepositRate(Math.max(0, Math.min(100, Number(e.target.value))) / 100)
                    }
                    min={0}
                    max={100}
                    className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 transition-colors"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2.5">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      className="w-4 h-4 accent-rose-500 rounded"
                    />
                    <span className="text-[21px] text-noir-800">기본 템플릿으로 설정</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 계약 조항 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[21px] font-medium text-taupe-500 uppercase tracking-wider">
                계약 조항
              </h3>
              <button
                onClick={handleAddClause}
                className="flex items-center gap-1 px-3 py-1.5 text-[21px] text-rose-500 hover:bg-rose-500/5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                조항 추가
              </button>
            </div>
            <div className="space-y-3">
              {content.map((clause, idx) => (
                <div
                  key={idx}
                  className="border border-black/[0.04] rounded-xl p-4 bg-ivory-50/50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[21px] text-taupe-400 font-medium">
                      제{idx + 1}조
                    </span>
                    {content.length > 1 && (
                      <button
                        onClick={() => handleRemoveClause(idx)}
                        className="p-1 hover:bg-red-50 rounded text-taupe-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={clause.title}
                    onChange={(e) => handleClauseChange(idx, "title", e.target.value)}
                    placeholder="조항 제목 (예: 서비스 내용)"
                    className="w-full px-3 py-2 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 transition-colors mb-2"
                  />
                  <textarea
                    value={clause.body}
                    onChange={(e) => handleClauseChange(idx, "body", e.target.value)}
                    placeholder="조항 내용을 입력하세요..."
                    rows={3}
                    className="w-full px-3 py-2 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 transition-colors resize-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 취소/환불 정책 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[21px] font-medium text-taupe-500 uppercase tracking-wider">
                취소/환불 정책
              </h3>
              <button
                onClick={handleAddPolicy}
                className="flex items-center gap-1 px-3 py-1.5 text-[21px] text-rose-500 hover:bg-rose-500/5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                정책 추가
              </button>
            </div>
            <div className="space-y-2">
              {cancellationPolicy.map((policy, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-ivory-50/50 border border-black/[0.04] rounded-lg px-3 py-2"
                >
                  <span className="text-[21px] text-taupe-500 whitespace-nowrap">서비스</span>
                  <input
                    type="number"
                    value={policy.daysBefore}
                    onChange={(e) =>
                      handlePolicyChange(idx, "daysBefore", Number(e.target.value))
                    }
                    className="w-16 px-2 py-1.5 border border-platinum rounded text-[21px] text-center outline-none focus:border-rose-500"
                  />
                  <span className="text-[21px] text-taupe-500 whitespace-nowrap">일 전:</span>
                  <input
                    type="number"
                    value={policy.refundPercent}
                    onChange={(e) =>
                      handlePolicyChange(idx, "refundPercent", Number(e.target.value))
                    }
                    min={0}
                    max={100}
                    className="w-16 px-2 py-1.5 border border-platinum rounded text-[21px] text-center outline-none focus:border-rose-500"
                  />
                  <span className="text-[21px] text-taupe-500 whitespace-nowrap">% 환불</span>
                  <input
                    type="text"
                    value={policy.label}
                    onChange={(e) => handlePolicyChange(idx, "label", e.target.value)}
                    placeholder="설명"
                    className="flex-1 px-2 py-1.5 border border-platinum rounded text-[21px] outline-none focus:border-rose-500"
                  />
                  {cancellationPolicy.length > 1 && (
                    <button
                      onClick={() => handleRemovePolicy(idx)}
                      className="p-1 hover:bg-red-50 rounded text-taupe-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="sticky bottom-0 bg-white border-t border-black/[0.04] px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-platinum text-[21px] font-medium text-taupe-500 hover:bg-ivory-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim()}
            className="flex-1 py-3 rounded-xl bg-noir-800 text-white text-[21px] font-medium hover:bg-noir-soft transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "저장 중..." : isNew ? "생성하기" : "저장하기"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── 메인 페이지 ───
export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<VendorContractTemplate[]>([]);
  const [standardTemplates, setStandardTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTemplate, setEditTemplate] = useState<VendorContractTemplate | null | "new">(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const [vendorRes, standardRes] = await Promise.all([
        fetch("/api/vendor/contracts/templates"),
        fetch("/api/contracts/templates"),
      ]);
      const vendorData = await vendorRes.json();
      const standardData = await standardRes.json();
      setTemplates(vendorData.templates ?? []);
      setStandardTemplates(standardData.templates ?? []);
    } catch {
      console.error("템플릿 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSave = async (data: {
    baseTemplateId?: string;
    title: string;
    content: ContractClause[];
    cancellationPolicy: CancellationPolicyItem[];
    depositRate: number;
    isDefault: boolean;
  }) => {
    const isNew = editTemplate === "new";
    const url = isNew
      ? "/api/vendor/contracts/templates"
      : `/api/vendor/contracts/templates/${(editTemplate as VendorContractTemplate).id}`;
    const method = isNew ? "POST" : "PUT";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      setEditTemplate(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchTemplates();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 템플릿을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/vendor/contracts/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchTemplates();
    }
  };

  const handleDuplicate = async (template: VendorContractTemplate) => {
    const res = await fetch("/api/vendor/contracts/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: template.title + " (복사본)",
        content: template.content,
        cancellationPolicy: template.cancellationPolicy,
        depositRate: template.depositRate,
        isDefault: false,
      }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchTemplates();
    }
  };

  if (loading) {
    return (
      <div className="max-w-[955px] mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[955px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif-kr text-[21px] text-noir-800">계약 템플릿 관리</h2>
          <p className="text-[21px] text-taupe-500 font-light mt-0.5">
            계약서의 표준 양식을 관리합니다. 예약 확인 시 자동으로 적용됩니다.
          </p>
        </div>
        <button
          onClick={() => setEditTemplate("new")}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-gold text-white rounded-xl text-[21px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] transition-all"
        >
          <Plus className="w-4 h-4" />
          템플릿 생성
        </button>
      </motion.div>

      {/* 통계 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[21px] text-taupe-500 mb-1">내 템플릿</p>
          <p className="font-display text-[38px] text-noir-800">{templates.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[21px] text-taupe-500 mb-1">표준 템플릿</p>
          <p className="font-display text-[38px] text-[#2E7D5A]">{standardTemplates.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[21px] text-taupe-500 mb-1">기본 설정</p>
          <p className="font-display text-[38px] text-gold">
            {templates.filter((t) => t.isDefault).length > 0 ? "O" : "-"}
          </p>
        </div>
      </motion.div>

      {/* 알림: 기본 템플릿 미설정 */}
      {templates.length > 0 && !templates.some((t) => t.isDefault) && (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="bg-gold/5 border border-gold/20 rounded-xl px-5 py-3.5 flex items-center gap-3 mb-6"
        >
          <AlertTriangle className="w-4 h-4 text-gold flex-shrink-0" />
          <p className="text-[21px] text-charcoal">
            기본 템플릿이 설정되지 않았습니다. 예약 확인 시 자동 적용할 기본 템플릿을 지정해주세요.
          </p>
        </motion.div>
      )}

      {/* 템플릿 리스트 */}
      {templates.length === 0 ? (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl border border-black/[0.04] p-12 text-center"
        >
          <FileText className="w-12 h-12 text-taupe-400/40 mx-auto mb-4" />
          <p className="text-[21px] text-taupe-500 mb-2">등록된 계약 템플릿이 없습니다</p>
          <p className="text-[21px] text-taupe-400 font-light mb-6">
            표준 템플릿을 기반으로 커스텀 계약서를 만들어보세요
          </p>
          <button
            onClick={() => setEditTemplate("new")}
            className="inline-flex items-center gap-2 px-5 py-3 bg-noir-800 text-white rounded-xl text-[21px] font-medium hover:bg-noir-soft transition-colors"
          >
            <Plus className="w-4 h-4" />
            첫 번째 템플릿 만들기
          </button>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {templates.map((tmpl, i) => {
            const isExpanded = expandedId === tmpl.id;
            return (
              <motion.div
                key={tmpl.id}
                {...fadeIn}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04 }}
                className={`bg-white rounded-2xl border transition-colors ${
                  isExpanded ? "border-rose-500/30" : "border-black/[0.04]"
                }`}
              >
                {/* 카드 헤더 */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
                    className="flex-1 flex items-center gap-4 text-left"
                  >
                    <FileText className="w-5 h-5 text-taupe-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[21px] font-medium text-noir-800 truncate">
                          {tmpl.title}
                        </h3>
                        {tmpl.isDefault && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-gold/10 text-[21px] text-gold font-medium">
                            <Star className="w-2.5 h-2.5" />
                            기본
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[21px] text-taupe-400">
                        <span>{tmpl.content.length}개 조항</span>
                        <span>계약금 {Math.round(tmpl.depositRate * 100)}%</span>
                        <span>
                          {new Date(tmpl.createdAt).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-taupe-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-taupe-400" />
                    )}
                  </button>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleDuplicate(tmpl)}
                      className="p-2 rounded-lg hover:bg-ivory-50 text-taupe-400 hover:text-noir-800 transition-colors"
                      title="복제"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditTemplate(tmpl)}
                      className="p-2 rounded-lg hover:bg-ivory-50 text-taupe-400 hover:text-noir-800 transition-colors"
                      title="수정"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(tmpl.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-taupe-400 hover:text-red-500 transition-colors"
                      title="삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 펼쳐진 상세 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 pt-0 border-t border-black/[0.03]">
                        {/* 조항 내용 */}
                        <div className="mt-4 space-y-3">
                          {tmpl.content.map((clause, idx) => (
                            <div
                              key={idx}
                              className="bg-ivory-50/50 rounded-lg px-4 py-3 border border-black/[0.03]"
                            >
                              <p className="text-[21px] text-rose-500 font-medium mb-1">
                                제{idx + 1}조 {clause.title}
                              </p>
                              <p className="text-[21px] text-charcoal leading-relaxed whitespace-pre-wrap">
                                {clause.body}
                              </p>
                            </div>
                          ))}
                        </div>

                        {/* 취소 정책 */}
                        {tmpl.cancellationPolicy.length > 0 && (
                          <div className="mt-4">
                            <p className="text-[21px] text-taupe-400 font-medium uppercase tracking-wider mb-2">
                              취소/환불 정책
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {tmpl.cancellationPolicy.map((p, idx) => (
                                <span
                                  key={idx}
                                  className={`px-3 py-1.5 rounded-lg text-[21px] font-medium ${
                                    p.refundPercent >= 80
                                      ? "bg-[#2E7D5A]/10 text-[#2E7D5A]"
                                      : p.refundPercent >= 50
                                        ? "bg-gold/10 text-gold"
                                        : p.refundPercent > 0
                                          ? "bg-orange-500/10 text-orange-600"
                                          : "bg-red-500/10 text-red-500"
                                  }`}
                                >
                                  {p.label || `${p.daysBefore}일 전: ${p.refundPercent}%`}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 저장 알림 */}
      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-[#2E7D5A] text-white rounded-xl text-[21px] font-medium flex items-center gap-2 shadow-lg z-50"
          >
            <Check className="w-4 h-4" />
            저장되었습니다
          </motion.div>
        )}
      </AnimatePresence>

      {/* 편집 모달 */}
      <AnimatePresence>
        {editTemplate !== null && (
          <TemplateEditModal
            template={editTemplate === "new" ? null : editTemplate}
            standardTemplates={standardTemplates}
            onSave={handleSave}
            onClose={() => setEditTemplate(null)}
          />
        )}
      </AnimatePresence>

      {/* 안내 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-6 bg-ivory-warm rounded-xl p-4 flex items-start gap-3"
      >
        <FileText className="w-4 h-4 text-taupe-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[21px] text-taupe-500 font-light leading-relaxed">
            <strong className="font-medium">계약 템플릿</strong>은 예약 확인 시 자동으로 적용됩니다.
            플랫폼 표준 템플릿을 기반으로 업체에 맞는 조항과 취소 정책을 커스터마이즈할 수 있습니다.
            기본 템플릿을 설정하면 모든 새 계약에 자동 적용됩니다.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
