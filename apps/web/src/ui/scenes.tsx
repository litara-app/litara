import type { CSSProperties } from "react";
import library from "../assets/backgrounds/library.webp";
import marble from "../assets/backgrounds/marble.webp";
import shelves from "../assets/backgrounds/shelves.webp";

export type SceneName = "marble" | "library" | "shelves";
export type SceneChoice = SceneName | "random";

export const SCENES: { value: SceneName; label: string; image: string }[] = [
  { value: "marble", label: "Marbled paper", image: marble },
  { value: "library", label: "Library at night", image: library },
  { value: "shelves", label: "Bookshelves", image: shelves },
];

/** A full-bleed backdrop picture. The image URL goes in as a custom property so the bundler can hash it. */
export function Scene({ name }: { name: SceneName }) {
  const s = SCENES.find((x) => x.value === name)!;
  return <div className="lt-scene" aria-hidden="true" style={{ "--scene": `url("${s.image}")` } as CSSProperties} />;
}

/** `/login?scene=marble|library|shelves` pins a backdrop for experimenting; otherwise the saved choice, else random. */
export function pickScene(choice: SceneChoice): SceneName {
  const pinned = new URLSearchParams(location.search).get("scene");
  const hit = SCENES.find((s) => s.value === pinned);
  if (hit) return hit.value;
  if (choice !== "random") return choice;
  return SCENES[Math.floor(Math.random() * SCENES.length)].value;
}

export type CleanBg = "gradient" | "shelves" | "marble" | "dots";
export const CLEAN_BGS: { value: CleanBg; label: string; description: string }[] = [
  { value: "gradient", label: "Soft glow", description: "A faint tint of the brand color fading from the top, nothing else." },
  { value: "dots", label: "Dot grid", description: "A quiet grid of tiny dots, like dot-ruled paper." },
  { value: "shelves", label: "Faint bookshelves", description: "Your bookshelf picture washed almost out, enough to hint at books." },
  { value: "marble", label: "Faint marbling", description: "The marbled paper washed almost out, like the inside of an old cover." },
];

/** The wash images for the Clean theme's sign-in backgrounds, passed as a custom property so the bundler hashes them. */
export function cleanBgStyle(bg: CleanBg): CSSProperties {
  const image = bg === "shelves" ? shelves : bg === "marble" ? marble : "";
  return image ? ({ "--clean-img": `url("${image}")` } as CSSProperties) : {};
}

/** `/login?bg=gradient|dots|shelves|marble` pins a Clean background for experimenting. */
export function pickCleanBg(saved: CleanBg): CleanBg {
  const pinned = new URLSearchParams(location.search).get("bg");
  return CLEAN_BGS.find((b) => b.value === pinned)?.value ?? saved;
}
