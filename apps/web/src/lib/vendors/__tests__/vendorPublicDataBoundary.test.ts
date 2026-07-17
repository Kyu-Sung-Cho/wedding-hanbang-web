import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_VENDOR_COLUMNS,
  PUBLIC_VENDOR_REVIEW_COLUMNS,
} from "../publicFields";

const webRoot = process.cwd();

function source(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("public vendor data boundary", () => {
  it("never selects every vendor or review column in public web routes", () => {
    const listRoute = source("src/app/api/vendors/route.ts");
    const detailRoute = source("src/app/api/vendors/[id]/route.ts");

    expect(listRoute).not.toContain('.from("vendors")\n      .select("*")');
    expect(detailRoute).not.toContain('.from("vendors")\n      .select("*")');
    expect(detailRoute).not.toContain('.from("vendor_reviews")\n      .select("*")');
  });

  it("keeps private vendor and reviewer identity columns outside allow-lists", () => {
    const vendorColumns = PUBLIC_VENDOR_COLUMNS.split(",");
    const reviewColumns = PUBLIC_VENDOR_REVIEW_COLUMNS.split(",");

    expect(vendorColumns).not.toEqual(expect.arrayContaining([
      "owner_id",
      "owner_name",
      "email",
      "business_number",
      "business_license_url",
      "commission_rate",
      "bank_name",
      "account_number",
      "account_holder",
      "notification_settings",
    ]));
    expect(reviewColumns).not.toEqual(expect.arrayContaining([
      "customer_id",
      "booking_id",
    ]));
  });

  it("does not request private vendor verification documents on mobile", () => {
    const mobileDetail = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/[id].tsx"),
      "utf8",
    );

    expect(mobileDetail).not.toContain("business_license_url");
    expect(mobileDetail).not.toContain('.select("*")');
  });

  it("does not present profile completeness or heuristics as trust verification", () => {
    const webList = source("src/app/(app)/vendors/page.tsx");
    const mobileList = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/index.tsx"),
      "utf8",
    );
    const mobileDetail = readFileSync(
      resolve(webRoot, "../mobile/app/vendors/[id].tsx"),
      "utf8",
    );
    const published = [webList, mobileList, mobileDetail].join("\n");

    for (const misleadingLabel of [
      "AI 맞춤 추천",
      "딱 맞는 업체 3곳",
      "믿을 수 있는 업체만 엄선",
      "신뢰 높음",
      "검증됨",
      "추천순은 검증",
      "검증된 업체를 불러오고 있어요",
    ]) {
      expect(published).not.toContain(misleadingLabel);
    }

    expect(mobileList).toContain("업체 품질이나 계약 안전을 보장하지 않아요");
    expect(mobileDetail).toContain("가격 적정성을 보장하지 않습니다");
  });
});
