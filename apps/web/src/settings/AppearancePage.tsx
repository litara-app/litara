import { useState } from "react";
import { icons, Button, Card, Heading, ImagePicker, SegmentedField, Stack, Text } from "../ui";
import { CLEAN_BGS, cleanBgStyle, SCENES, type CleanBg, type SceneChoice } from "../ui/scenes";
import { THEMES, useTheme } from "../ui/ThemeProvider";
import { SignInPreview } from "./SignInPreview";

export function AppearancePage() {
  const { theme, setTheme, scene, setScene, cleanBg, setCleanBg } = useTheme();
  const current = THEMES.find((t) => t.value === theme)!;
  const shown = SCENES.find((s) => s.value === scene);
  const [previewing, setPreviewing] = useState(false);
  return (
    <Stack>
      <Text size="sm" tone="dim">
        Choose how Litara looks. These choices are stored in this browser only, so set them again on each device you use.
      </Text>
      <Card framed>
        <Stack gap="sm">
          <Heading level={2}>Theme</Heading>
          <SegmentedField label="Theme" value={theme} onValue={(v) => setTheme(v as typeof theme)} items={THEMES.map((t) => ({ value: t.value, label: t.label }))} />
          <Text size="sm">{current.description}</Text>
          <Text size="xs" tone="dim">Light or dark is the lamp or sun button at the right of the top bar.</Text>
        </Stack>
      </Card>
      {theme === "reading-room" && (
        <Card framed>
          <Stack gap="sm">
            <Heading level={2}>Sign-in background</Heading>
            <ImagePicker label="Sign-in background" value={scene} onValue={(v) => setScene(v as SceneChoice)}
              options={[
                { value: "random", label: "Surprise me", preview: <span className="lt-pick-mosaic">{SCENES.map((s) => <img key={s.value} src={s.image} alt="" />)}</span> },
                ...SCENES.map((s) => ({ value: s.value, label: s.label, preview: <img src={s.image} alt="" /> })),
              ]} />
            <Text size="sm">{shown ? `${shown.label} every time you sign in.` : "A different backdrop each time you sign in."}</Text>
            <div><Button onClick={() => setPreviewing(true)} icon={icons.external}>Preview sign-in</Button></div>
          </Stack>
        </Card>
      )}
      {theme === "clean" && (
        <Card framed>
          <Stack gap="sm">
            <Heading level={2}>Sign-in background</Heading>
            <ImagePicker label="Sign-in background" value={cleanBg} onValue={(v) => setCleanBg(v as CleanBg)}
              options={CLEAN_BGS.map((b) => ({
                value: b.value, label: b.label,
                preview: <span className="lt-clean-bg lt-clean-swatch" data-clean-bg={b.value} style={cleanBgStyle(b.value)} />,
              }))} />
            <Text size="sm">{CLEAN_BGS.find((b) => b.value === cleanBg)!.description}</Text>
            <div><Button onClick={() => setPreviewing(true)} icon={icons.external}>Preview sign-in</Button></div>
          </Stack>
        </Card>
      )}
      <SignInPreview open={previewing} onClose={() => setPreviewing(false)} />
    </Stack>
  );
}
