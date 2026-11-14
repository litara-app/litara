import { Alert, Badge, Center, Loader } from "@mantine/core";
import { ApiError } from "../api/client";
import type { Capability } from "../api/types";

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  const code = error instanceof ApiError && error.code ? ` (${error.code})` : "";
  return <Alert color="red" title="Something went wrong" role="alert">{e.message}{code}</Alert>;
}

export function Busy() {
  return <Center py="xl"><Loader aria-label="Loading" /></Center>;
}

const colors = { supported: "green", incomplete: "yellow", unsupported: "gray" } as const;
export function CapBadge({ name, cap }: { name: string; cap: Capability }) {
  return <Badge color={colors[cap.state]} variant="light" title={cap.issues.map((i) => i.detail).join(" ")}>{name}: {cap.state}</Badge>;
}

export function bytes(n: number | null): string {
  if (n === null) return "unknown size";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(1)} MiB`;
}
