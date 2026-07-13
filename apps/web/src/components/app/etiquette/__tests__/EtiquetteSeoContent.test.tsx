import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EtiquetteSeoContent from "@/components/app/etiquette/EtiquetteSeoContent";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";

describe("EtiquetteSeoContent", () => {
  it("renders a visible scope boundary, privacy warning, and official links", () => {
    const html = renderToStaticMarkup(<EtiquetteSeoContent />);

    expect(html).toContain("관습과 제도는 구분해서 확인해 주세요");
    expect(html).toContain("관습은 선택");
    expect(html).toContain("주민등록번호·신분증 사진");
    expect(html).toContain("gov.kr");
    expect(html).toContain("scourt.go.kr");
    expect(html).toContain("nts.go.kr");
    expect(html).toContain("nhis.or.kr");
    expect(html.match(/<details/g)).toHaveLength(ETIQUETTE_PARTS.length);
  });
});
