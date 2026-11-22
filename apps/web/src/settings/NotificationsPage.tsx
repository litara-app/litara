import { useEffect } from "react";
import { Button, EmptyState, icons, Row, Stack, Text, useNotices, NoticeRow } from "../ui";

/** The full notification history for this account (ADR-0089). */
export function NotificationsPage() {
  const { items, clear, markAllRead } = useNotices();
  useEffect(() => { markAllRead(); }, [markAllRead, items.length]);
  return (
    <Stack>
      <Row gap="sm" wrap>
        <Text tone="dim" size="sm">The results of your actions and of background work. Kept on the server for your account and shown on every device, newest first. The newest 500 or 90 days are kept.</Text>
        <Button size="sm" icon={icons.trash} disabled={items.length === 0} onClick={clear}>Clear history</Button>
      </Row>
      {items.length === 0
        ? <EmptyState title="No notifications yet" level={3}>When you save, search or send something, the result is shown here as well.</EmptyState>
        : <ul className="lt-notice-list lt-notice-history" aria-label="Notification history" data-testid="notification-history">{items.map((n) => <NoticeRow key={n.id} n={n} />)}</ul>}
    </Stack>
  );
}
