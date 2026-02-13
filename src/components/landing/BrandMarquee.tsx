"use client";

const brands = [
  "Wedding Magazine",
  "Brides Korea",
  "W Wedding",
  "The Knot",
  "Style Magazine",
  "Wedding21",
  "My Wedding",
  "Bridal Fair",
];

export default function BrandMarquee() {
  return (
    <section className="border-y border-gray-100 bg-white py-10">
      <p className="mb-8 text-center text-sm text-gray-400">
        수천 명의 예비 신부가 선택했습니다
      </p>

      <div className="relative overflow-hidden">
        {/* 좌우 페이드 */}
        <div className="pointer-events-none absolute top-0 left-0 z-10 h-full w-24 bg-gradient-to-r from-white to-transparent" />
        <div className="pointer-events-none absolute top-0 right-0 z-10 h-full w-24 bg-gradient-to-l from-white to-transparent" />

        <div className="flex animate-[marquee_30s_linear_infinite]">
          {[...brands, ...brands].map((brand, i) => (
            <div
              key={`${brand}-${i}`}
              className="mx-8 flex shrink-0 items-center text-lg font-semibold tracking-tight text-gray-300"
            >
              {brand}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
