// Repository-owned production identity. Runtime environment variables may add
// checks, but they may never redefine this denylist.
export const REPOSITORY_PRODUCTION_PROJECT_REFS = Object.freeze([
  "slrtobkksjmxgzatjyqb",
] as const);

export function assertRepositoryProductionProjectRef(projectRef: string): void {
  if (!(REPOSITORY_PRODUCTION_PROJECT_REFS as readonly string[]).includes(projectRef)) {
    throw new Error(
      "SUPABASE_PRODUCTION_PROJECT_REF does not match the repository-pinned production project ref.",
    );
  }
}

export function assertDisclosureStagingProjectRef(projectRef: string): void {
  if ((REPOSITORY_PRODUCTION_PROJECT_REFS as readonly string[]).includes(projectRef)) {
    throw new Error("production project ref is forbidden for disclosure ingest staging writes");
  }
}
