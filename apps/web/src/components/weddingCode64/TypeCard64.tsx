// 네 글자가 함께 보이는 모습: 유형 제목·부제·한 줄·글자끼리 만나는 곳·먼저/미루기 쉬운 것.
import type { Wc64TypeCard } from "@/lib/weddingCode/wc64/types";
import { bodyClass, cardClass, h2Class, h3Class, kickerClass, listClass } from "./reportStyles";

export default function TypeCard64({ type }: { type: Wc64TypeCard }) {
  return (
    <section className={cardClass} aria-labelledby="wc64-type">
      <p className={kickerClass}>네 글자가 함께 보이는 모습</p>
      <div>
        <h2 id="wc64-type" className={h2Class}>{type.title}</h2>
        <p className={`mt-1 ${bodyClass}`}>{type.sub}</p>
      </div>
      <p className={bodyClass}>{type.one_liner}</p>
      <h3 className={h3Class}>글자끼리 만나는 곳</h3>
      <ul className={listClass}>{type.meets.map(x => <li key={x}>{x}</li>)}</ul>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5"><h3 className={h3Class}>먼저 챙기기 쉬운 것</h3><p className={bodyClass}>{type.first}</p></div>
        <div className="flex min-w-0 flex-col gap-1.5"><h3 className={h3Class}>미루기 쉬운 것</h3><p className={bodyClass}>{type.later}</p></div>
      </div>
    </section>
  );
}
