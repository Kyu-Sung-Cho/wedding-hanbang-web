// 서버 렌더 SEO 콘텐츠 — 검색엔진 크롤러가 예절 가이드 전문을 읽을 수 있게 보장.
// 인터랙티브 위키(EtiquetteClient)는 hydration 후 선택된 파트만 펼치므로,
// 25개 파트 전문을 native <details>(JS 불필요)로 정적 렌더한다.
// 기본 접힘이라 페이지는 가볍고, HTML에는 전문이 들어가 색인된다.
import {
  ETIQUETTE_GUIDE_NOTICE,
  ETIQUETTE_OFFICIAL_SOURCES,
  ETIQUETTE_PARTS,
} from "@/constants/etiquetteData";

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
        첫 만남·가족 모임·초대·본식·행정 확인·비용 대화까지, 결혼 준비 과정에서 서로의 선택권과
        개인정보를 지키기 위한 참고 가이드입니다.
      </p>

      <aside
        aria-label="가이드 범위와 공식 확인 안내"
        className="mt-4 rounded-[12px] border border-[#e5d7bc] bg-[#fffaf0] px-4 py-3 text-[13px] leading-[1.7] text-[#5d6879]"
      >
        <p className="font-semibold text-[#504444]">관습과 제도는 구분해서 확인해 주세요</p>
        <p className="mt-1">{ETIQUETTE_GUIDE_NOTICE}</p>
        <p className="mt-1">
          주민등록번호·신분증 사진은 웨딩한방의 메모·채팅·공개 링크에 입력하지 마세요.
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="공식 확인처">
          {ETIQUETTE_OFFICIAL_SOURCES.map((source) => (
            <li key={source.href}>
              <a
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#795252] underline decoration-[#795252]/30 underline-offset-2 hover:decoration-[#795252]"
              >
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </aside>

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
        이 내용은 법률·세무·행정 자문이 아니며, 특정 가족 형태나 성별 역할을 표준으로 두지 않습니다.
      </p>
    </section>
  );
}
