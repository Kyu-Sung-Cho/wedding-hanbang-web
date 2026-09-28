"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { PROVIDER_CATEGORIES, PROVIDER_CATEGORY_LABELS, PROVIDER_KIND_LABELS, providerMediaUrl, type PublicProvider } from "@/lib/providers/contracts";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";

type Props = { providers: PublicProvider[] };

export default function ProviderDiscovery({ providers }: Props) {
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const regions = useMemo(() => [...new Set(providers.flatMap((provider) => provider.regions))].sort((left, right) => left.localeCompare(right, "ko")), [providers]);
  const filtered = providers.filter((provider) => (!category || provider.offerings.some((offering) => offering.category === category)) && (!region || provider.regions.includes(region)));

  return <>
    <div className="grid gap-4 border-b border-[var(--hb-hairline)] pb-6 sm:grid-cols-2">
      <div><label htmlFor="discovery-category" className={providerLabel}>필요한 서비스·공간</label><select id="discovery-category" value={category} onChange={(event) => setCategory(event.target.value)} className={providerInput}><option value="">전체</option>{PROVIDER_CATEGORIES.map((value) => <option key={value} value={value}>{PROVIDER_CATEGORY_LABELS[value]}</option>)}</select></div>
      <div><label htmlFor="discovery-region" className={providerLabel}>활동 지역</label><select id="discovery-region" value={region} onChange={(event) => setRegion(event.target.value)} className={providerInput}><option value="">전체 지역</option>{regions.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    </div>
    <p role="status" className="my-5 text-sm text-[var(--hb-text-muted)]">공개 프로필 {filtered.length}개 · 현재 불러온 최대 30개 안에서 검색합니다.</p>
    {filtered.length ? <div className="divide-y divide-[var(--hb-hairline)]">{filtered.map((provider) => {
      const services = provider.offerings.filter((offering) => !category || offering.category === category);
      const photo = provider.media[0];
      return <article key={provider.id} className="grid gap-5 py-6 sm:grid-cols-[144px_1fr_auto]">
        {photo ? <Image src={providerMediaUrl(provider.id, photo.id)} alt={photo.alt_text} width={288} height={216} unoptimized className="aspect-[4/3] w-full rounded-md border border-[var(--hb-hairline)] object-cover sm:max-w-36" /> : <div aria-hidden="true" className="flex aspect-[4/3] items-center justify-center rounded-md border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] text-sm text-[var(--hb-text-muted)] sm:max-w-36">작업 사진 준비 중</div>}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-[var(--hb-text-strong)]"><Link href={`/providers/${provider.id}`} className={providerFocus}>{provider.name}</Link></h2><span className="rounded border border-[var(--hb-hairline)] px-2 py-1 text-xs">{PROVIDER_KIND_LABELS[provider.kind]}</span></div><p className="mt-2 text-xs text-[var(--hb-text-muted)]">{provider.regions.join(" · ") || "활동 지역 확인 필요"}</p><p className="mt-3 line-clamp-2 break-words text-sm leading-7">{provider.introduction || "활동 소개를 준비하고 있어요."}</p>{services.length ? <p className="mt-3 text-sm">{services[0].name} · {services[0].base_price_krw.toLocaleString("ko-KR")}원 / {services[0].price_unit}{services.length > 1 ? ` 외 ${services.length - 1}개 서비스` : ""}</p> : <p className="mt-3 text-sm text-[var(--hb-text-muted)]">아직 공개된 서비스·가격이 없어요.</p>}<p className="mt-2 text-xs text-[var(--hb-text-muted)]">제공자 공개 정보 · 일정과 최종 비용은 별도 확인</p></div>
        <div className="self-center"><Button href={`/providers/${provider.id}`}>상세 보기</Button></div>
      </article>;
    })}</div> : <section className="rounded-lg border border-dashed border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-8"><h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">{providers.length ? "선택한 조건의 공개 서비스가 아직 없어요" : "공개할 서비스·공간을 준비하고 있어요"}</h2><p className="mt-3 text-sm leading-7">{providers.length ? "지역이나 분야를 자동으로 넓히지 않았어요. 다른 조건을 직접 선택할 수 있습니다." : "등록과 공개 기준을 확인한 프로필부터 소개합니다. 개인·팀·업체와 공간 운영자 모두 참여할 수 있어요."}</p><div className="mt-5 flex flex-wrap gap-3">{providers.length ? <Button onClick={() => { setCategory(""); setRegion(""); }}>조건 초기화</Button> : null}<Button href="/business">참여 안내 보기</Button></div></section>}
  </>;
}
