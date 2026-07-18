import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisclosureSourcePreview } from "./DisclosureSourcePreview";

describe("DisclosureSourcePreview", () => {
  it("renders XLSX cell coordinates as inert pre-wrapped text beside the raw source link", () => {
    const html = renderToStaticMarkup(
      <DisclosureSourcePreview
        source={{
          label: "샘플 가격표.xlsx",
          signed_url: "https://storage.example/signed-xlsx",
          preview_text: "## 시트: 견적\n견적!B7: 기본 패키지 290만원\n<script>alert(1)</script>",
        }}
        title="가격 공시 원본"
      />,
    );

    expect(html).toContain("견적!B7: 기본 패키지 290만원");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("https://storage.example/signed-xlsx");
    expect(html).toContain("원본 파일 열기");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("keeps a PDF in the existing inline viewer", () => {
    const html = renderToStaticMarkup(
      <DisclosureSourcePreview
        source={{
          label: "샘플 공시.pdf",
          signed_url: "https://storage.example/signed-pdf",
          preview_text: "server preview is secondary for PDFs",
        }}
        title="가격 공시 원본"
      />,
    );

    expect(html).toContain("<iframe");
    expect(html).toContain("https://storage.example/signed-pdf");
    expect(html).not.toContain("server preview is secondary for PDFs");
  });
});
