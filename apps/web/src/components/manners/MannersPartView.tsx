import type { MannersBlock, MannersPart } from "@/lib/manners/types";

/**
 * 결혼 예절 안내 본문 렌더러. 서버 전용이고 클라이언트 JS가 0이다.
 *
 * 삭제된 원본 화면(`EtiquetteClient.tsx` 1,307줄)은 절반이 체크박스·메모·일정 팝오버였다.
 * 그건 지금 체크리스트·일정 화면이 이미 하는 일이라 여기서 다시 만들지 않는다.
 * 이 화면은 **읽는 곳**이고, 실행은 아모라와 일정으로 넘긴다.
 */

const BLOCK_TONE = {
  tip: { label: "이렇게 하면 편해요", box: "border-[#8F5150]/25 bg-[#8F5150]/[0.05]" },
  warning: { label: "이건 조심하세요", box: "border-[#B4785F]/35 bg-[#B4785F]/[0.07]" },
} as const;

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[14px] leading-[1.75] text-[#3d4a45]">
          <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#8F5150]/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ block }: { block: MannersBlock }) {
  if (block.kind === "paragraph") {
    return <p className="text-[14px] leading-[1.85] text-[#3d4a45]">{block.text}</p>;
  }

  if (block.kind === "checklist") {
    return (
      <div>
        {block.title ? <h4 className="text-[14px] font-semibold text-[#243832]">{block.title}</h4> : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div className={`rounded-xl border px-4 py-3 ${tone.box}`}>
        <p className="text-[12px] font-semibold tracking-wide text-[#8F5150]">
          {block.title ?? tone.label}
        </p>
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    // 이 제품의 값은 "예의를 지키세요"가 아니라 실제로 할 수 있는 문장이다.
    return (
      <div className="rounded-xl border border-[#243832]/12 bg-white/70 px-4 py-3">
        <p className="text-[12px] font-semibold tracking-wide text-[#243832]/70">
          {block.title ?? "이렇게 말할 수 있어요"}
        </p>
        <div className="mt-2.5 space-y-3">
          {block.lines.map((line) => (
            <div key={line.say}>
              <p className="text-[14px] leading-[1.7] text-[#243832]">
                <span aria-hidden className="mr-1.5 text-[#8F5150]">“</span>
                {line.say}
                <span aria-hidden className="ml-1 text-[#8F5150]">”</span>
              </p>
              {line.note ? (
                <p className="mt-1 text-[12.5px] leading-[1.6] text-[#3d4a45]/75">{line.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 표는 사용자가 캡처해서 옮긴다. 그래서 "관행"이라는 말이 표 안에 같이 붙어 있어야 한다.
  return (
    <figure className="rounded-xl border border-[#243832]/12 bg-white/70">
      <figcaption className="border-b border-[#243832]/10 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold text-[#243832]">{block.title}</p>
          {/* 시점을 제목 옆에 붙인다 — 표만 캡처해 옮겨도 기준 시점이 함께 간다. */}
          <span className="rounded-full bg-[#243832]/[0.06] px-2 py-0.5 text-[11.5px] font-medium text-[#3d4a45]">
            {block.asOf}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#3d4a45]/80">{block.caption}</p>
        {/* 이 숫자가 말하지 않는 것. 출처가 완벽해도 이게 없으면 오해가 남는다. */}
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#8F5150]">
          <span className="font-semibold">이 숫자가 말하지 않는 것 · </span>
          {block.limits}
        </p>
        {block.unsourced ? (
          <p className="mt-1.5 text-[12px] font-medium text-[#B4785F]">
            공개된 1차 자료를 아직 찾지 못했어요. 주변에서 흔히 말하는 범위로만 참고해 주세요.
          </p>
        ) : null}
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#243832]/10">
              {block.columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-2.5 text-[12.5px] font-semibold text-[#243832]/75">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")} className="border-b border-[#243832]/6 last:border-0">
                {row.map((cell, index) => (
                  <td
                    key={`${row.join("|")}-${index}`}
                    className={`px-4 py-2.5 text-[13.5px] leading-[1.6] ${
                      index === 0 ? "font-medium text-[#243832]" : "text-[#3d4a45]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export default function MannersPartView({ part }: { part: MannersPart }) {
  return (
    <article className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="text-[12.5px] font-semibold tracking-wide text-[#8F5150]">{part.subtitle}</p>
        <h1 className="mt-1.5 font-serif-kr text-[26px] font-normal leading-snug text-[#1b1c1c] sm:text-[32px]">
          {part.title}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.8] text-[#3d4a45]">{part.description}</p>
        {/* 삭제 사유였던 "가족·지역마다 답이 다르다"에 대한 답이다. 접거나 흐리지 않는다. */}
        <p className="mt-4 rounded-xl border border-[#243832]/12 bg-[#243832]/[0.035] px-4 py-3 text-[13px] leading-[1.7] text-[#3d4a45]">
          {part.caveat}
        </p>
      </header>

      <div className="mt-8 space-y-9">
        {part.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-[17px] font-semibold leading-snug text-[#243832]">{section.heading}</h2>
            <div className="mt-3 space-y-4">
              {section.blocks.map((block, index) => (
                <Block key={`${section.heading}-${index}`} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-[#243832]/12 pt-5">
        <h2 className="text-[13px] font-semibold text-[#243832]">어디서 확인한 내용인가요</h2>
        {part.sources.length === 0 ? (
          <p className="mt-2 text-[13px] leading-[1.7] text-[#3d4a45]">
            이 페이지에는 공개된 1차 자료로 확인한 수치가 아직 없어요. 금액이나 법적 절차는
            해당 기관 안내를 직접 확인해 주세요.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {part.sources.map((source) => (
              <li key={source.url} className="text-[13px] leading-[1.7] text-[#3d4a45]">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-[#8F5150] underline underline-offset-2"
                >
                  {source.label}
                </a>
                <span className="text-[#3d4a45]/75">
                  {" · "}
                  {source.scope}
                  {" · "}
                  {source.checkedAt} 확인
                </span>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </article>
  );
}
