import { describe, expect, it } from "vitest";
import {
  getAttributeCategoryLabel,
  getAttributeFieldDefinitions,
  getAttributeFieldLabel,
  getAttributeFieldKeys,
  getAttributeSchema,
  validateVendorAttributes,
  sanitizePublicVendorAttributes,
  vendorAttributeCategoryFromDb,
} from "../attributeSchemas";

describe("vendor attribute schemas", () => {
  it("derives every admin form field from metadata carried by the matching Zod validator", () => {
    for (const category of ["studio", "dress", "makeup", "hall"] as const) {
      const definitions = getAttributeFieldDefinitions(category);
      const shape = getAttributeSchema(category).shape as Record<
        string,
        { meta: () => unknown }
      >;

      expect(new Set(Object.keys(shape))).toEqual(
        new Set(definitions.map(({ key }) => key))
      );

      for (const definition of definitions) {
        const { key, ...formMetadata } = definition;
        expect(shape[key]?.meta()).toEqual({
          vendorAttributeField: formMetadata,
        });
      }
    }
  });

  it("accepts a valid studio enrichment payload", () => {
    const result = validateVendorAttributes("studio", {
      shoot_locations: ["indoor", "hanok"],
      original_files_policy: "included",
      parents_shot: true,
      pet_friendly: null,
      price_band: "mid",
      notes_internal: "원본 제공 범위 재확인",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shoot_locations).toEqual(["indoor", "hanok"]);
      expect(result.data.price_band).toBe("mid");
    }
  });

  it("accepts dress attributes and rejects a negative fitting fee", () => {
    expect(
      validateVendorAttributes("dress", {
        origin: ["imported", "inhouse"],
        lines: ["aline", "mermaid"],
        size_inclusive: null,
        fitting_fee_krw: 50_000,
      }).success
    ).toBe(true);

    expect(
      validateVendorAttributes("dress", { fitting_fee_krw: -1 }).success
    ).toBe(false);
  });

  it("validates makeup designation and nullable service facts", () => {
    expect(
      validateVendorAttributes("makeup", {
        director_designation: "fee_required",
        early_morning: true,
        parents_makeup: null,
        mens_grooming: false,
      }).success
    ).toBe(true);

    expect(
      validateVendorAttributes("makeup", {
        director_designation: "sometimes",
      }).success
    ).toBe(false);
  });

  it("validates hall facilities without inventing unavailable facts", () => {
    expect(
      validateVendorAttributes("hall", {
        hall_type: "chapel",
        brightness: "dark",
        single_hall: null,
        meal_type: ["buffet", "course"],
        guarantee_min: 150,
        interval_minutes: 90,
        parking: "limited",
      }).success
    ).toBe(true);

    expect(
      validateVendorAttributes("hall", {
        meal_type: ["buffet", "buffet"],
      }).success
    ).toBe(false);
  });

  it("exposes the same strict field contract to forms and completeness scoring", () => {
    const definitions = getAttributeFieldDefinitions("studio");

    expect(definitions.map(({ key }) => key)).toEqual([
      "shoot_locations",
      "original_files_policy",
      "parents_shot",
      "pet_friendly",
      "price_band",
      "notes_internal",
    ]);
    expect(getAttributeFieldKeys("studio")).toEqual([
      "shoot_locations",
      "original_files_policy",
      "parents_shot",
      "pet_friendly",
    ]);
    expect(definitions.find(({ key }) => key === "notes_internal")).toMatchObject({
      input: "text",
      internal: true,
      countsTowardCompleteness: false,
    });
    expect(getAttributeCategoryLabel("studio")).toBe("스튜디오");
    expect(getAttributeFieldLabel("studio", "original_files_policy")).toBe(
      "원본 제공"
    );
    expect(getAttributeFieldLabel("studio", "not_a_field")).toBeNull();
    expect(
      getAttributeFieldDefinitions("dress").find(
        ({ key }) => key === "fitting_fee_krw"
      )
    ).toMatchObject({ unit: "krw" });
    expect(
      getAttributeFieldDefinitions("hall").find(
        ({ key }) => key === "guarantee_min"
      )
    ).toMatchObject({ unit: "people" });
    expect(
      getAttributeFieldDefinitions("hall").find(
        ({ key }) => key === "interval_minutes"
      )
    ).toMatchObject({ unit: "minutes" });

    expect(
      validateVendorAttributes("studio", { copied_marketing_copy: "금지" })
        .success
    ).toBe(false);
  });

  it("rebuilds public attributes from category allow-lists and drops future secrets", () => {
    expect(vendorAttributeCategoryFromDb("venue")).toBe("hall");
    expect(vendorAttributeCategoryFromDb("florist")).toBeNull();
    expect(sanitizePublicVendorAttributes("studio", {
      shoot_locations: ["indoor"],
      parents_shot: true,
      price_band: "premium",
      notes_internal: "private",
      secret_future_key: "must never leave the server",
    })).toEqual({
      shoot_locations: ["indoor"],
      parents_shot: true,
    });
    expect(sanitizePublicVendorAttributes("studio", {
      parents_shot: "not-a-boolean",
      secret_future_key: "private",
    })).toEqual({});
  });
});
