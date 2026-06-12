// 서버 렌더 SEO 콘텐츠 — 검색엔진 크롤러가 예절 가이드 전문을 읽을 수 있게 보장.
// 인터랙티브 위키(EtiquetteClient)는 hydration 후 선택된 파트만 펼치므로,
// 25개 파트 전문을 native <details>(JS 불필요)로 정적 렌더한다.
// 기본 접힘이라 페이지는 가볍고, HTML에는 전문이 들어가 색인된다.
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";

// 마크다운 기호 제거 → 검색엔진용 평문 (줄 구조는 유지)
function toPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}

export default function EtiquetteSeoContent() {
  return (
    <section
      aria-label="결혼 예절 가이드 전체"
      className="mx-auto mt-4 w-full max-w-[900px] rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5"
    >
      <h2 className="font-serif-kr text-[20px] font-medium text-[#071629]">
        결혼 예절 가이드 전체 목차 ({ETIQUETTE_PARTS.length}개 파트)
      </h2>
      <p className="mt-2 text-[13px] leading-[1.7] text-[#5d6879]">
        첫인사·상견례·예물예단·청첩장·본식·폐백·신혼여행 후 인사까지, 결혼 준비 단계별 예절을 정리한
        무료 가이드입니다. 각 항목을 펼치면 체크리스트와 상황별 멘트를 볼 수 있어요.
      </p>

      <div className="mt-4 space-y-2">
        {ETIQUETTE_PARTS.map((part) => (
          <details key={part.number} className="rounded-[12px] border border-[#f0efed] bg-[#fffdf7]/60 px-4 py-3">
            <summary className="cursor-pointer text-[14px] font-semibold text-[#071629]">
              Part {part.number}. {part.title}
              <span className="ml-2 font-normal text-[#7a8290]">— {part.subtitle}</span>
            </summary>
            <p className="mt-2 text-[13px] font-medium text-[#5d6879]">{part.description}</p>
            <div className="mt-2 whitespace-pre-line text-[13px] leading-[1.7] text-[#5d6879]">
              {toPlainText(part.content)}
            </div>
          </details>
        ))}
      </div>

      <p className="mt-4 text-[12px] text-[#7a8290]">
        결혼 준비가 처음이라 막막한 분들을 위한 예절 가이드입니다. 가문·지역에 따라 관습은 다를 수 있어요.
      </p>
    </section>
  );
}
