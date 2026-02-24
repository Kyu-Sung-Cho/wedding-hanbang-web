"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Package,
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  Star,
  GripVertical,
  X,
  Save,
  Check,
  ChevronDown,
  ChevronUp,
  Tag,
  Clock,
  Timer,
} from "lucide-react";
import {
  CATEGORY_PRODUCT_FIELDS,
  formatDuration,
  type ProductFieldDef,
} from "@/data/mockVendors";
import type { VendorProduct, VendorCategory, TimeSlot } from "@/types/vendor.types";
import { useVendorStore } from "@/stores/vendorStore";
import WeeklyTimeGrid from "@/components/vendor/WeeklyTimeGrid";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

// 신규 상품용 빈 타임슬롯 생성
function generateEmptySlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 9; hour <= 20; hour++) {
      slots.push({ day, hour, available: false, maxBookings: 1, currentBookings: 0 });
    }
  }
  return slots;
}

// 가격 포맷
function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}만원`;
  return `${price.toLocaleString()}원`;
}

// 카테고리 필드 값 렌더
function renderFieldValue(field: ProductFieldDef, value: unknown): string {
  if (value === undefined || value === null) return "-";
  if (field.type === "boolean") return value ? "포함" : "미포함";
  if (field.type === "multiselect" && Array.isArray(value)) return value.join(", ");
  if (field.type === "number" && field.unit) return `${value}${field.unit}`;
  return String(value);
}

// 동적 폼 필드 컴포넌트
function DynamicField({ field, value, onChange }: {
  field: ProductFieldDef;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  switch (field.type) {
    case "text":
    case "number":
      return (
        <input
          type={field.type}
          value={value as string ?? ""}
          onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
          placeholder={field.placeholder}
          className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors"
        />
      );
    case "textarea":
      return (
        <textarea
          value={value as string ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors resize-none"
        />
      );
    case "select":
      return (
        <select
          value={value as string ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors bg-white"
        >
          <option value="">선택</option>
          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "multiselect": {
      const selected = (Array.isArray(value) ? value : []) as string[];
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
                onChange(next);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                selected.includes(opt) ? "bg-noir-800 text-white border-noir-800" : "text-charcoal border-platinum hover:border-rose-500"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }
    case "boolean":
      return (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`w-11 h-6 rounded-full transition-colors relative ${value ? "bg-rose-500" : "bg-taupe-400/30"}`}
        >
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${value ? "left-[22px]" : "left-0.5"}`} />
        </button>
      );
    default:
      return null;
  }
}

