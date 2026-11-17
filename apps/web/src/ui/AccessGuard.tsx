import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client";
import { usePendingQueue } from "../pending/PendingProvider";

const DENIED = "library_access_denied";

/**
 * When the server says this account no longer has access to a library, stop showing what was
 * loaded from it: clear every cached response, unmount the reader or player (which releases
 * their file bytes and frames) and explain. Unsent local changes stay on the Pending page
 * (ADR-0068); they are never discarded here.
 */
export function AccessGuard({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const queue = usePendingQueue();
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    const trip = () => { setRevoked(true); qc.clear(); };
    const offQueries = qc.getQueryCache().subscribe((e) => {
      const err = e.type === "updated" && e.action.type === "error" ? e.action.error : null;
      if (err instanceof ApiError && err.status === 403 && err.code === DENIED) trip();
    });
    const offQueue = queue.onBlocked((_op, problem) => { if (problem.code === DENIED) trip(); });
    return () => { offQueries(); offQueue(); };
  }, [qc, queue]);

  if (!revoked) return <>{children}</>;
  return (
    <Container size="sm" py="xl">
      <Stack>
        <Title order={2}>Access to this library was removed</Title>
        <Alert color="red" role="alert" title="This content is no longer shown">
          An administrator removed your access. What was open here has been closed and cleared from this page.
        </Alert>
        <Text>Changes you made that were not yet saved are kept on the Pending page. They are not sent, and not deleted, until you decide.</Text>
        <Group>
          <Button component={Link} to="/pending" onClick={() => setRevoked(false)}>Review unsent changes</Button>
          <Button component={Link} to="/" variant="default" onClick={() => setRevoked(false)}>Back to the library</Button>
        </Group>
      </Stack>
    </Container>
  );
}
