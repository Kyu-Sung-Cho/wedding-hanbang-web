export type QuoteAnalysisCategory = "sdm_package" | "studio" | "dress" | "makeup";

export type QuoteAnalysisMessagePresentation =
  | { kind: "plain"; text: string }
  | { kind: "valid_v2"; text: string }
  | { kind: "fallback"; text: string };

export declare const QUOTE_ANALYSIS_REOPEN_FALLBACK: string;

export declare function getQuoteAnalysisExpectedItemIds(
  category: QuoteAnalysisCategory | string,
): string[];

export declare function getQuoteAnalysisMessagePresentation(
  text: unknown,
): QuoteAnalysisMessagePresentation;
