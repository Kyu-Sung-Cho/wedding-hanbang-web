import type * as React from "react";
import { Check } from "lucide-react";

// 인라인 마크다운: **bold**
function renderInlineMd(text: string, prefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${prefix}-${i}`} className="font-semibold text-[var(--hb-text-strong)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${prefix}-${i}`}>{part}</span>;
  });
}

// markdown table row 파싱 — "| a | b | c |" → ["a", "b", "c"]
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

// separator row 여부 ("|---|---|" 또는 "|:---|---:|" 등)
function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  if (!cells) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

// AI 메시지 라이트 마크다운 렌더 (### 헤더, **bold**, - 불릿, | 테이블)
export function renderAiMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 테이블 감지 — 현재 줄이 table row이고 다음 줄이 separator 이면 표.
    const headerCells = parseTableRow(line);
    if (headerCells && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      // 데이터 row 수집
      const dataRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length) {
        const row = parseTableRow(lines[j]);
        if (!row) break;
        dataRows.push(row);
        j++;
      }
      blocks.push(
        <div key={`t-${i}`} className="my-2 overflow-x-auto rounded-[6px] border border-[#E8DDD3] bg-white/80">
          <table className="min-w-[34rem] w-full text-[0.8125rem] sm:text-sm border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2]">
                {headerCells.map((c, ci) => (
                  <th
                    key={ci}
                    className="px-2.5 py-1.5 text-left font-semibold text-[var(--hb-text-strong)] border-b border-[#E8DDD3]"
                  >
                    {renderInlineMd(c, `th-${i}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? "bg-[#FAF7F2]/40" : ""}>
                  {row.map((c, ci) => (
                    <td
                      key={ci}
                      className="px-2.5 py-1.5 text-[var(--hb-text-strong)] border-b border-[#E8DDD3]/60 align-top"
                    >
                      {renderInlineMd(c, `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j;
      continue;
    }

    // 헤더 (###, ##, #)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        <div
          key={i}
          className="font-serif-kr font-semibold text-base sm:text-lg text-[var(--hb-text-strong)] mt-3 first:mt-0 mb-1.5"
        >
          {renderInlineMd(headingMatch[2], `h-${i}`)}
        </div>
      );
      i++;
      continue;
    }
    // 불릿 (-, *)
    const checkboxMatch = trimmed.match(/^(?:[-*]\s*)?(?:\[( |x|X)\]|☐|□|✅|✓|✔)\s+(.+)$/);
    if (checkboxMatch) {
      const rawState = checkboxMatch[1];
      const checked = rawState?.toLowerCase() === "x" || /^[✅✓✔]/.test(trimmed);
      blocks.push(
        <div
          key={i}
          className="my-1.5 flex items-start gap-2 rounded-[6px] border border-[#E8DDD3]/70 bg-white/70 px-3 py-2"
        >
          <span
            className={`mt-0.5 flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-[6px] border ${
              checked
                ? "border-[#2E7D5A] bg-[#2E7D5A]"
                : "border-[#B5ADA3] bg-white"
            }`}
          >
            {checked && <Check className="h-3 w-3 text-white" />}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            {renderInlineMd(checkboxMatch[2], `cb-${i}`)}
          </span>
        </div>
      );
      i++;
      continue;
    }
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberedMatch) {
      blocks.push(
        <div key={i} className="my-1.5 flex items-start gap-2">
          <span className="mt-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#F3E7E1] px-1.5 text-[0.6875rem] font-semibold text-[var(--hb-accent-hover)]">
            {numberedMatch[1]}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            {renderInlineMd(numberedMatch[2], `n-${i}`)}
          </span>
        </div>
      );
      i++;
      continue;
    }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push(
        <div key={i} className="my-1 flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C4967E]" />
          <span className="min-w-0 flex-1 leading-relaxed">{renderInlineMd(bulletMatch[1], `b-${i}`)}</span>
        </div>
      );
      i++;
      continue;
    }
    // 인용문 (>)
    //
    // 2026-08-26 운영 실측: 8월 아모라 답변 384건 중 27건(7%)에 마크다운 원문이
    // 글자 그대로 찍혔고 그중 25건이 `>` 였다. 하필 **업체에 보낼 문장을 인용문으로
    // 주는 패턴**이라, "복사해서 보내세요" 라고 준 문장 앞에 `>` 가 붙어 나갔다.
    //
    // 프롬프트로 서식을 금지하는 방식은 쓰지 않는다 — 모델이 지키지 않으면 그대로
    // 재발하고, 실제로 넉 달간 재발했다. 렌더러가 받아 주는 쪽이 결정적이다.
    if (/^>\s?/.test(trimmed)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <div
          key={`q-${i}`}
          className="my-2 border-l-2 border-[#C4967E]/60 bg-[#FBF7F4] py-2 pl-3 pr-2 text-[var(--hb-text-body)]"
        >
          {quoted.map((q, qi) => (
            <div key={qi} className="leading-relaxed">
              {q === "" ? <span className="block h-2" /> : renderInlineMd(q, `q-${i}-${qi}`)}
            </div>
          ))}
        </div>
      );
      continue;
    }
    // 수평선 (---, ***, ___)
    if (/^([-*_])\1{2,}$/.test(trimmed.replace(/\s+/g, ""))) {
      blocks.push(<div key={i} className="my-3 border-t border-[#E8DDD3]" />);
      i++;
      continue;
    }
    // 코드펜스 (```) — 안쪽은 서식을 적용하지 않고 그대로 보여 준다.
    if (/^```/.test(trimmed)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 펜스
      blocks.push(
        <pre
          key={`c-${i}`}
          className="my-2 overflow-x-auto rounded-[6px] bg-[#F5F1EE] px-3 py-2 text-[0.8125rem] leading-relaxed text-[#3A3330]"
        >
          {code.join("\n")}
        </pre>
      );
      continue;
    }
    // 빈 줄 → 간격
    if (trimmed === "") {
      blocks.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }
    // 일반 라인
    blocks.push(
      <div key={i} className="leading-relaxed">
        {renderInlineMd(line, `p-${i}`)}
      </div>
    );
    i++;
  }
  return blocks;
}

