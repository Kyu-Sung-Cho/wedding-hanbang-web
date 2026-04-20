"use client";

import { useState, useEffect } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import type { Side } from "@/types/invitation.types";
import { Plus, Trash2, Save } from "lucide-react";

interface AccountForm {
  side: Side;
  label: string;
  bank: string;
  account_number: string;
  holder: string;
}

const BANKS = [
  "카카오뱅크", "국민은행", "신한은행", "하나은행", "우리은행",
  "NH농협", "기업은행", "SC제일은행", "토스뱅크", "케이뱅크",
  "대구은행", "부산은행", "광주은행", "전북은행", "경남은행",
];

const LABELS = {
  groom: ["신랑", "신랑 아버지", "신랑 어머니"],
  bride: ["신부", "신부 아버지", "신부 어머니"],
};

export default function StepAccount() {
  const { current, accounts, loadAccounts, saveAccounts } = useInvitationStore();
  const [forms, setForms] = useState<AccountForm[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (current?.id) loadAccounts(current.id);
  }, [current?.id, loadAccounts]);

  useEffect(() => {
    if (accounts.length > 0) {
      setForms(accounts.map((a) => ({
        side: a.side as Side,
        label: a.label,
        bank: a.bank,
        account_number: a.account_number,
        holder: a.holder,
      })));
    }
  }, [accounts]);

  const addAccount = (side: Side) => {
    const labels = LABELS[side === "both" ? "groom" : side];
    const usedLabels = forms.filter((f) => f.side === side).map((f) => f.label);
    const nextLabel = labels.find((l) => !usedLabels.includes(l)) ?? labels[0];
    setForms([...forms, { side, label: nextLabel, bank: "", account_number: "", holder: "" }]);
  };

  const updateForm = (index: number, key: keyof AccountForm, value: string) => {
    setForms(forms.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  };

  const removeForm = (index: number) => {
    setForms(forms.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!current?.id) return;
    setSaving(true);
    await saveAccounts(current.id, forms.map((f, i) => ({ ...f, sort_order: i })));
    setSaving(false);
  };

  if (!current) return null;

  const groomAccounts = forms.filter((f) => f.side === "groom");
  const brideAccounts = forms.filter((f) => f.side === "bride");

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">축의금 계좌</h2>
      <p className="text-[13px] text-taupe-500 mb-6">축의금을 받을 계좌를 등록하세요.</p>

      {/* 신랑측 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-medium text-noir-800">신랑 측</h3>
          <button
            onClick={() => addAccount("groom")}
            className="text-[12px] text-rose-500 hover:text-rose-600 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 추가
          </button>
        </div>
        {groomAccounts.length === 0 && (
          <p className="text-[12px] text-taupe-400 py-3 text-center border border-dashed border-taupe-400/20 rounded-xl">계좌를 추가하세요</p>
        )}
        {forms.map((form, i) =>
          form.side !== "groom" ? null : (
            <AccountRow key={i} form={form} index={i} onChange={updateForm} onRemove={removeForm} />
          )
        )}
      </div>

      {/* 신부측 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-medium text-noir-800">신부 측</h3>
          <button
            onClick={() => addAccount("bride")}
            className="text-[12px] text-rose-500 hover:text-rose-600 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 추가
          </button>
        </div>
        {brideAccounts.length === 0 && (
          <p className="text-[12px] text-taupe-400 py-3 text-center border border-dashed border-taupe-400/20 rounded-xl">계좌를 추가하세요</p>
        )}
        {forms.map((form, i) =>
          form.side !== "bride" ? null : (
            <AccountRow key={i} form={form} index={i} onChange={updateForm} onRemove={removeForm} />
          )
        )}
      </div>

      {/* 저장 */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3 bg-[#795252] text-white rounded-xl text-[14px] font-medium hover:bg-[#946a6a] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        <Save className="w-4 h-4" />
        {saving ? "저장 중..." : "계좌 정보 저장"}
      </button>
    </div>
  );
}

function AccountRow({
  form,
  index,
  onChange,
  onRemove,
}: {
  form: AccountForm;
  index: number;
  onChange: (index: number, key: keyof AccountForm, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3 mb-2 bg-ivory-50 rounded-xl">
      <div className="flex items-center justify-between">
        <input
          type="text"
          value={form.label}
          onChange={(e) => onChange(index, "label", e.target.value)}
          className="text-[13px] font-medium text-noir-800 bg-transparent border-none focus:outline-none"
          placeholder="표시 이름"
        />
        <button onClick={() => onRemove(index)} className="text-taupe-400 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select
          value={form.bank}
          onChange={(e) => onChange(index, "bank", e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-black/[0.06] text-[12px] text-noir-800 focus:outline-none focus:border-rose-500"
        >
          <option value="">은행 선택</option>
          {BANKS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <input
          type="text"
          value={form.account_number}
          onChange={(e) => onChange(index, "account_number", e.target.value)}
          placeholder="계좌번호"
          className="px-2 py-1.5 rounded-lg border border-black/[0.06] text-[12px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
        />
        <input
          type="text"
          value={form.holder}
          onChange={(e) => onChange(index, "holder", e.target.value)}
          placeholder="예금주"
          className="px-2 py-1.5 rounded-lg border border-black/[0.06] text-[12px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
        />
      </div>
    </div>
  );
}
