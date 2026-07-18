import { z } from "zod";

import {
  getAttributeFieldDefinitions,
  getAttributeSchema,
  type VendorAttributeCategory,
} from "./attributeSchemas";

const categorySchema = z.enum(["studio", "dress", "makeup", "hall"]);
const regionCodeSchema = z.enum([
  "seoul_gangnam3",
  "seoul_etc",
  "jeju",
  "gangwon",
  "gyeongsang",
  "jeolla",
  "chungcheong",
  "gyeonggi",
  "ulsan",
  "gwangju",
  "daejeon",
  "busan",
  "incheon",
  "daegu",
]);
const tagSchema = z.string().trim().min(1).max(40);

const recommendationRequestSchema = z.strictObject({
  category: categorySchema,
  region_codes: z.array(regionCodeSchema).max(20).default([])
    .transform((values) => [...new Set(values)]),
  budget_max_krw: z.number().int().positive().max(100_000_000_000).optional(),
  preferred_tags: z.array(tagSchema).max(30).default([])
    .transform((values) => [...new Set(values)]),
  required_attrs: z.record(
    z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
    z.unknown(),
  ).default({}),
  wedding_month: z.string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  limit: z.number().int().min(1).max(20).default(5),
}).superRefine((request, context) => {
  const category = request.category as VendorAttributeCategory;
  const definitions = getAttributeFieldDefinitions(category);
  const allowedRequiredKeys = new Set(
    definitions.filter(({ internal }) => !internal).map(({ key }) => key),
  );

  for (const key of Object.keys(request.required_attrs)) {
    if (!allowedRequiredKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["required_attrs", key],
        message: "This attribute cannot be used as a public recommendation filter",
      });
    }
  }

  const attributesResult = getAttributeSchema(category).safeParse(request.required_attrs);
  if (!attributesResult.success) {
    for (const issue of attributesResult.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["required_attrs", ...issue.path],
        message: issue.message,
      });
    }
  }
});

export type ParsedVendorRecommendationRequest = z.infer<
  typeof recommendationRequestSchema
>;

export function parseVendorRecommendationRequest(input: unknown) {
  return recommendationRequestSchema.safeParse(input);
}
