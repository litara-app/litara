// Engine profiles of the readers bundled in this build (ADR-0027, ADR-0071). Locators are interpreted only
// by the profile that produced them; when the server expects a different one (a stale cached web build
// after a server upgrade, or the reverse) the reader refuses to restore, paint or create locator-based
// state rather than guess. Keep in step with apps/server/internal/catalog/editions.go and
// public/reader/vendor/PROVENANCE.md (a unit test checks both).
export const BUNDLED_PROFILE: Record<string, string> = {
  foliate: "foliate-js@78914aef/profile-1",
  pdfjs: "pdfjs-dist@6.5.438/profile-1",
};

export function profileMismatch(engine: string, profile: string): boolean {
  const want = BUNDLED_PROFILE[engine];
  return want !== undefined && want !== profile;
}
