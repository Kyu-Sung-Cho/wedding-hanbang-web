export function classifyUsageRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object"
    ? row.metadata
    : {};
  const providerModel =
    typeof row?.model === "string" && /^(?:gpt-|claude-)/.test(row.model);
  const ledgerPrepared = metadata.ledger_status === "prepared";
  const providerAttempted = metadata.provider_attempted === false
    ? false
    : metadata.provider_attempted === true || providerModel;
  const usageUnknown = ledgerPrepared || (
    providerAttempted && (
      metadata.usage_status === "unknown" ||
      metadata.unknown_paid_attempt === true ||
      row.tokens_input == null ||
      row.tokens_output == null
    )
  );

  return {
    providerModel,
    providerAttempted,
    ledgerPrepared,
    reconciliationRequired: ledgerPrepared || usageUnknown,
    usageUnknown,
    unknownPriceEligible: providerModel && providerAttempted && !usageUnknown,
  };
}
