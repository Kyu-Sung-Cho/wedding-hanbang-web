"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import Button from "@/components/ui/Button";
import { PROVIDER_CATEGORIES, PROVIDER_CATEGORY_LABELS, PROVIDER_KIND_LABELS, providerMediaUrl, providerCatalogPageSchema } from "@/lib/providers/contracts";
import { providerFailure, providerRead } from "./providerClient";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";

type CatalogPage = z.infer<typeof providerCatalogPageSchema>;
type Criteria = { category: string; region: string; q: string };
type Props = { initialPage: CatalogPage };
const emptyCriteria: Criteria = { category: "", region: "", q: "" };

export default function ProviderDiscovery({ initialPage }: Props) {
  const [page, setPage] = useState(initialPage);
  const [criteria, setCriteria] = useState<Criteria>(emptyCriteria);
  const [active, setActive] = useState<Criteria>(emptyCriteria);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lastRequest = useRef<{ criteria: Criteria; after?: string }>({ criteria: emptyCriteria });
  useEffect(() => () => controller.current?.abort(), []);

  async function load(next: Criteria, after?: string) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const current = ++generation.current;
    lastRequest.current = { criteria: next, after };
    setLoading(true); setError(""); setActive(next);
    if (!after) setPage({ providers: [], next_cursor: null });
    const query = new URLSearchParams();
    if (next.category) query.set("category", next.category);
    if (next.region) query.set("region", next.region);
    if (next.q) query.set("q", next.q);
    if (after) query.set("after", after);
    try {
      const result = await providerRead(`/api/providers?${query}`, providerCatalogPageSchema, request.signal);
      if (request.signal.aborted || generation.current !== current) return;
      if (after && result.next_cursor === after) throw new Error("Unexpected repeated cursor");
      setPage((previous) => ({ ...result, providers: after ? [...previous.providers, ...result.providers.filter((provider) => !previous.providers.some((item) => item.id === provider.id))] : result.providers }));
    } catch (cause) {
      if (!request.signal.aborted && generation.current === current) setError(providerFailure(cause));
    } finally {
      if (!request.signal.aborted && generation.current === current) setLoading(false);
    }
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load({ category: criteria.category, region: criteria.region.trim(), q: criteria.q.trim() }); }
  const filtered = page.providers;
  const category = active.category;
  const hasConditions = Boolean(active.category || active.region || active.q);

  return <>
    <form onSubmit={search} className="grid gap-4 border-b border-[var(--hb-hairline)] pb-6 sm:grid-cols-2">
      <div><label htmlFor="discovery-category" className={providerLabel}>필요한 서비스·공간</label><select id="discovery-category" value={criteria.category} onChange={(event) => setCriteria({ ...criteria, category: event.target.value })} className={providerInput}><option value="">전체</option>{PROVIDER_CATEGORIES.map((value) => <option key={value} value={value}>{PROVIDER_CATEGORY_LABELS[value]}</option>)}</select></div>
      <div><label htmlFor="discovery-region" className={providerLabel}>활동 지역</label><input id="discovery-region" value={criteria.region} maxLength={80} onChange={(event) => setCriteria({ ...criteria, region: event.target.value })} placeholder="예: 서울, 수원" className={providerInput} /><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">입력한 문구가 등록 지역에 포함된 프로필을 찾습니다. 인근 지역으로 자동 확장하지 않습니다.</p></div>
      <div><label htmlFor="discovery-query" className={providerLabel}>활동명·소개 검색</label><input id="discovery-query" value={criteria.q} maxLength={100} onChange={(event) => setCriteria({ ...criteria, q: event.target.value })} className={providerInput} placeholder="찾는 이름이나 작업 내용을 입력하세요" /></div>
      <div className="flex flex-wrap items-end gap-3"><Button type="submit" variant="primary" loading={loading}>조건으로 찾기</Button><Button onClick={() => { setCriteria(emptyCriteria); void load(emptyCriteria); }} disabled={loading}>조건 초기화</Button></div>
    </form>
    <p role="status" className="my-5 text-sm text-[var(--hb-text-muted)]">{loading ? "공개 프로필을 찾고 있어요…" : `공개 프로필 ${filtered.length}개 불러옴${page.next_cursor ? " · 더 불러올 수 있어요" : ""}`}</p>
    {error ? <div role="alert" className="my-5 space-y-3 rounded-lg border border-[var(--hb-hairline)] p-4"><p className="text-sm leading-7">{error}</p><Button onClick={() => void load(lastRequest.current.criteria, lastRequest.current.after)} disabled={loading}>다시 불러오기</Button></div> : null}
    {filtered.length ? <div className="divide-y divide-[var(--hb-hairline)]">{filtered.map((provider) => {
      const services = provider.offerings.filter((offering) => !category || offering.category === category);
      const photo = provider.media[0];
      return <article key={provider.id} className="grid gap-5 py-6 sm:grid-cols-[144px_1fr_auto]">
        {photo ? <Image src={providerMediaUrl(provider.id, photo.id)} alt={photo.alt_text} width={288} height={216} unoptimized className="aspect-[4/3] w-full rounded-md border border-[var(--hb-hairline)] object-cover sm:max-w-36" /> : <div aria-hidden="true" className="flex aspect-[4/3] items-center justify-center rounded-md border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] text-sm text-[var(--hb-text-muted)] sm:max-w-36">작업 사진 준비 중</div>}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-[var(--hb-text-strong)]"><Link href={`/providers/${provider.id}`} className={providerFocus}>{provider.name}</Link></h2><span className="rounded border border-[var(--hb-hairline)] px-2 py-1 text-xs">{PROVIDER_KIND_LABELS[provider.kind]}</span></div><p className="mt-2 text-xs text-[var(--hb-text-muted)]">{provider.regions.join(" · ") || "활동 지역 확인 필요"}</p><p className="mt-3 line-clamp-2 break-words text-sm leading-7">{provider.introduction || "활동 소개를 준비하고 있어요."}</p>{services.length ? <p className="mt-3 text-sm">{services[0].name} · {services[0].base_price_krw.toLocaleString("ko-KR")}원 / {services[0].price_unit}{services.length > 1 ? ` 외 ${services.length - 1}개 서비스` : ""}</p> : <p className="mt-3 text-sm text-[var(--hb-text-muted)]">아직 공개된 서비스·가격이 없어요.</p>}<p className="mt-2 text-xs text-[var(--hb-text-muted)]">제공자 공개 정보 · 일정과 최종 비용은 별도 확인</p></div>
        <div className="self-center"><Button href={`/providers/${provider.id}`}>상세 보기</Button></div>
      </article>;
    })}</div> : !loading && !error ? <section className="rounded-lg border border-dashed border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-8"><h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">{hasConditions ? "선택한 조건의 공개 서비스가 아직 없어요" : "공개할 서비스·공간을 준비하고 있어요"}</h2><p className="mt-3 text-sm leading-7">{hasConditions ? "지역이나 분야를 자동으로 넓히지 않았어요. 다른 조건을 직접 선택할 수 있습니다." : "등록과 공개 기준을 확인한 프로필부터 소개합니다. 개인·팀·업체와 공간 운영자 모두 참여할 수 있어요."}</p><div className="mt-5 flex flex-wrap gap-3">{hasConditions ? <Button onClick={() => { setCriteria(emptyCriteria); void load(emptyCriteria); }}>조건 초기화</Button> : null}<Button href="/business">참여 안내 보기</Button></div></section> : null}
    {page.next_cursor ? <div className="mt-6 flex justify-center"><Button onClick={() => void load(active, page.next_cursor ?? undefined)} loading={loading}>프로필 더 보기</Button></div> : null}
  </>;
}
