export function classifyUsageRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object"
    ? row.metadata
    : {};
  const providerModel =
    typeof row?.model === "string" && /^(?:gpt-|claude-)/.test(row.model);
  const providerAttempted = metadata.provider_attempted === false
    ? false
    : metadata.provider_attempted === true || providerModel;
  const usageUnknown = providerAttempted && (
    metadata.usage_status === "unknown" ||
    metadata.unknown_paid_attempt === true ||
    row.tokens_input == null ||
    row.tokens_output == null
  );

  return {
    providerModel,
    providerAttempted,
    usageUnknown,
    unknownPriceEligible: providerModel && providerAttempted && !usageUnknown,
  };
}
