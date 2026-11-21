import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Card, Heading, Stack } from "../ui";
import { Clasp } from "../ui/Clasp";
import { LogoMark } from "../ui/icons";
import { cleanBgStyle, Scene, SCENES, type CleanBg, type SceneName } from "../ui/scenes";
import type { ThemeName } from "../ui/ThemeProvider";

export type Phase = "idle" | "turning" | "denied" | "unlocking" | "opening";
const endpaper = { "--endpaper": `url("${SCENES[0].image}")` } as CSSProperties;

/** The sign-in screen for either theme. The real page and the settings preview both render this. */
export function SignInView({ theme, scene, cleanBg, phase, fields, onSubmit, root = "main" }: {
  theme: ThemeName; scene: SceneName; cleanBg: CleanBg; phase: Phase; fields: ReactNode; onSubmit: (e: FormEvent) => void; root?: "main" | "div";
}) {
  const Root = root;
  if (theme === "clean") {
    return (
      <Root className="lt-auth lt-clean-bg" data-clean-bg={cleanBg} style={cleanBgStyle(cleanBg)}>
        <div className="lt-clean-login">
          <div className="lt-clean-mark">
            <LogoMark />
            <div className="lt-clean-name" aria-hidden="true">Litara</div>
            <div className="lt-clean-tag">Your library, kept</div>
          </div>
          <Card>
            <form onSubmit={onSubmit}>
              <Stack>
                <Heading level={1}>Sign in to Litara</Heading>
                {fields}
              </Stack>
            </form>
          </Card>
        </div>
      </Root>
    );
  }
  return (
    <Root className="lt-auth" data-scene={scene}>
      <Scene name={scene} />
      <div className="lt-book-stage">
        <div className="lt-book" data-phase={phase}>
          <div className="lt-book-inside" aria-hidden="true" />
          <div className="lt-book-cover">
            <div className="lt-cover-front">
              <div className="lt-book-frame">
                <div className="lt-book-mark">
                  <LogoMark />
                  <div className="lt-wordmark" aria-hidden="true">Litara</div>
                  <div className="lt-tagline">Your library, kept</div>
                </div>
                <form className="lt-bookplate" onSubmit={onSubmit}>
                  <Stack>
                    <Heading level={1}>Sign in to Litara</Heading>
                    {fields}
                  </Stack>
                </form>
                <div className="lt-book-note">Private library · your books stay on your server</div>
              </div>
              <Clasp />
            </div>
            <div className="lt-cover-back" style={endpaper} aria-hidden="true" />
          </div>
        </div>
      </div>
      <span className="lt-sr" role="status">{phase === "unlocking" ? "Signed in" : ""}</span>
    </Root>
  );
}
