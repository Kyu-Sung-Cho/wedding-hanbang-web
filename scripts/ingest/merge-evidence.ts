import { z } from "zod";

export const MERGED_EVIDENCE_PREFIX = "__HANBANG_MERGED_EVIDENCE_V1__";

const MergedEvidenceFragmentSchema = z.object({
  source_file_id: z.string().regex(/^[a-f0-9]{64}$/u),
  quote: z.string().min(1).max(2_000),
}).strict();

const MergedEvidenceEnvelopeSchema = z.object({
  fragments: z.array(MergedEvidenceFragmentSchema).min(2).max(100),
}).strict().superRefine((value, context) => {
  const identities = value.fragments.map((fragment) =>
    JSON.stringify([
      fragment.source_file_id,
      fragment.quote.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    ])
  );
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "merged evidence fragments must be unique" });
  }
});

export type MergedEvidenceFragment = z.infer<typeof MergedEvidenceFragmentSchema>;

export type DecodedEvidenceQuote =
  | { kind: "single"; quote: string }
  | { kind: "merged"; fragments: MergedEvidenceFragment[] }
  | { kind: "invalid"; reason: string };

export function decodeEvidenceQuote(value: string): DecodedEvidenceQuote {
  if (!value.startsWith(MERGED_EVIDENCE_PREFIX)) return { kind: "single", quote: value };
  try {
    const parsed = MergedEvidenceEnvelopeSchema.safeParse(
      JSON.parse(value.slice(MERGED_EVIDENCE_PREFIX.length)),
    );
    return parsed.success
      ? { kind: "merged", fragments: parsed.data.fragments }
      : { kind: "invalid", reason: parsed.error.issues[0]?.message ?? "invalid envelope" };
  } catch {
    return { kind: "invalid", reason: "invalid JSON" };
  }
}

export function encodeMergedEvidenceQuote(
  fragments: MergedEvidenceFragment[],
  maxLength: number,
): string | null {
  const unique = new Map<string, MergedEvidenceFragment>();
  for (const fragment of fragments) {
    const parsed = MergedEvidenceFragmentSchema.safeParse({
      source_file_id: fragment.source_file_id,
      quote: fragment.quote.trim(),
    });
    if (!parsed.success) return null;
    const identity = JSON.stringify([
      parsed.data.source_file_id,
      parsed.data.quote.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    ]);
    if (!unique.has(identity)) unique.set(identity, parsed.data);
  }
  const values = [...unique.values()];
  if (values.length === 1) return values[0].quote.length <= maxLength ? values[0].quote : null;
  const envelope = MergedEvidenceEnvelopeSchema.safeParse({ fragments: values });
  if (!envelope.success) return null;
  const encoded = `${MERGED_EVIDENCE_PREFIX}${JSON.stringify(envelope.data)}`;
  return encoded.length <= maxLength ? encoded : null;
}
