"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { PROVIDER_KIND_LABELS, type ProviderOffering } from "@/lib/providers/contracts";
import ProviderApplicationForm from "./ProviderApplicationForm";
import ProviderMediaManager from "./ProviderMediaManager";
import ProviderOfferingEditor from "./ProviderOfferingEditor";
import ProviderProfileEditor from "./ProviderProfileEditor";
import { providerDate } from "./providerClient";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";
import useProviderWorkspace from "./useProviderWorkspace";

const applicationStatus = { pending: "심사 대기", changes_requested: "보완 요청", approved: "승인", rejected: "반려" };
const profileApproval = { pending: "승인 대기", approved: "관리 권한 승인", rejected: "반려", suspended: "이용 정지" };
const publicationStatus = { draft: "아직 비공개", published: "공개 중", paused: "공개 중단" };
const reviewStatus = { pending: "검토 대기", approved: "서비스 승인", rejected: "서비스 반려" };
const recommendationStatus = { unreviewed: "추천 자격 미확인", eligible: "추천 후보 가능", needs_review: "추천 재검토 필요", blocked: "추천 제외" };
const inquiryStatus = { received: "접수", reviewing: "확인 중", responded: "답변 도착", closed: "종결" };

export default function ProviderCenter() {
  const { workspace, loading, error, reload } = useProviderWorkspace();
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [editingApplication, setEditingApplication] = useState<string | null>(null);
  const [editingOffering, setEditingOffering] = useState<ProviderOffering | "new" | null>(null);
  const profile = workspace?.profiles.find((item) => item.id === selected) ?? workspace?.profiles[0];

  async function changed(message: string) { await reload(); setNotice(message); }

  if (loading) return <p role="status" className="py-8 text-sm text-[var(--hb-text-muted)]">제공자 정보를 불러오고 있어요…</p>;
  if (error || !workspace) return <div role="alert" className="space-y-4 rounded-lg border border-[var(--hb-hairline)] p-5"><p className="text-sm leading-7">{error || "제공자 정보를 확인하지 못했어요."}</p><div className="flex flex-wrap gap-3"><Button variant="primary" onClick={() => void reload().catch(() => {})}>다시 불러오기</Button><Button href="/login?redirect=%2Fprovider">다시 로그인</Button></div></div>;

  const offerings = workspace.offerings.filter((item) => item.provider_id === profile?.id);
  const media = workspace.media.filter((item) => item.provider_id === profile?.id);
  const canEdit = profile?.approval_status === "approved";

  return <div className="space-y-9">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-[var(--hb-text-muted)]">최신 상태를 불러오면 저장하지 않은 편집 내용은 초기화됩니다.</p><Button size="sm" onClick={() => { setEditingOffering(null); setEditingApplication(null); void changed("최신 상태를 불러왔어요.").catch(() => {}); }}>최신 상태 불러오기</Button></div>
    {notice ? <p role="status" className="border-l-2 border-[var(--hb-success)] bg-[var(--hb-surface-hover)] px-4 py-3 text-sm leading-7">{notice}</p> : null}
    <section aria-labelledby="provider-applications-heading"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="provider-applications-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">참여 신청</h2><Button href="/business/register" size="sm">새 참여 신청</Button></div>
      {workspace.applications.length ? <div className="mt-4 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">{workspace.applications.map((application) => <article key={application.id} className="py-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold text-[var(--hb-text-strong)]">{application.name} <span className="text-xs font-normal">· {PROVIDER_KIND_LABELS[application.kind]}</span></h3><span className="text-sm font-semibold">{applicationStatus[application.status]}</span></div><p className="mt-2 text-xs text-[var(--hb-text-muted)]">접수일 {providerDate(application.created_at)} · 담당 이메일 {application.contact_email}</p>{application.review_reason ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--hb-surface-hover)] p-3 text-sm leading-7">운영팀 안내: {application.review_reason}</p> : null}{application.status === "changes_requested" || application.status === "rejected" ? <div className="mt-4">{editingApplication === application.id ? <ProviderApplicationForm key={`${application.id}:${application.version}`} application={application} onSubmitted={async () => { await changed("보완 내용을 제출했어요."); setEditingApplication(null); }} /> : <Button onClick={() => setEditingApplication(application.id)}>보완해서 다시 제출</Button>}</div> : null}</article>)}</div> : <p className="mt-4 text-sm leading-7 text-[var(--hb-text-muted)]">아직 참여 신청이 없어요. 서비스·공간 참여 신청부터 시작할 수 있습니다.</p>}
    </section>

    {profile ? <section aria-labelledby="provider-management-heading" className="space-y-7">
      <div className="border-t border-[var(--hb-hairline)] pt-7"><h2 id="provider-management-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">프로필 관리</h2>{workspace.profiles.length > 1 ? <div className="mt-4 max-w-md"><label htmlFor="provider-workspace-select" className={providerLabel}>관리할 프로필</label><select id="provider-workspace-select" className={providerInput} value={profile.id} onChange={(event) => { setSelected(event.target.value); setEditingOffering(null); setNotice(""); }}>{workspace.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div> : <p className="mt-2 text-sm">{profile.name} · {PROVIDER_KIND_LABELS[profile.kind]}</p>}</div>
      <dl className="grid divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="py-4 sm:pr-5"><dt className="text-xs text-[var(--hb-text-muted)]">관리 권한</dt><dd className="mt-2 font-semibold text-[var(--hb-text-strong)]">{profileApproval[profile.approval_status]}</dd></div><div className="py-4 sm:px-5"><dt className="text-xs text-[var(--hb-text-muted)]">프로필</dt><dd className="mt-2 font-semibold text-[var(--hb-text-strong)]">{publicationStatus[profile.publication_status]}</dd></div><div className="py-4 sm:pl-5"><dt className="text-xs text-[var(--hb-text-muted)]">서비스·추천 자격</dt><dd className="mt-2 text-sm">{offerings.length ? "아래 서비스별 상태를 확인해 주세요" : "아직 등록한 서비스가 없어요"}</dd></div></dl>
      {canEdit ? <>
        {profile.publication_status === "published" ? <Link href={`/providers/${profile.id}`} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center text-sm underline underline-offset-4 ${providerFocus}`}>공개 프로필 확인하기 ↗</Link> : null}
        <div className="grid gap-9 lg:grid-cols-[1.2fr_1fr]"><ProviderProfileEditor key={`${profile.id}:${profile.version}`} profile={profile} onChanged={changed} /><div><ProviderMediaManager key={profile.id} providerId={profile.id} media={media} published={profile.publication_status === "published"} onChanged={changed} /></div></div>
        <section aria-labelledby="provider-offerings-heading" className="border-t border-[var(--hb-hairline)] pt-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="provider-offerings-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">서비스·가격</h2><Button onClick={() => setEditingOffering("new")} disabled={editingOffering !== null}>새 서비스 등록</Button></div><p className="mt-2 text-sm leading-7">소개글과 사진의 공개 권한과 별개로 심사합니다. 서비스 승인과 추천 자격도 다르며, 일정·최종 금액은 고객 문의에서 확인해야 합니다.</p>{offerings.length ? <div className="mt-4 divide-y divide-[var(--hb-hairline)]">{offerings.map((offering) => <article key={offering.id} className="py-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold text-[var(--hb-text-strong)]">{offering.name}</h3><p className="text-sm tabular-nums">{offering.base_price_krw.toLocaleString("ko-KR")}원 · {offering.price_unit}</p></div><p className="mt-2 text-xs font-semibold">{reviewStatus[offering.review_status]} · {recommendationStatus[offering.recommendation_status]}</p>{offering.review_reason ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7">운영팀 안내: {offering.review_reason}</p> : null}<Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditingOffering(offering)} disabled={editingOffering !== null}>서비스 수정·재검토</Button></article>)}</div> : <p className="mt-4 text-sm text-[var(--hb-text-muted)]">공개할 서비스와 가격을 등록해 주세요.</p>}{editingOffering !== null ? <ProviderOfferingEditor key={editingOffering === "new" ? `${profile.id}:new` : `${editingOffering.id}:${editingOffering.version}`} providerId={profile.id} offering={editingOffering === "new" ? undefined : editingOffering} onChanged={changed} onCancel={() => setEditingOffering(null)} /> : null}</section>
      </> : <p className="border-l-2 border-[var(--hb-action)] bg-[var(--hb-surface-hover)] px-4 py-4 text-sm leading-7">{profile.approval_status === "suspended" ? "현재 관리 권한이 정지되어 소개글·사진·서비스를 수정하거나 게시할 수 없습니다. 운영팀 안내를 확인해 주세요." : "한방이 등록과 관리 권한을 승인한 뒤 소개글·사진을 편집하고 공개할 수 있어요. 위 참여 신청 상태와 보완 요청을 확인해 주세요."}</p>}
      <p className="text-xs leading-6 text-[var(--hb-text-muted)]">현재 한 명의 책임자 계정으로 프로필을 관리합니다. 팀원 초대나 공동 관리는 아직 제공하지 않습니다. 계정 비밀번호를 팀원과 공유하지 마세요.</p>
    </section> : null}

    <section aria-labelledby="provider-inquiries-heading" className="border-t border-[var(--hb-hairline)] pt-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="provider-inquiries-heading" className="text-lg font-semibold text-[var(--hb-text-strong)]">내 비즈니스 문의</h2><Button href="/business/inquiry" size="sm">새 문의</Button></div>{workspace.business_inquiries.length ? <div className="mt-4 divide-y divide-[var(--hb-hairline)]">{workspace.business_inquiries.map((inquiry) => <article key={inquiry.id} className="py-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold text-[var(--hb-text-strong)]">{inquiry.subject}</h3><span className="text-xs font-semibold">{inquiryStatus[inquiry.status]}</span></div><p className="mt-2 text-xs text-[var(--hb-text-muted)]">{providerDate(inquiry.created_at)}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{inquiry.message}</p>{inquiry.reply ? <div className="mt-4 border-l-2 border-[var(--hb-action)] bg-[var(--hb-surface-hover)] p-4"><p className="text-xs font-semibold">운영팀 답변</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{inquiry.reply}</p></div> : <p className="mt-3 text-xs text-[var(--hb-text-muted)]">등록된 답변이 아직 없어요. 이곳에서 처리 상태를 확인할 수 있습니다.</p>}</article>)}</div> : <p className="mt-4 text-sm text-[var(--hb-text-muted)]">아직 접수한 비즈니스 문의가 없어요.</p>}</section>
  </div>;
}
