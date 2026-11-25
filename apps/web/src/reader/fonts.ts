import lit400normal from "@fontsource/literata/files/literata-latin-400-normal.woff2?url";
import lit400italic from "@fontsource/literata/files/literata-latin-400-italic.woff2?url";
import lit700normal from "@fontsource/literata/files/literata-latin-700-normal.woff2?url";
import lit700italic from "@fontsource/literata/files/literata-latin-700-italic.woff2?url";
import atk400normal from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url";
import atk400italic from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url";
import atk700normal from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url";
import atk700italic from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-italic.woff2?url";
import dys400normal from "@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url";
import dys400italic from "@fontsource/opendyslexic/files/opendyslexic-latin-400-italic.woff2?url";
import dys700normal from "@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url";
import dys700italic from "@fontsource/opendyslexic/files/opendyslexic-latin-700-italic.woff2?url";

/** Reading fonts that ship with the app (ADR-0091). Each is an SIL OFL 1.1 family, Latin subset. */
export type BundledFont = "literata" | "atkinson" | "dyslexic";
export interface FontFace { weight: 400 | 700; style: "normal" | "italic"; url: string }
export interface LoadedFace { weight: number; style: string; buffer: ArrayBuffer }

const FILES: Record<BundledFont, FontFace[]> = {
  literata: [{ weight: 400, style: "normal", url: lit400normal }, { weight: 400, style: "italic", url: lit400italic }, { weight: 700, style: "normal", url: lit700normal }, { weight: 700, style: "italic", url: lit700italic }],
  atkinson: [{ weight: 400, style: "normal", url: atk400normal }, { weight: 400, style: "italic", url: atk400italic }, { weight: 700, style: "normal", url: atk700normal }, { weight: 700, style: "italic", url: atk700italic }],
  dyslexic: [{ weight: 400, style: "normal", url: dys400normal }, { weight: 400, style: "italic", url: dys400italic }, { weight: 700, style: "normal", url: dys700normal }, { weight: 700, style: "italic", url: dys700italic }],
};

export const isBundledFont = (v: string | undefined): v is BundledFont => v === "literata" || v === "atkinson" || v === "dyslexic";

/** Downloads a family's files from the app's own origin. Nothing is fetched until a font is chosen. */
export async function loadFontFaces(id: BundledFont): Promise<LoadedFace[]> {
  return Promise.all(FILES[id].map(async (f) => {
    const res = await fetch(f.url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`font ${id} could not be loaded`);
    return { weight: f.weight, style: f.style, buffer: await res.arrayBuffer() };
  }));
}
