import { priceDisclosureLines } from "@/lib/price/period";

export function PriceDisclosureFooter({ periodLabel }: { periodLabel: string }) {
  const [source, disclaimer] = priceDisclosureLines(periodLabel);
  return (
    <footer className="border-t border-[#1D3557]/15 bg-[#F5ECE4]/55 px-4 py-5 text-[12px] leading-5 text-[#1D3557]/75 sm:px-6">
      <p className="font-semibold text-[#1D3557]">{source}</p>
      <p className="mt-1">{disclaimer}</p>
    </footer>
  );
}
