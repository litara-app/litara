import { useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/session";
import { icons, Alert, Button, PasswordField, Stack, TextField } from "../ui";
import { pickCleanBg, pickScene } from "../ui/scenes";
import { useTheme } from "../ui/ThemeProvider";
import { SignInView, type Phase } from "./SignInView";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const { theme, scene: choice, cleanBg } = useTheme();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const scene = useMemo(() => pickScene(choice), [choice]);
  // Signing in makes `user` appear before the opening animation finishes; the redirect waits for it.
  const playing = useRef(false);
  if (!loading && user && !playing.current) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    playing.current = true;
    setPhase("turning");
    try {
      await login(name, pw);
    } catch (x) {
      playing.current = false;
      setErr(x instanceof ApiError && x.status === 401 ? "Incorrect username or password." : (x as Error).message);
      setPw("");
      setPhase("denied");
      await wait(reduced() ? 0 : 450);
      setPhase("idle");
      return;
    }
    if (theme === "reading-room" && !reduced()) {
      setPhase("unlocking"); // the clasp dissolves
      await wait(200);
      setPhase("opening"); // the cover swings back as the page grows into the app
      await wait(540);
    }
    nav(from, { replace: true });
  }

  const fields = (
    <Stack>
      {err && <Alert tone="danger" role="alert">{err}</Alert>}
      <TextField label="Username" value={name} onValue={setName} autoComplete="username" required />
      <PasswordField label="Password" value={pw} onValue={setPw} autoComplete="current-password" required />
      <Button type="submit" variant="primary" loading={phase === "turning"} icon={icons.user}>Sign in</Button>
    </Stack>
  );

  return <SignInView theme={theme} scene={scene} cleanBg={pickCleanBg(cleanBg)} phase={phase} fields={fields} onSubmit={submit} />;
}
