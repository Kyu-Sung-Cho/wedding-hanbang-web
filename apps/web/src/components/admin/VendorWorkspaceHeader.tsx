"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, Sparkles, Store, ArrowLeft } from "lucide-react";

type ActiveWorkspace = "price" | "enrich";

export function VendorWorkspaceHeader({ active }: { active: ActiveWorkspace }) {
  const navigation = [
    { key: "price" as const, href: "/admin/price", label: "공시 가격 검수", icon: Database },
    { key: "enrich" as const, href: "/admin/enrich", label: "업체 정보 보강", icon: Sparkles },
  ];
  return (
    <header className="border-b border-[#E2D3C8] bg-[var(--hb-surface-page)]">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--hb-primary)] text-white">
            <Store aria-hidden="true" size={19} />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--color-rose-700)]">WEDDING HANBANG ADMIN</p>
            <h1 className="text-lg font-bold text-[var(--hb-text-strong)]">업체 데이터 운영실</h1>
          </div>
        </div>
        <nav aria-label="업체 데이터 관리" className="flex flex-wrap items-center gap-2">
          {navigation.map(({ key, href, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              aria-current={active === key ? "page" : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-[6px] px-3.5 text-sm font-semibold transition-colors ${
                active === key
                  ? "bg-[var(--hb-primary)] text-white"
                  : "text-[var(--hb-text-strong)] hover:bg-[#EFE4D7]"
              }`}
            >
              <Icon aria-hidden="true" size={16} />
              {label}
            </Link>
          ))}
          <Link
            href="/admin"
            className="inline-flex min-h-10 items-center gap-2 rounded-[6px] px-3.5 text-sm font-semibold text-[#6D806E] hover:bg-[#EFE4D7]"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            전체 관리
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function AdminLoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[360px] place-items-center" role="status">
      <div className="text-center">
        <span className="mx-auto mb-3 block h-8 w-8 animate-spin rounded-full border-2 border-[#C7D1C2] border-t-[var(--hb-primary)]" />
        <p className="text-sm text-[#6D806E]">{label}</p>
      </div>
    </div>
  );
}

export function AdminErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto my-16 max-w-lg rounded-[6px] border border-[#D95F5F]/30 bg-white p-7 text-center" role="alert">
      <p className="font-semibold text-[var(--hb-text-strong)]">데이터를 불러오지 못했습니다</p>
      <p className="mt-2 text-sm leading-6 text-[#6D806E]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 min-h-11 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white"
      >
        다시 시도
      </button>
    </div>
  );
}

export function SignedSourceLink({
  priceId,
  label = "원본 열기",
  expectedCount = 1,
  kind = "price",
}: {
  priceId: string;
  label?: string;
  expectedCount?: number;
  kind?: "price" | "agency_package";
}) {
  const [files, setFiles] = useState<Array<{ label: string; signed_url: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/price/${priceId}/source?kind=${kind}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "원본 파일을 열 수 없습니다.");
      setFiles(body.files ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "원본 파일을 열 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (files.length > 0) {
    return (
      <span className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <a
            key={`${file.signed_url}-${index}`}
            href={file.signed_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-xs font-semibold text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)]"
          >
            {files.length > 1 ? `원본 ${index + 1} · ` : ""}{file.label}
          </a>
        ))}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      title={error || undefined}
      className="inline-flex min-h-9 items-center rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-xs font-semibold text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)]"
    >
      {loading ? "원본 링크 준비 중…" : error ? "원본 다시 열기" : `${label}${expectedCount > 1 ? ` ${expectedCount}개` : ""}`}
    </button>
  );
}
