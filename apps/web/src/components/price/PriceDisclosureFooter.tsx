import { priceDisclosureLines } from "@/lib/price/period";

// 스냅샷 이름을 prop으로 받지 않는다 — 받으면 내부 이름이 기준일로 새어 나간다.
export function PriceDisclosureFooter() {
  const [source, disclaimer] = priceDisclosureLines();
  return (
    <footer className="border-t border-[var(--hb-primary)]/15 bg-[#F5ECE4]/55 px-4 py-5 text-[12px] leading-5 text-[var(--hb-text-strong)]/75 sm:px-6">
      <p className="font-semibold text-[var(--hb-text-strong)]">{source}</p>
      <p className="mt-1">{disclaimer}</p>
    </footer>
  );
}
