import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useMemo, useState, type FormEvent } from "react";
import { SignInView, type Phase } from "../pages/SignInView";
import { icons, Button, PasswordField, Stack, TextField } from "../ui";
import { pickScene } from "../ui/scenes";
import { useTheme } from "../ui/ThemeProvider";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A full-screen copy of the sign-in screen using the current theme and background. Nothing is sent anywhere. */
export function SignInPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, scene: choice, cleanBg } = useTheme();
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  // Pick again each time the preview opens, so "Surprise me" shows a different backdrop.
  const scene = useMemo(() => pickScene(choice), [choice, open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function demo(e: FormEvent) {
    e.preventDefault();
    setPhase("turning");
    await wait(500);
    if (theme === "reading-room" && !reduced()) {
      setPhase("unlocking");
      await wait(200);
      setPhase("opening");
      await wait(900);
    }
    setPhase("idle");
    setName("");
    setPw("");
    onClose();
  }

  const fields = (
    <Stack>
      <TextField label="Username" value={name} onValue={setName} autoComplete="off" />
      <PasswordField label="Password" value={pw} onValue={setPw} autoComplete="new-password" />
      <Button type="submit" variant="primary" loading={phase === "turning"} icon={icons.user}>Sign in</Button>
    </Stack>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPhase("idle"); onClose(); } }}>
      <DialogContent className="lt-preview">
        <DialogTitle className="lt-sr">Sign-in preview</DialogTitle>
        <SignInView root="div" theme={theme} scene={scene} cleanBg={cleanBg} phase={phase} fields={fields} onSubmit={demo} />
        <div className="lt-preview-bar">
          <span>Preview: nothing is sent. Press Sign in to watch it open.</span>
          <DialogClose className="lt-btn" data-variant="primary" data-size="sm">Close preview</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
