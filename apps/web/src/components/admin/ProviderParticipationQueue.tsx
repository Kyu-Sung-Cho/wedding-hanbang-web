"use client";

import { ArrowLeft, ChevronRight, Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";

import {
  PROVIDER_CATEGORY_LABELS,
  PROVIDER_KIND_LABELS,
  providerWorkspaceSchema,
  type BusinessInquiry,
  type ProviderApplication,
  type ProviderOffering,
  type ProviderProfile,
  type ProviderWorkspace,
} from "@/lib/providers/contracts";

type Authorization = "loading" | "authorized" | "denied" | "error";

const inputClass = "mt-2 block w-full rounded-lg border border-[var(--color-paper-outline)] bg-white px-3 py-2.5 text-sm leading-6 text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)] disabled:opacity-50";

type QueueTab = "inquiries" | "applications" | "offerings";
type ReviewAction = "approve" | "reject" | "request_changes" | "suspend" | "restore" | "reviewing" | "responded" | "closed";
type ReviewCommand = {
  kind: "application" | "offering" | "profile" | "inquiry";
  action: ReviewAction;
  expected_version: number;
  reason?: string;
  recommendation_status?: "unreviewed" | "eligible";
  reply?: string;
};
type Confirmation = { id: string; label: string; command: ReviewCommand };

const tabs: { key: QueueTab; label: string }[] = [
  { key: "inquiries", label: "비즈니스 문의" },
  { key: "applications", label: "등록 심사" },
  { key: "offerings", label: "서비스 검토" },
];
const statusLabels: Record<string, string> = {
  all: "전체", pending: "검토 대기", changes_requested: "보완 요청", approved: "승인", rejected: "반려", suspended: "이용 정지",
  received: "접수", reviewing: "검토 중", responded: "답변 등록", closed: "종료",
  draft: "비공개", published: "공개 중", paused: "공개 중지",
  unreviewed: "미검토", eligible: "자격 확인", needs_review: "재검토 필요", blocked: "추천 차단",
};
const inquiryKindLabels: Record<BusinessInquiry["kind"], string> = {
  collaboration: "협업·사업 제안", media: "기관·매체", data: "콘텐츠·데이터", other: "기타",
};

function categoryLabel(value: string) {
  const found = Object.entries(PROVIDER_CATEGORY_LABELS).find(([key]) => key === value);
  return found?.[1] ?? value;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 확인 필요" : new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(date);
}

function Status({ value }: { value: string }) {
  return <span className="inline-flex rounded-md bg-[var(--hb-surface-hover)] px-2 py-1 text-xs font-medium text-[var(--hb-text-body)]">{statusLabels[value] ?? value}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-[var(--hb-text-muted)]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{children || "미입력"}</dd></div>;
}

function ProfileSummary({ profile }: { profile: ProviderProfile | undefined }) {
  if (!profile) return <p className="text-sm text-[var(--hb-text-muted)]">이 프로필은 현재 불러온 범위에 없습니다. 관리권·공개 상태는 별도 확인이 필요합니다.</p>;
  return (
    <dl className="grid gap-4 border-b border-[var(--hb-hairline)] pb-5 sm:grid-cols-2">
      <Field label="제공자">{profile.name} · {PROVIDER_KIND_LABELS[profile.kind]}</Field>
      <Field label="공개 상태"><Status value={profile.publication_status} /></Field>
      <Field label="등록 자격"><Status value={profile.approval_status} /></Field>
      <Field label="활동 지역">{profile.regions.join(", ")}</Field>
      <div className="sm:col-span-2"><Field label="소개">{profile.introduction}</Field></div>
    </dl>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function ProviderParticipationQueue() {
  const [authorization, setAuthorization] = useState<Authorization>("loading");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [showConsentRecovery, setShowConsentRecovery] = useState(false);
  const [workspace, setWorkspace] = useState<ProviderWorkspace | null>(null);
  const [tab, setTab] = useState<QueueTab>("inquiries");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [reply, setReply] = useState("");
  const [recommendationEligible, setRecommendationEligible] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const submitting = useRef(false);
  const loadGeneration = useRef(0);

  const loadWorkspace = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    setConfirmation(null);
    try {
      const response = await fetch("/api/admin/providers", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (generation !== loadGeneration.current) return;
      if (response.status === 401 || response.status === 403) {
        setShowConsentRecovery(response.status === 403);
        setAuthorization("denied");
        setWorkspace(null);
        return;
      }
      if (!response.ok) {
        setLoadError(response.status === 503
          ? "제공자 참여 기능이 아직 준비되지 않았습니다. 운영 설정을 확인한 뒤 다시 시도해 주세요."
          : "참여 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setWorkspace(null);
        return;
      }
      const parsed = providerWorkspaceSchema.safeParse(body);
      if (!parsed.success) {
        setLoadError("참여 목록을 안전하게 확인하지 못했습니다. 목록을 다시 불러와 주세요.");
        setWorkspace(null);
        return;
      }
      setWorkspace(parsed.data);
      setRefreshRequired(false);
    } catch {
      if (generation === loadGeneration.current) {
        setLoadError("참여 목록을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
        setWorkspace(null);
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function authorize() {
      setAuthorization("loading");
      setShowConsentRecovery(false);
      try {
        const response = await fetch("/api/admin/auth", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setAuthorization("denied");
        } else if (!response.ok || !isRecord(body) || typeof body.isAdmin !== "boolean") {
          setAuthorization("error");
        } else {
          setAuthorization(body.isAdmin ? "authorized" : "denied");
        }
      } catch {
        if (!controller.signal.aborted) setAuthorization("error");
      }
    }
    void authorize();
    return () => controller.abort();
  }, [authAttempt]);

  useEffect(() => {
    if (authorization === "authorized") void loadWorkspace();
    return () => { loadGeneration.current += 1; };
  }, [authorization, loadWorkspace]);

  function resetSelection() {
    setSelectedId(null);
    setConfirmation(null);
    setReason("");
    setReply("");
    setRecommendationEligible(false);
    setActionError("");
    setNotice("");
  }

  function selectTab(next: QueueTab) {
    setTab(next);
    setFilter("all");
    resetSelection();
  }

  function selectItem(id: string) {
    resetSelection();
    setSelectedId(id);
  }

  function stageReview(id: string, command: ReviewCommand, label: string) {
    if (submitting.current || refreshRequired) return;
    setActionError("");
    setNotice("");
    if (command.kind === "inquiry") {
      if (command.action === "responded" && reply.trim().length === 0) {
        setActionError("신청자가 볼 답변을 작성해 주세요.");
        return;
      }
      if (command.action === "responded") command.reply = reply.trim();
    } else {
      if (reason.trim().length < 3) {
        setActionError("직접 확인한 내용과 처리 사유를 3자 이상 작성해 주세요.");
        return;
      }
      command.reason = reason.trim();
    }
    if (command.kind === "offering" && command.action === "approve") {
      command.recommendation_status = recommendationEligible ? "eligible" : "unreviewed";
    }
    setConfirmation({ id, command, label });
  }

  async function submitReview() {
    if (!confirmation || submitting.current || refreshRequired) return;
    submitting.current = true;
    setBusy(true);
    setActionError("");
    const submitted = confirmation;
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(submitted.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted.command),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setShowConsentRecovery(response.status === 403);
        setWorkspace(null);
        setAuthorization("denied");
        return;
      }
      if (response.status === 409) {
        setRefreshRequired(true);
        setConfirmation(null);
        setActionError("다른 변경이 먼저 반영되었습니다. 목록을 새로고침하고 최신 내용을 다시 검토해 주세요.");
        return;
      }
      if (!response.ok || !isRecord(body) || body.success !== true) {
        if (response.status >= 500 || response.ok) {
          setRefreshRequired(true);
          setConfirmation(null);
          setActionError("처리 결과를 확인하지 못했습니다. 다시 처리하기 전에 목록을 새로고침해 상태를 확인해 주세요.");
        } else {
          setActionError("처리할 수 없습니다. 입력 내용과 현재 상태를 확인해 주세요.");
        }
        return;
      }
      setConfirmation(null);
      setReason("");
      setReply("");
      setRecommendationEligible(false);
      setNotice(submitted.command.kind === "inquiry" && submitted.command.action === "responded"
        ? "답변을 신청자 센터에 등록했습니다. 이메일 발송을 뜻하지 않습니다."
        : submitted.command.kind === "application" && submitted.command.action === "approve"
          ? "등록을 승인했습니다. 공개 시작과 서비스·추천 자격 승인은 별도입니다."
          : `${submitted.label} 처리를 기록했습니다.`);
      await loadWorkspace();
    } catch {
      setRefreshRequired(true);
      setConfirmation(null);
      setActionError("처리 결과를 확인하지 못했습니다. 다시 처리하기 전에 목록을 새로고침해 상태를 확인해 주세요.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const application = tab === "applications" ? workspace?.applications.find((item) => item.id === selectedId) : undefined;
  const offering = tab === "offerings" ? workspace?.offerings.find((item) => item.id === selectedId) : undefined;
  const inquiry = tab === "inquiries" ? workspace?.business_inquiries.find((item) => item.id === selectedId) : undefined;
  const profile = workspace?.profiles.find((item) => item.id === (application?.provider_id ?? offering?.provider_id));
  const disabled = busy || loading || refreshRequired;
  const rows = !workspace ? [] : tab === "inquiries"
    ? workspace.business_inquiries.map((item) => ({ id: item.id, name: item.subject, subtitle: `${inquiryKindLabels[item.kind]} · ${item.contact_name}`, status: item.status, createdAt: item.created_at }))
    : tab === "applications"
      ? workspace.applications.map((item) => ({ id: item.id, name: item.name, subtitle: `${PROVIDER_KIND_LABELS[item.kind]} · ${item.categories.map(categoryLabel).join(", ")}`, status: workspace.profiles.find((candidate) => candidate.id === item.provider_id)?.approval_status === "suspended" ? "suspended" : item.status, createdAt: item.created_at }))
      : workspace.offerings.map((item) => ({ id: item.id, name: item.name, subtitle: `${workspace.profiles.find((candidate) => candidate.id === item.provider_id)?.name ?? "제공자 확인 필요"} · ${categoryLabel(item.category)}`, status: workspace.profiles.find((candidate) => candidate.id === item.provider_id)?.approval_status === "suspended" ? "suspended" : item.review_status, createdAt: item.created_at }));
  const filteredRows = rows.filter((item) => filter === "all" || item.status === filter);
  const filters = tab === "inquiries" ? ["all", "received", "reviewing", "responded", "closed"]
    : tab === "applications" ? ["all", "pending", "changes_requested", "approved", "rejected", "suspended"]
      : ["all", "pending", "approved", "rejected", "suspended"];

  function reviewButton(id: string, command: ReviewCommand, label: string, blocked = false) {
    return <Button disabled={disabled || blocked} variant={command.action === "approve" || command.action === "responded" ? "primary" : "secondary"} onClick={() => stageReview(id, command, label)}>{label}</Button>;
  }

  return (
    <main className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]">
      <header className="border-b border-[var(--hb-hairline)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 lg:px-8">
          <div>
            <p className="text-xs font-semibold text-[var(--hb-text-muted)]">웨딩한방 관리자</p>
            <h1 className="mt-1 text-2xl font-semibold">제공자 참여 관리</h1>
          </div>
          <Button href="/admin">
            <ArrowLeft size={16} aria-hidden="true" />전체 관리
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        {authorization === "authorized" && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm leading-6 text-[var(--hb-text-body)]">개인·팀·업체의 참여를 같은 기준으로 검토합니다. 등록 승인 후 소개·사진은 제공자가 직접 게시하며, 서비스·가격과 추천 자격은 따로 확인합니다.</p>
                <p className="mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">각 목록의 최근 최대 100건을 불러옵니다. 아래 건수와 필터는 불러온 범위에만 적용됩니다.</p>
              </div>
              <Button disabled={busy || loading} onClick={() => void loadWorkspace()}><RefreshCcw size={16} aria-hidden="true" />목록 새로고침</Button>
            </div>
            <div role="tablist" aria-label="제공자 참여 업무" className="mt-7 flex gap-1 overflow-x-auto border-b border-[var(--hb-hairline)]">
              {tabs.map((item, index) => (
                <Button variant="ghost" key={item.key} id={`provider-tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls="provider-queue-panel" tabIndex={tab === item.key ? 0 : -1} disabled={busy} onClick={() => selectTab(item.key)} onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  selectTab(tabs[next].key);
                  document.getElementById(`provider-tab-${tabs[next].key}`)?.focus();
                }} className={`min-h-12! shrink-0 rounded-none! border-b-2 px-4! ${tab === item.key ? "border-[var(--hb-action)] text-[var(--hb-text-strong)]" : "border-transparent text-[var(--hb-text-muted)]"}`}>{item.label}</Button>
              ))}
            </div>
            <section id="provider-queue-panel" role="tabpanel" aria-labelledby={`provider-tab-${tab}`} className="pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm font-medium">상태
                  <select value={filter} disabled={busy} onChange={(event) => { setFilter(event.target.value); resetSelection(); }} className="min-h-11 rounded-lg border border-[var(--color-paper-outline)] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">
                    {filters.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
                  </select>
                </label>
                {workspace && <p className="text-xs tabular-nums text-[var(--hb-text-muted)]">불러온 {rows.length}건 중 {filteredRows.length}건</p>}
              </div>
              {notice && <p role="status" className="mt-4 rounded-lg bg-[var(--hb-surface-hover)] p-4 text-sm leading-6">{notice}</p>}
              {actionError && <div role="alert" className="mt-4 border-l-2 border-danger-700 pl-4 text-sm leading-6 text-danger-700">{actionError}</div>}
              {loading && <p role="status" className="flex items-center gap-2 py-12 text-sm"><Loader2 size={18} className="animate-spin" aria-hidden="true" />참여 목록을 불러오고 있습니다.</p>}
              {!loading && loadError && <div role="alert" className="py-12"><p className="text-sm leading-6">{loadError}</p><Button onClick={() => void loadWorkspace()} className="mt-4">다시 불러오기</Button></div>}
              {!loading && workspace && (
                <div className="mt-5 grid items-start gap-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <section aria-label="접수 목록">
                    {filteredRows.length === 0 ? <p className="border-y border-[var(--hb-hairline)] py-12 text-sm leading-6 text-[var(--hb-text-muted)]">불러온 범위에 해당하는 {tab === "inquiries" ? "문의가" : tab === "applications" ? "등록 신청이" : "서비스가"} 없습니다. 다른 상태를 선택하거나 목록을 새로고침해 주세요.</p>
                      : <ul className="divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">{filteredRows.map((item) => <li key={item.id}><Button variant="ghost" fullWidth disabled={busy} aria-pressed={selectedId === item.id} onClick={() => selectItem(item.id)} className={`min-h-24! justify-start! gap-3! rounded-none! px-3! py-4! text-left font-normal! whitespace-normal! ${selectedId === item.id ? "bg-[var(--hb-surface-hover)]" : ""}`}><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm font-semibold">{item.name}</strong><Status value={item.status} /></span><span className="mt-1 block break-words text-xs leading-5 text-[var(--hb-text-muted)]">{item.subtitle}</span><span className="mt-1 block text-xs text-[var(--hb-text-muted)]">{formatDate(item.createdAt)}</span></span><ChevronRight size={16} className="shrink-0" aria-hidden="true" /></Button></li>)}</ul>}
                  </section>
                  <section aria-label="선택 항목 상세" className="min-w-0 rounded-xl border border-[var(--hb-hairline)] bg-white p-5 sm:p-6">
                    {!application && !offering && !inquiry ? <p className="py-10 text-sm text-[var(--hb-text-muted)]">목록에서 항목을 선택해 제출 내용과 처리 이력을 확인하세요.</p> : (
                      <>
                        <h2 className="break-words text-xl font-semibold">{application?.name ?? offering?.name ?? inquiry?.subject}</h2>
                        <p className="mb-5 mt-2 text-xs text-[var(--hb-text-muted)]">최근 변경 {formatDate(application?.updated_at ?? offering?.updated_at ?? inquiry?.updated_at ?? "")}</p>
                        {inquiry && <InquiryDetails inquiry={inquiry} />}
                        {application && <ApplicationDetails application={application} profile={profile} />}
                        {offering && <OfferingDetails offering={offering} profile={profile} />}
                        {(application || offering) && <>
                          <label htmlFor="provider-review-reason" className="mt-6 block text-sm font-semibold">검토 사유 <span className="font-normal text-[var(--hb-text-muted)]">(필수)</span></label>
                          <textarea id="provider-review-reason" value={reason} onChange={(event) => { setReason(event.target.value); setConfirmation(null); }} disabled={disabled} maxLength={1000} rows={3} className={inputClass} aria-describedby="provider-review-reason-help" />
                          <p id="provider-review-reason-help" className="mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">직접 확인한 근거와 처리 이유를 3자 이상 남겨 주세요. 신청자에게 안내될 수 있으므로 내부 메모나 제3자의 개인정보는 넣지 마세요.</p>
                        </>}
                        {application && <>
                          <p className="mt-5 text-sm leading-6 text-[var(--hb-text-body)]">등록 승인은 소개·사진 관리 권한만 부여합니다. 공개 시작은 제공자가 선택하고, 서비스·가격과 추천 자격은 별도로 심사합니다.</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {reviewButton(application.id, { kind: "application", action: "approve", expected_version: application.version }, "등록 승인", application.status !== "pending" || profile?.approval_status === "suspended")}
                            {reviewButton(application.id, { kind: "application", action: "request_changes", expected_version: application.version }, "보완 요청", application.status !== "pending" || profile?.approval_status === "suspended")}
                            {reviewButton(application.id, { kind: "application", action: "reject", expected_version: application.version }, "등록 반려", application.status !== "pending" || profile?.approval_status === "suspended")}
                          </div>
                        </>}
                        {offering && <>
                          <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={recommendationEligible} onChange={(event) => { setRecommendationEligible(event.target.checked); setConfirmation(null); }} disabled={disabled || profile?.approval_status !== "approved"} className="mt-1 h-4 w-4 shrink-0 accent-[var(--hb-primary)]" /><span>추천 자격도 확인했습니다.<span className="block text-xs leading-5 text-[var(--hb-text-muted)]">책임 주체·가격·추가금·적용 약관·수행 조건을 확인한 경우에만 선택하세요. 선택하지 않으면 서비스 승인 후에도 추천 자격은 미검토입니다.</span></span></label>
                          {profile?.approval_status !== "approved" && <p className="mt-2 text-xs leading-5 text-danger-700">제공자의 등록 자격이 승인된 뒤 서비스 승인이 가능합니다.</p>}
                          <div className="mt-4 flex flex-wrap gap-2">
                            {reviewButton(offering.id, { kind: "offering", action: "approve", expected_version: offering.version }, "서비스 승인", profile?.approval_status !== "approved")}
                            {reviewButton(offering.id, { kind: "offering", action: "reject", expected_version: offering.version }, "서비스 반려")}
                          </div>
                          <p className="mt-3 text-xs leading-5 text-[var(--hb-text-muted)]">추천 자격 확인은 특정 날짜의 예약 가능 여부나 서비스 이행 보증이 아닙니다.</p>
                        </>}
                        {inquiry && <>
                          <label htmlFor="provider-inquiry-reply" className="mt-6 block text-sm font-semibold">신청자에게 남길 답변</label>
                          <textarea id="provider-inquiry-reply" value={reply} onChange={(event) => { setReply(event.target.value); setConfirmation(null); }} disabled={disabled || inquiry.status === "closed"} maxLength={5000} rows={5} className={inputClass} aria-describedby="provider-inquiry-reply-help" />
                          <p id="provider-inquiry-reply-help" className="mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">답변은 신청자 센터에 표시됩니다. 이메일 발송 완료로 처리하지 않습니다.</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {reviewButton(inquiry.id, { kind: "inquiry", action: "reviewing", expected_version: inquiry.version }, "검토 시작", inquiry.status !== "received")}
                            {reviewButton(inquiry.id, { kind: "inquiry", action: "responded", expected_version: inquiry.version }, "답변 등록", inquiry.status === "closed")}
                            {reviewButton(inquiry.id, { kind: "inquiry", action: "closed", expected_version: inquiry.version }, "문의 종료", inquiry.status === "closed")}
                          </div>
                        </>}
                        {profile && (profile.approval_status === "approved" || profile.approval_status === "suspended") && <div className="mt-6 border-t border-[var(--hb-hairline)] pt-5"><h3 className="text-sm font-semibold">제공자 활동 관리</h3><p className="mb-3 mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">정지는 이 제공자의 공개·추천·새 문의를 차단합니다. 복구해도 자동 게시되지 않습니다.</p>{profile.approval_status === "suspended" ? reviewButton(profile.id, { kind: "profile", action: "restore", expected_version: profile.version }, "제공자 복구") : reviewButton(profile.id, { kind: "profile", action: "suspend", expected_version: profile.version }, "제공자 이용 정지")}</div>}
                        {confirmation && <section aria-label="처리 최종 확인" className="mt-6 border-t-2 border-[var(--hb-primary)] pt-5"><h3 className="font-semibold">{confirmation.label} 확인</h3><p className="mt-2 text-sm leading-6 text-[var(--hb-text-body)]">선택한 항목에 이 처리를 기록합니다. 대상과 검토 내용을 확인해 주세요.</p><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{confirmation.command.reason ?? confirmation.command.reply ?? "문의 상태를 변경합니다."}</p>{confirmation.command.kind === "offering" && confirmation.command.action === "approve" && <p className="mt-2 text-sm">추천 자격: {confirmation.command.recommendation_status === "eligible" ? "확인" : "미검토 유지"}</p>}<div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => setConfirmation(null)}>취소</Button><Button variant="primary" disabled={disabled} loading={busy} onClick={() => void submitReview()}>{busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />기록 중</> : `${confirmation.label} 확정`}</Button></div></section>}
                      </>
                    )}
                  </section>
                </div>
              )}
            </section>
          </>
        )}
        {authorization === "loading" && (
          <p role="status" className="flex items-center gap-2 py-12 text-sm text-[var(--hb-text-body)]">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />관리자 권한을 확인하고 있습니다.
          </p>
        )}
        {authorization === "denied" && (
          <section className="py-12">
            <h2 className="text-lg font-semibold">{showConsentRecovery ? "계정 동의와 관리자 권한을 확인해 주세요." : "관리자 로그인이 필요합니다."}</h2>
            <p className="mt-2 text-sm text-[var(--hb-text-body)]">{showConsentRecovery ? "새 탭에서 계정 동의를 확인한 뒤 이 관리자 페이지로 돌아와 권한·목록을 다시 확인해 주세요." : "관리자 권한이 있는 계정으로 로그인해 주세요."}</p>
            {showConsentRecovery && <div className="mt-5 flex flex-wrap gap-3">
              <Button href="/provider" target="_blank" rel="noopener noreferrer">계정 동의 확인<span className="sr-only"> (새 탭)</span></Button>
              <Button onClick={() => setAuthAttempt((value) => value + 1)}><RefreshCcw size={16} aria-hidden="true" />권한·목록 다시 확인</Button>
            </div>}
            <Button href="/admin/login" className="mt-5">관리자 로그인</Button>
          </section>
        )}
        {authorization === "error" && (
          <section role="alert" className="py-12">
            <h2 className="text-lg font-semibold">관리자 권한을 확인하지 못했습니다.</h2>
            <p className="mt-2 text-sm text-[var(--hb-text-body)]">연결을 확인한 뒤 다시 시도해 주세요.</p>
            <Button onClick={() => setAuthAttempt((value) => value + 1)} className="mt-5">
              <RefreshCcw size={16} aria-hidden="true" />다시 시도
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}

function InquiryDetails({ inquiry }: { inquiry: BusinessInquiry }) {
  return <dl className="grid gap-5 sm:grid-cols-2"><Field label="문의 유형">{inquiryKindLabels[inquiry.kind]}</Field><Field label="처리 상태"><Status value={inquiry.status} /></Field><Field label="담당자">{inquiry.contact_name}</Field><Field label="확인된 연락처">{inquiry.contact_email}</Field><div className="sm:col-span-2"><Field label="문의 내용">{inquiry.message}</Field></div>{inquiry.reply && <div className="sm:col-span-2"><Field label="센터에 등록한 답변">{inquiry.reply}</Field></div>}</dl>;
}

function ApplicationDetails({ application, profile }: { application: ProviderApplication; profile: ProviderProfile | undefined }) {
  return <><ProfileSummary profile={profile} /><dl className="mt-5 grid gap-5 sm:grid-cols-2"><Field label="신청 상태"><Status value={application.status} /></Field><Field label="신청 분야">{application.categories.map(categoryLabel).join(", ")}</Field><Field label="담당자">{application.contact_name}</Field><Field label="확인된 연락처">{application.contact_email}</Field><div className="sm:col-span-2"><Field label="신청 내용">{application.application_note}</Field></div>{application.review_reason && <div className="sm:col-span-2"><Field label="최근 검토 사유">{application.review_reason}</Field></div>}</dl></>;
}

function OfferingDetails({ offering, profile }: { offering: ProviderOffering; profile: ProviderProfile | undefined }) {
  return <><ProfileSummary profile={profile} /><dl className="mt-5 grid gap-5 sm:grid-cols-2"><Field label="서비스 검토"><Status value={offering.review_status} /></Field><Field label="추천 자격"><Status value={offering.recommendation_status} /></Field><Field label="제공자 공개 가격">{offering.base_price_krw.toLocaleString("ko-KR")}원 / {offering.price_unit}</Field><Field label="서비스 분야">{categoryLabel(offering.category)}</Field><div className="sm:col-span-2"><Field label="서비스 설명">{offering.description}</Field></div><div className="sm:col-span-2"><Field label="포함 항목">{offering.includes.join("\n")}</Field></div><div className="sm:col-span-2"><Field label="추가금">{offering.extra_charges}</Field></div><div className="sm:col-span-2"><Field label="이용·취소 조건">{offering.conditions}</Field></div>{offering.review_reason && <div className="sm:col-span-2"><Field label="최근 검토 사유">{offering.review_reason}</Field></div>}</dl></>;
}
