import { Alert, Button, Container, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/session";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!loading && user) return <Navigate to={from} replace />;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(name, pw);
      nav(from, { replace: true });
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 401 ? "Incorrect username or password." : (x as Error).message);
    } finally {
      setBusy(false);
      setPw("");
    }
  }
  return (
    <Container size={360} py="xl">
      <form onSubmit={submit}>
        <Stack>
          <Title order={2}>Sign in to Litara</Title>
          {err && <Alert color="red" role="alert">{err}</Alert>}
          <TextInput label="Username" value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="username" required />
          <PasswordInput label="Password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} autoComplete="current-password" required />
          <Button type="submit" loading={busy}>Sign in</Button>
        </Stack>
      </form>
    </Container>
  );
}
