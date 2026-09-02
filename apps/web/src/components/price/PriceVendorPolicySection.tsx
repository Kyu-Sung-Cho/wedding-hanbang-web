import type { PublicVendorPolicy } from "@/lib/vendors/publicVendorPriceData";

const POLICY_SECTION_LABELS: Record<string, string> = {
  penalty: "위약금",
  refund: "환불",
  refund_policy: "환불",
  change: "일정 변경",
};

export function policySectionLabel(semanticType: string): string {
  return POLICY_SECTION_LABELS[semanticType] ?? "기타 계약 조건";
}

/**
 * 계약 직전에 보는 위약금·환불 원문.
 *
 * 이 섹션은 **원문이 없어도 렌더한다.** 예전에는 `policies.length > 0`일 때만
 * 렌더해서, 원문이 없는 업체의 화면에는 이 섹션이 통째로 사라졌다. 그러면
 * 사용자는 "이 업체는 위약금 공시가 없다"와 "화면이 고장났다"를 구분할 수 없다.
 * 예식장 189곳이 전부 그 상태였고(2026-09-02 라이브 실측), 원문이 없는
 * 스튜디오도 같은 상태였다. 공시를 보여주는 제품에서 조용한 빈자리는
 * 없는 것보다 나쁘다.
 *
 * 빈 상태 문구는 목록 카드가 이미 쓰는 집안 형식을 그대로 따른다
 * (PriceVendorCard: "추가금 공시 항목 없음" + "추가금이 없다는 뜻은 아니에요").
 * 없음의 주어는 **공시 항목**이고, 그 다음 줄이 업체의 실제 계약과 혼동되지
 * 않게 못박는다 — 예식장 위약금은 소비자분쟁해결기준상 통상 존재하므로
 * "위약금 없음"으로 읽히면 계약 판단을 그르치는 거짓 진술이 된다.
 */
export function PriceVendorPolicySection({
  policies,
  categoryLabel,
}: {
  policies: PublicVendorPolicy[];
  categoryLabel: string;
}) {
  // 문구가 같은 공시는 로더가 이미 합친다 — 남은 공시의 대행사 수가 곧
  // "서로 다른 문구"의 수다.
  const agencyCount = new Set(
    policies.flatMap((policy) => (policy.sourceAgency ? [policy.sourceAgency] : [])),
  ).size;

  return (
    <section
      aria-labelledby="policy-heading"
      data-policy-state={policies.length > 0 ? "present" : "empty"}
      className="border-t border-[var(--hb-primary)]/15 py-8 sm:py-10"
    >
      <h2 id="policy-heading" className="text-2xl font-bold">계약 전 확인 · 위약금과 환불</h2>
      {policies.length > 0 ? (
        <>
          <p className="mt-2 text-sm leading-6 text-[var(--hb-text-strong)]/85">
            업체가 공시한 원문 그대로예요. 웨딩한방이 요약하거나 해석하지 않았고,
            계약 시점·조건에 따라 달라질 수 있으니 계약서에 같은 내용이 적혀 있는지 꼭 확인하세요.
          </p>
          {/* 실측(2026-07-26)에서 같은 샵인데 대행사에 따라 60일 전 위약금이
              20%와 100%로 갈리는 경우까지 있었다. 왜 여러 장인지 모르면 그냥
              스크롤로 지나친다. */}
          {agencyCount >= 2 ? (
            <p className="mt-3 rounded-[6px] bg-[#FDE5E2] px-4 py-3 text-sm font-semibold leading-6 text-[#8F5150]">
              이 업체는 대행사 {agencyCount}곳이 서로 다른 문구로 공시했어요.
              계약할 대행사의 조건을 직접 비교해 보세요.
            </p>
          ) : null}
          <ul className="mt-5 space-y-3">
            {policies.map((policy) => (
              <li key={policy.id} className="rounded-[6px] border border-[#8F6662]/25 bg-[var(--hb-surface-page)] px-5 py-4">
                <p className="text-xs font-bold text-[#8F5150]">
                  {policySectionLabel(policy.semanticType)}
                  {/* 예식장은 자기 문서로 공시하므로 중간 대행사가 없다. 그 자리에
                      대행사 이름을 지어 넣지 않고, 문서 공통 규정임을 그대로 말한다. */}
                  {policy.scope === "hall_document" ? (
                    <span className="ml-2 font-semibold text-[var(--hb-text-strong)]/60">
                      공시 문서 공통 규정
                    </span>
                  ) : policy.sourceAgency ? (
                    <span className="ml-2 font-semibold text-[var(--hb-text-strong)]/60">
                      {policy.sourceAgency} 공시
                    </span>
                  ) : null}
                </p>
                {policy.title ? (
                  <p className="mt-1 text-sm font-bold text-[var(--hb-text-strong)]">{policy.title}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--hb-text-strong)]/85">
                  {policy.contentVerbatim}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-5 rounded-[6px] border border-dashed border-[#8F6662]/35 bg-[var(--hb-surface-page)] px-5 py-4">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-sm font-bold text-[var(--hb-text-strong)]">
              이 경로 위약금·환불 공시 항목 없음
            </span>
            <span className="text-[11px] font-medium text-[var(--color-rose-700)]">
              위약금이 없다는 뜻은 아니에요
            </span>
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--hb-text-strong)]/85">
            이 {categoryLabel}의 공시 문서에서 위약금·환불 규정을 확인하지 못했어요.
            계약 전에 업체에 직접 묻고 계약서 조항에서 확인하세요.
          </p>
        </div>
      )}
    </section>
  );
}
