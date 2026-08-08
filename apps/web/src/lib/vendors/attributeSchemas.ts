import { z } from "zod";

export const PRICE_BANDS = [
  "budget",
  "mid",
  "premium",
  "luxury",
  "unknown",
] as const;

export const STUDIO_SHOOT_LOCATIONS = [
  "indoor",
  "outdoor",
  "hanok",
  "garden",
  "rooftop",
  "beach",
  "cafe",
  "night",
  "underwater",
] as const;

export const ORIGINAL_FILES_POLICIES = [
  "included",
  "paid",
  "not_provided",
  "unknown",
] as const;

export const DRESS_ORIGINS = ["imported", "domestic", "inhouse"] as const;
export const DRESS_LINES = [
  "aline",
  "mermaid",
  "bell",
  "princess",
  "slim",
  "mini",
] as const;
export const DIRECTOR_DESIGNATION_OPTIONS = [
  "available",
  "fee_required",
  "not_available",
  "unknown",
] as const;
export const HALL_TYPES = [
  "hotel",
  "convention",
  "house",
  "chapel",
  "outdoor",
  "public",
  "small",
  "unknown",
] as const;
export const HALL_BRIGHTNESS_OPTIONS = ["bright", "dark", "unknown"] as const;
export const HALL_MEAL_TYPES = ["buffet", "course", "semi"] as const;
export const HALL_PARKING_OPTIONS = [
  "ample",
  "limited",
  "valet",
  "unknown",
] as const;

const uniqueValues = <T>(values: T[]) => new Set(values).size === values.length;

export type VendorAttributeFieldInput =
  | "multi_select"
  | "select"
  | "nullable_boolean"
  | "nullable_number"
  | "text";

export interface VendorAttributeFieldDefinition {
  key: string;
  label: string;
  input: VendorAttributeFieldInput;
  options?: readonly string[];
  unit?: "krw" | "people" | "minutes";
  internal: boolean;
  countsTowardCompleteness: boolean;
}

type VendorAttributeFieldMetadata = Omit<VendorAttributeFieldDefinition, "key">;
type VendorAttributeFieldRegistry = Readonly<Record<string, z.ZodType>>;

const VENDOR_ATTRIBUTE_FIELD_META_KEY = "vendorAttributeField";

function defineAttributeField<Schema extends z.ZodType>(
  schema: Schema,
  metadata: VendorAttributeFieldMetadata,
): Schema {
  return schema.meta({
    [VENDOR_ATTRIBUTE_FIELD_META_KEY]: metadata,
  }) as Schema;
}

function definitionsFromRegistry(
  registry: VendorAttributeFieldRegistry,
): readonly VendorAttributeFieldDefinition[] {
  return Object.entries(registry).map(([key, schema]) => {
    const metadata = schema.meta()?.[VENDOR_ATTRIBUTE_FIELD_META_KEY] as
      | VendorAttributeFieldMetadata
      | undefined;
    if (!metadata) {
      throw new Error(`Vendor attribute field metadata is missing: ${key}`);
    }
    return { key, ...metadata };
  });
}

const COMMON_ATTRIBUTE_FIELD_REGISTRY = {
  price_band: defineAttributeField(z.enum(PRICE_BANDS).optional(), {
    label: "가격대",
    input: "select",
    options: PRICE_BANDS,
    internal: true,
    countsTowardCompleteness: true,
  }),
  notes_internal: defineAttributeField(z.string().trim().max(2_000).optional(), {
    label: "내부 메모",
    input: "text",
    internal: true,
    countsTowardCompleteness: false,
  }),
} as const satisfies VendorAttributeFieldRegistry;