// 상품 편집 모달
function ProductEditModal({ product, category, onSave, onClose }: {
  product: VendorProduct | null;
  category: VendorCategory;
  onSave: (p: VendorProduct) => void;
  onClose: () => void;
}) {
  const config = CATEGORY_PRODUCT_FIELDS[category];
  const isNew = !product;

  const [form, setForm] = useState<VendorProduct>(product ?? {
    id: `p-new-${Date.now()}`,
    vendorId: "v1",
    name: "",
    description: "",
    price: 0,
    duration: 60,
    isActive: true,
    isPopular: false,
    sortOrder: 0,
    categoryFields: {},
    includes: [],
    excludes: [],
    images: [],
    timeSlots: generateEmptySlots(),
    createdAt: new Date().toISOString().split("T")[0],
    updatedAt: new Date().toISOString().split("T")[0],
  });
  const [showTimeGrid, setShowTimeGrid] = useState(!!product?.timeSlots?.some(s => s.available));

  const [includeInput, setIncludeInput] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const groups: Record<string, boolean> = {};
    config.fields.forEach((f) => { if (f.group) groups[f.group] = true; });
    return groups;
  });

  const groupedFields = config.fields.reduce<Record<string, ProductFieldDef[]>>((acc, f) => {
    const group = f.group || "기타";
    if (!acc[group]) acc[group] = [];
    acc[group].push(f);
    return acc;
  }, {});

  const handleAddInclude = () => {
    if (includeInput.trim()) {
      setForm({ ...form, includes: [...form.includes, includeInput.trim()] });
      setIncludeInput("");
    }
  };

  return (
    <div className="fixed inset-0 bg-noir-800/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-[700px] mx-4 overflow-hidden"
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-black/[0.04] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-[17px] font-medium text-noir-800">
            {isNew ? `${config.productLabel} 등록` : `${config.productLabel} 수정`}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-ivory-50 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-taupe-400" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* 기본 정보 */}
          <div>
            <h3 className="text-[13px] font-medium text-taupe-500 mb-3 uppercase tracking-wider">기본 정보</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-noir-800 mb-1.5">상품명 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`예: 프리미엄 ${config.productLabel}`} className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-noir-800 mb-1.5">상품 설명</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="고객에게 보이는 상품 소개글" className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-noir-800 mb-1.5">가격 (원) *</label>
                  <input type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} placeholder="2500000" className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-noir-800 mb-1.5">할인가 (원)</label>
                  <input type="number" value={form.discountPrice || ""} onChange={(e) => setForm({ ...form, discountPrice: Number(e.target.value) || undefined })} placeholder="할인 시 입력" className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-noir-800 mb-1.5">소요 시간 (분) *</label>
                <div className="flex items-center gap-3">
                  <input type="number" value={form.duration || 60} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} placeholder="120" min={15} step={15} className="w-[120px] px-3 py-2.5 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors" />
                  <span className="text-[12px] text-taupe-400">= {formatDuration(form.duration || 60)}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isPopular} onChange={(e) => setForm({ ...form, isPopular: e.target.checked })} className="w-4 h-4 accent-rose-500 rounded" />
                  <span className="text-[13px] text-noir-800">인기 상품으로 표시</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 accent-rose-500 rounded" />
                  <span className="text-[13px] text-noir-800">활성 (고객 노출)</span>
                </label>
              </div>
            </div>
          </div>

          {/* 카테고리별 상세 필드 */}
          {Object.entries(groupedFields).map(([group, fields]) => (
            <div key={group}>
              <button
                type="button"
                onClick={() => setExpandedGroups({ ...expandedGroups, [group]: !expandedGroups[group] })}
                className="flex items-center gap-2 text-[13px] font-medium text-taupe-500 mb-3 uppercase tracking-wider w-full"
              >
                {expandedGroups[group] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {group}
              </button>
              {expandedGroups[group] && (
                <div className="space-y-3 pl-1">
                  {fields.map((field) => (
                    <div key={field.key} className={`${field.type === "boolean" ? "flex items-center justify-between" : ""}`}>
                      <label className="block text-[12px] font-medium text-noir-800 mb-1.5">
                        {field.label}
                        {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                        {field.unit && <span className="text-taupe-400 font-normal ml-1">({field.unit})</span>}
                      </label>
                      <DynamicField
                        field={field}
                        value={form.categoryFields[field.key]}
                        onChange={(val) => setForm({ ...form, categoryFields: { ...form.categoryFields, [field.key]: val as string | number | boolean | string[] } })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* 포함 항목 */}
          <div>
            <h3 className="text-[13px] font-medium text-taupe-500 mb-3 uppercase tracking-wider">포함 항목</h3>
            <div className="flex gap-2 mb-2">
              <input type="text" value={includeInput} onChange={(e) => setIncludeInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddInclude())} placeholder="포함 항목 입력 후 Enter" className="flex-1 px-3 py-2 border border-platinum rounded-lg text-[13px] outline-none focus:border-rose-500 transition-colors" />
              <button type="button" onClick={handleAddInclude} className="px-3 py-2 bg-noir-800 text-white rounded-lg text-[12px] font-medium hover:bg-noir-soft transition-colors">추가</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {form.includes.map((item, idx) => (
                <span key={idx} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-ivory-warm text-[11px] text-charcoal font-medium">
                  {item}
                  <button type="button" onClick={() => setForm({ ...form, includes: form.includes.filter((_, i) => i !== idx) })} className="hover:text-red-500 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* 예약 가능 시간 (캐치테이블 스타일) */}
          <div>
            <button
              type="button"
              onClick={() => setShowTimeGrid(!showTimeGrid)}
              className="flex items-center gap-2 text-[13px] font-medium text-taupe-500 mb-3 uppercase tracking-wider w-full"
            >
              {showTimeGrid ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <Clock className="w-3.5 h-3.5" />
              예약 가능 시간 설정
              <span className="text-[11px] font-normal text-taupe-400 ml-1">
                ({form.timeSlots?.filter(s => s.available).length || 0}개 슬롯 활성)
              </span>
            </button>
            {showTimeGrid && (
              <div className="border border-black/[0.04] rounded-xl p-4 bg-ivory-50/50">
                <p className="text-[12px] text-taupe-400 font-light mb-3">
                  이 상품의 예약 가능한 시간을 설정합니다. 클릭/드래그로 활성화하세요.
                </p>
                <WeeklyTimeGrid
                  slots={form.timeSlots || generateEmptySlots()}
                  onChange={(newSlots) => setForm({ ...form, timeSlots: newSlots })}
                />
              </div>
            )}
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="sticky bottom-0 bg-white border-t border-black/[0.04] px-6 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-platinum text-[14px] font-medium text-taupe-500 hover:bg-ivory-50 transition-colors">취소</button>
          <button onClick={() => onSave(form)} className="flex-1 py-3 rounded-xl bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors flex items-center justify-center gap-2">
            <Save className="w-4 h-4" />{isNew ? "등록하기" : "저장하기"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function VendorProductsPage() {
  const { vendor, products, createProduct, updateProduct, deleteProduct } = useVendorStore();
  const category = (vendor?.category ?? "스튜디오") as VendorCategory;
  const config = CATEGORY_PRODUCT_FIELDS[category];

  const [editProduct, setEditProduct] = useState<VendorProduct | null | "new">(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeCount = products.filter((p) => p.isActive).length;
  const popularCount = products.filter((p) => p.isPopular).length;

  const handleSaveProduct = async (p: VendorProduct) => {
    setSaving(true);
    let success: boolean;
    if (editProduct === "new") {
      success = await createProduct({ ...p, sortOrder: products.length + 1 });
    } else {
      success = await updateProduct(p.id, p);
    }
    setSaving(false);
    if (success) {
      setEditProduct(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 상품을 삭제하시겠습니까?")) return;
    await deleteProduct(id);
  };

  const handleToggleActive = async (id: string) => {
    const product = products.find((p) => p.id === id);
    if (product) {
      await updateProduct(id, { isActive: !product.isActive });
    }
  };

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif-kr text-[20px] text-noir-800">
            {config.productLabel} 관리
          </h2>
          <p className="text-[13px] text-taupe-500 font-light mt-0.5">
            고객에게 보여지는 상품/패키지를 관리합니다
          </p>
        </div>
        <button
          onClick={() => setEditProduct("new")}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-gold text-white rounded-xl text-[13px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] transition-all"
        >
          <Plus className="w-4 h-4" />
          {config.productLabel} 추가
        </button>
      </motion.div>

      {/* 통계 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[12px] text-taupe-500 mb-1">전체 상품</p>
          <p className="font-display text-[24px] text-noir-800">{products.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[12px] text-taupe-500 mb-1">노출 중</p>
          <p className="font-display text-[24px] text-[#2E7D5A]">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-4 text-center">
          <p className="text-[12px] text-taupe-500 mb-1">인기 상품</p>
          <p className="font-display text-[24px] text-gold">{popularCount}</p>
        </div>
      </motion.div>

      {/* 상품 리스트 */}
      {products.length === 0 ? (
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl border border-black/[0.04] p-12 text-center">
          <Package className="w-12 h-12 text-taupe-400/40 mx-auto mb-4" />
          <p className="text-[15px] text-taupe-500 mb-2">등록된 상품이 없습니다</p>
          <p className="text-[13px] text-taupe-400 font-light mb-6">첫 번째 {config.productLabel}을 등록해보세요</p>
          <button onClick={() => setEditProduct("new")} className="inline-flex items-center gap-2 px-5 py-3 bg-noir-800 text-white rounded-xl text-[13px] font-medium hover:bg-noir-soft transition-colors">
            <Plus className="w-4 h-4" />{config.productLabel} 등록
          </button>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {products.map((product, i) => {
            const isExpanded = expandedProduct === product.id;
            return (
              <motion.div
                key={product.id}
                {...fadeIn}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04 }}
                className={`bg-white rounded-2xl border transition-colors ${isExpanded ? "border-rose-500/30" : "border-black/[0.04]"}`}
              >
                {/* 상품 카드 헤더 */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <GripVertical className="w-4 h-4 text-taupe-400/40 flex-shrink-0 cursor-grab" />
                  <button onClick={() => setExpandedProduct(isExpanded ? null : product.id)} className="flex-1 flex items-center gap-4 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[15px] font-medium text-noir-800 truncate">{product.name}</h3>
                        {product.isPopular && <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-gold/10 text-[10px] text-gold font-medium"><Star className="w-2.5 h-2.5" />인기</span>}
                        {!product.isActive && <span className="px-2 py-0.5 rounded-full bg-taupe-400/10 text-[10px] text-taupe-400 font-medium">비공개</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {product.discountPrice ? (
                          <>
                            <span className="text-[14px] font-medium text-rose-500">{formatPrice(product.discountPrice)}</span>
                            <span className="text-[12px] text-taupe-400 line-through">{formatPrice(product.price)}</span>
                          </>
                        ) : (
                          <span className="text-[14px] font-medium text-noir-800">{formatPrice(product.price)}</span>
                        )}
                        {product.duration > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-taupe-400">
                            <Timer className="w-3 h-3" />{formatDuration(product.duration)}
                          </span>
                        )}
                        {product.timeSlots?.filter(s => s.available).length > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-[#2E7D5A]">
                            <Clock className="w-3 h-3" />{product.timeSlots.filter(s => s.available).length}슬롯
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-taupe-400" /> : <ChevronDown className="w-4 h-4 text-taupe-400" />}
                  </button>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleToggleActive(product.id)} className={`p-2 rounded-lg transition-colors ${product.isActive ? "hover:bg-ivory-50 text-[#2E7D5A]" : "hover:bg-ivory-50 text-taupe-400"}`} title={product.isActive ? "비공개로 전환" : "공개로 전환"}>
                      {product.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditProduct(product)} className="p-2 rounded-lg hover:bg-ivory-50 text-taupe-400 hover:text-noir-800 transition-colors">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(product.id)} className="p-2 rounded-lg hover:bg-red-50 text-taupe-400 hover:text-red-500 transition-colors">
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
                        {product.description && (
                          <p className="text-[13px] text-taupe-500 font-light mt-4 mb-4">{product.description}</p>
                        )}

                        {/* 포함 항목 */}
                        {product.includes.length > 0 && (
                          <div className="mb-4">
                            <p className="text-[11px] text-taupe-400 font-medium uppercase tracking-wider mb-2">포함 항목</p>
                            <div className="flex flex-wrap gap-1.5">
                              {product.includes.map((item, idx) => (
                                <span key={idx} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#2E7D5A]/10 text-[11px] text-[#2E7D5A] font-medium">
                                  <Check className="w-2.5 h-2.5" />{item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 카테고리별 상세 필드 */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-sm:grid-cols-1">
                          {config.fields.map((field) => {
                            const val = product.categoryFields[field.key];
                            if (val === undefined || val === null || val === "" || val === false) return null;
                            return (
                              <div key={field.key} className="flex items-center justify-between py-1.5">
                                <span className="text-[12px] text-taupe-400">{field.label}</span>
                                <span className="text-[12px] text-noir-800 font-medium">{renderFieldValue(field, val)}</span>
                              </div>
                            );
                          })}
                        </div>
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
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-[#2E7D5A] text-white rounded-xl text-[14px] font-medium flex items-center gap-2 shadow-lg"
          >
            <Check className="w-4 h-4" />저장되었습니다
          </motion.div>
        )}
      </AnimatePresence>

      {/* 편집 모달 */}
      <AnimatePresence>
        {editProduct !== null && (
          <ProductEditModal
            product={editProduct === "new" ? null : editProduct}
            category={vendor?.category ?? "스튜디오"}
            onSave={handleSaveProduct}
            onClose={() => setEditProduct(null)}
          />
        )}
      </AnimatePresence>

      {/* 카테고리 안내 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.2 }} className="mt-6 bg-ivory-warm rounded-xl p-4 flex items-start gap-3">
        <Tag className="w-4 h-4 text-taupe-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[12px] text-taupe-500 font-light leading-relaxed">
            <strong className="font-medium">{category}</strong> 카테고리에 최적화된 상품 필드가 제공됩니다.
            카테고리에 따라 촬영 패키지, 드레스 상품, 메이크업 패키지 등 각 업종에 맞는 상세 옵션을 설정할 수 있습니다.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
