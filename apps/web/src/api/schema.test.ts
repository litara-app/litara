// @vitest-environment node
import { expect, test } from "vitest";
// @ts-expect-error the generator is a plain Node script without type declarations
import { generate } from "../../scripts/generate-api-types.mjs";
import current from "./schema.gen.ts?raw";

test("schema.gen.ts matches the server's API (run `npm run gen:api` if this fails)", () => {
  expect(current.replace(/\r\n/g, "\n")).toBe(generate());
});