const CATEGORY_ATTRIBUTE_FIELD_REGISTRIES = {
  studio: {
    shoot_locations: defineAttributeField(
      z.array(z.enum(STUDIO_SHOOT_LOCATIONS))
        .refine(uniqueValues, "shoot_locations must not contain duplicates")
        .optional(),
      {
        label: "촬영 장소",
        input: "multi_select",
        options: STUDIO_SHOOT_LOCATIONS,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    original_files_policy: defineAttributeField(
      z.enum(ORIGINAL_FILES_POLICIES).optional(),
      {
        label: "촬영한 전체 사진 파일 받기",
        input: "select",
        options: ORIGINAL_FILES_POLICIES,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    parents_shot: defineAttributeField(z.boolean().nullable().optional(), {
      label: "부모님 사진 촬영 가능",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
    pet_friendly: defineAttributeField(z.boolean().nullable().optional(), {
      label: "반려동물 동반 가능",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
  },
  dress: {
    origin: defineAttributeField(
      z.array(z.enum(DRESS_ORIGINS))
        .refine(uniqueValues, "origin must not contain duplicates")
        .optional(),
      {
        label: "제작·수입 구분",
        input: "multi_select",
        options: DRESS_ORIGINS,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    lines: defineAttributeField(
      z.array(z.enum(DRESS_LINES))
        .refine(uniqueValues, "lines must not contain duplicates")
        .optional(),
      {
        label: "드레스 라인",
        input: "multi_select",
        options: DRESS_LINES,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    size_inclusive: defineAttributeField(z.boolean().nullable().optional(), {
      label: "다양한 사이즈 대응",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
    fitting_fee_krw: defineAttributeField(
      z.number().int().nonnegative().nullable().optional(),
      {
        label: "드레스 입어보기 비용",
        input: "nullable_number",
        unit: "krw",
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
  },
  makeup: {
    director_designation: defineAttributeField(
      z.enum(DIRECTOR_DESIGNATION_OPTIONS).optional(),
      {
        label: "담당자 지정",
        input: "select",
        options: DIRECTOR_DESIGNATION_OPTIONS,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    early_morning: defineAttributeField(z.boolean().nullable().optional(), {
      label: "새벽 시술 가능",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
    parents_makeup: defineAttributeField(z.boolean().nullable().optional(), {
      label: "부모님 헤어·메이크업 가능",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
    mens_grooming: defineAttributeField(z.boolean().nullable().optional(), {
      label: "남성 헤어·메이크업 가능",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
  },
  hall: {
    hall_type: defineAttributeField(z.enum(HALL_TYPES).optional(), {
      label: "결혼식장 유형",
      input: "select",
      options: HALL_TYPES,
      internal: false,
      countsTowardCompleteness: true,
    }),
    brightness: defineAttributeField(
      z.enum(HALL_BRIGHTNESS_OPTIONS).optional(),
      {
        label: "홀 밝기",
        input: "select",
        options: HALL_BRIGHTNESS_OPTIONS,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    single_hall: defineAttributeField(z.boolean().nullable().optional(), {
      label: "단독홀",
      input: "nullable_boolean",
      internal: false,
      countsTowardCompleteness: true,
    }),
    meal_type: defineAttributeField(
      z.array(z.enum(HALL_MEAL_TYPES))
        .refine(uniqueValues, "meal_type must not contain duplicates")
        .optional(),
      {
        label: "식사 유형",
        input: "multi_select",
        options: HALL_MEAL_TYPES,
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    guarantee_min: defineAttributeField(
      z.number().int().nonnegative().nullable().optional(),
      {
        label: "최소 보증 인원",
        input: "nullable_number",
        unit: "people",
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    interval_minutes: defineAttributeField(
      z.number().int().positive().nullable().optional(),
      {
        label: "예식 간격",
        input: "nullable_number",
        unit: "minutes",
        internal: false,
        countsTowardCompleteness: true,
      },
    ),
    parking: defineAttributeField(z.enum(HALL_PARKING_OPTIONS).optional(), {
      label: "주차 여건",
      input: "select",
      options: HALL_PARKING_OPTIONS,
      internal: false,
      countsTowardCompleteness: true,
    }),
  },
} as const satisfies Record<string, VendorAttributeFieldRegistry>;

export const VENDOR_ATTRIBUTE_SCHEMAS = {
  studio: z.strictObject({
    ...COMMON_ATTRIBUTE_FIELD_REGISTRY,
    ...CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.studio,
  }),
  dress: z.strictObject({
    ...COMMON_ATTRIBUTE_FIELD_REGISTRY,
    ...CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.dress,
  }),
  makeup: z.strictObject({
    ...COMMON_ATTRIBUTE_FIELD_REGISTRY,
    ...CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.makeup,
  }),
  hall: z.strictObject({
    ...COMMON_ATTRIBUTE_FIELD_REGISTRY,
    ...CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.hall,
  }),
} as const;

export type VendorAttributeCategory = keyof typeof VENDOR_ATTRIBUTE_SCHEMAS;
export type VendorAttributesFor<C extends VendorAttributeCategory> = z.output<
  (typeof VENDOR_ATTRIBUTE_SCHEMAS)[C]
>;

export const VENDOR_ATTRIBUTE_CATEGORY_LABELS = {
  studio: "웨딩 사진 촬영",
  dress: "드레스",
  makeup: "헤어·메이크업",
  hall: "결혼식장",
} as const satisfies Record<VendorAttributeCategory, string>;

const COMMON_ATTRIBUTE_FIELD_DEFINITIONS = definitionsFromRegistry(
  COMMON_ATTRIBUTE_FIELD_REGISTRY,
);

export const CATEGORY_ATTRIBUTE_FIELD_DEFINITIONS = {
  studio: definitionsFromRegistry(CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.studio),
  dress: definitionsFromRegistry(CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.dress),
  makeup: definitionsFromRegistry(CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.makeup),
  hall: definitionsFromRegistry(CATEGORY_ATTRIBUTE_FIELD_REGISTRIES.hall),
} as const satisfies Record<
  VendorAttributeCategory,
  readonly VendorAttributeFieldDefinition[]
>;

export function getAttributeSchema<C extends VendorAttributeCategory>(
  category: C
): (typeof VENDOR_ATTRIBUTE_SCHEMAS)[C] {
  return VENDOR_ATTRIBUTE_SCHEMAS[category];
}

export function getAttributeFieldDefinitions(
  category: VendorAttributeCategory
): readonly VendorAttributeFieldDefinition[] {
  return [
    ...CATEGORY_ATTRIBUTE_FIELD_DEFINITIONS[category],
    ...COMMON_ATTRIBUTE_FIELD_DEFINITIONS,
  ];
}

export function getAttributeFieldKeys(
  category: VendorAttributeCategory
): string[] {
  return getAttributeFieldDefinitions(category)
    .filter(({ countsTowardCompleteness, internal }) =>
      countsTowardCompleteness && !internal
    )
    .map(({ key }) => key);
}

export function getAttributeCategoryLabel(
  category: VendorAttributeCategory
): string {
  return VENDOR_ATTRIBUTE_CATEGORY_LABELS[category];
}

export function getAttributeFieldLabel(
  category: VendorAttributeCategory,
  key: string
): string | null {
  return (
    getAttributeFieldDefinitions(category).find(
      (definition) => definition.key === key
    )?.label ?? null
  );
}

export function validateVendorAttributes<C extends VendorAttributeCategory>(
  category: C,
  input: unknown
): z.ZodSafeParseResult<VendorAttributesFor<C>> {
  // TypeScript cannot preserve the key/value correlation when indexing a map
  // of differently shaped Zod objects. The generic public return type does;
  // this cast only restores that already-runtime-checked correlation.
  const schema = getAttributeSchema(category) as unknown as z.ZodType<
    VendorAttributesFor<C>
  >;
  return schema.safeParse(input);
}

export function vendorAttributeCategoryFromDb(
  value: string,
): VendorAttributeCategory | null {
  if (value === "venue") return "hall";
  return value === "studio" || value === "dress" || value === "makeup" || value === "hall"
    ? value
    : null;
}

/**
 * Public JSON is rebuilt from a category allow-list. A blacklist would leak a
 * future internal key written by a service job or left by legacy data.
 */
export function sanitizePublicVendorAttributes(
  category: VendorAttributeCategory,
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowed = Object.fromEntries(
    getAttributeFieldDefinitions(category)
      .filter(({ internal }) => !internal)
      .flatMap(({ key }) => Object.hasOwn(input, key) ? [[key, input[key]]] : []),
  );
  const parsed = validateVendorAttributes(category, allowed);
  return parsed.success ? parsed.data as Record<string, unknown> : {};
}
