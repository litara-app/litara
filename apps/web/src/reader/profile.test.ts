import { describe, expect, test } from "vitest";
import go from "../../../server/internal/catalog/editions.go?raw";
import prov from "../../public/reader/vendor/PROVENANCE.md?raw";
import { BUNDLED_PROFILE, profileMismatch } from "./profile";

describe("engine profiles", () => {
  test("a different server profile is a mismatch; the bundled one and unknown engines are not", () => {
    expect(profileMismatch("foliate", BUNDLED_PROFILE.foliate)).toBe(false);
    expect(profileMismatch("foliate", "foliate-js@other/profile-1")).toBe(true);
    expect(profileMismatch("pdfjs", "pdfjs-dist@1.0.0/profile-1")).toBe(true);
    expect(profileMismatch("image-pages", "anything")).toBe(false); // comics have no engine locator profile here
  });

  test("the bundled profile strings match the server constants and the vendored pins", () => {
    expect(go).toContain(`"${BUNDLED_PROFILE.foliate}"`);
    expect(go).toContain(`"${BUNDLED_PROFILE.pdfjs}"`);
    expect(prov).toContain(BUNDLED_PROFILE.foliate.split("@")[1].split("/")[0]); // commit pin
    expect(prov).toContain(BUNDLED_PROFILE.pdfjs.split("@")[1].split("/")[0]); // version pin
  });
});
