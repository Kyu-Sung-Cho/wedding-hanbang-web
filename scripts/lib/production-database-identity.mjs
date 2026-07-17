export const PRODUCTION_DATABASE_SYSTEM_IDENTIFIERS = Object.freeze({
  slrtobkksjmxgzatjyqb: "7581440907192989109",
});

export const TEST_DATABASE_SYSTEM_IDENTIFIER = "7000000000000000001";

export function productionDatabaseSystemIdentifier(projectRef, { allowTest = false } = {}) {
  const value = PRODUCTION_DATABASE_SYSTEM_IDENTIFIERS[projectRef]
    ?? (allowTest ? TEST_DATABASE_SYSTEM_IDENTIFIER : null);
  return /^\d{10,32}$/.test(value ?? "") ? value : null;
}
