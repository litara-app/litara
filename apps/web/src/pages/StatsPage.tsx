import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api/client";
import type { ReadingStats } from "../api/types";
import { icons, Busy, Button, Card, ErrorBox, Heatmap, Page, PageHeader, Pager, Row, Stack, Table, TBody, TD, Text, TH, THead, TR, type HeatDay } from "../ui";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const long = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); };

/** Minutes and hours as a person says them: "45 min", "3 h 20 min". */
export function readingTime(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** The heatmap's shade for a day: below a reading day, then 5-29 min, 30-59 min and an hour or more (ADR-0098). */
export function level(seconds: number, readingDay: number): HeatDay["level"] {
  if (seconds <= 0) return 0;
  if (seconds < readingDay) return 1;
  if (seconds < 30 * 60) return 2;
  if (seconds < 60 * 60) return 3;
  return 4;
}

/** The last 365 days, ending today, as local dates. */
function lastYear(): { from: string; to: string; all: string[] } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364);
  const all: string[] = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) all.push(iso(d));
  return { from: all[0]!, to: all[all.length - 1]!, all };
}

const TABLE_ROWS = 25;

function Tile({ value, label }: { value: string; label: string }) {
  return <div className="lt-stat-tile"><span className="lt-stat-value">{value}</span><span className="lt-stat-label">{label}</span></div>;
}

/** Stats from the person's own reading and listening over the last year (ADR-0098, ADR-0109). */
export function StatsPage() {
  const [{ from, to, all }] = useState(lastYear);
  const [asTable, setAsTable] = useState(false);
  const [page, setPage] = useState(1);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stats = useQuery({
    queryKey: ["stats", "reading", from, to, timeZone],
    queryFn: () => get<ReadingStats>(`/stats/reading?from=${from}&to=${to}&timeZone=${encodeURIComponent(timeZone)}`),
  });
  const s = stats.data;
  const threshold = readingTime(s?.readingDaySeconds ?? 300);
  const byDate = new Map((s?.activity ?? []).map((d) => [d.date, d]));
  const days: HeatDay[] = all.map((date) => {
    const d = byDate.get(date);
    const secs = d ? d.readingSeconds + d.listeningSeconds : 0;
    const parts = d ? [d.readingSessions ? `${readingTime(d.readingSeconds)} read` : "", d.listeningSessions ? `${readingTime(d.listeningSeconds)} listened` : ""].filter(Boolean) : [];
    return { date, level: level(secs, s?.readingDaySeconds ?? 300),
      label: `${long(date)}: ${parts.length ? parts.join(", ") : "no reading or listening"}` };
  });
  const steps = ["Nothing", `Under ${threshold}`, `${threshold} to 29 min`, "30 to 59 min", "1 hour or more"];
  // The heatmap already needs the whole year, so the table pages through it here, newest day first.
  const newestFirst = [...(s?.activity ?? [])].reverse();
  const pageCount = Math.max(1, Math.ceil(newestFirst.length / TABLE_ROWS));
  const shown = Math.min(page, pageCount); // a refetch can leave fewer pages
  const streak = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  return (
    <Page>
      <PageHeader title="Reading stats"
        description={`Your own reading and listening over the last year, by day in your time zone (${timeZone}). A day counts toward a streak when you read and listen for ${threshold} or more in total.`} />
      {stats.isPending ? <Busy /> : <ErrorBox error={stats.error} />}
      {s && (
        <Stack>
          <div className="lt-stat-tiles" data-testid="stat-tiles">
            <Tile value={readingTime(s.activeSeconds + s.listeningSeconds)} label="Total time" />
            <Tile value={readingTime(s.activeSeconds)} label="Time read" />
            <Tile value={readingTime(s.listeningSeconds)} label="Time listened" />
            <Tile value={String(s.readingDays)} label="Reading days" />
            <Tile value={streak(s.currentStreak)} label="Current streak" />
            <Tile value={streak(s.longestStreak)} label="Longest streak" />
            <Tile value={String(s.books)} label={s.books === 1 ? "Book read" : "Books read"} />
            <Tile value={String(s.listenedBooks)} label={s.listenedBooks === 1 ? "Book listened to" : "Books listened to"} />
            <Tile value={String(s.paperBooksFinished)} label={s.paperBooksFinished === 1 ? "Paper book finished" : "Paper books finished"} />
            <Tile value={String(s.sessions + s.listeningSessions)} label="Sessions" />
          </div>
          <Card framed>
            <Stack gap="sm">
              <Row justify="between">
                <Text strong>Reading and listening per day</Text>
                <Button size="sm" icon={asTable ? icons.stats : icons.list} onClick={() => setAsTable((v) => !v)}>{asTable ? "Show as calendar" : "Show as table"}</Button>
              </Row>
              {asTable ? (
                <>
                  <Table label="Activity by day" data-testid="stats-table">
                    <THead><TR><TH>Day</TH><TH>Read</TH><TH>Listened</TH><TH>Total</TH><TH>Sessions</TH><TH>Reading day</TH></TR></THead>
                    <TBody>
                      {s.activity.length === 0 && <TR><TD colSpan={6}><Text size="sm" tone="dim">No reading or listening in the last year.</Text></TD></TR>}
                      {newestFirst.slice((shown - 1) * TABLE_ROWS, shown * TABLE_ROWS).map((d) => (
                        <TR key={d.date}><TD>{long(d.date)}</TD><TD>{readingTime(d.readingSeconds)}</TD><TD>{readingTime(d.listeningSeconds)}</TD><TD>{readingTime(d.readingSeconds + d.listeningSeconds)}</TD><TD>{d.readingSessions + d.listeningSessions}</TD><TD>{d.readingDay ? "Yes" : "No"}</TD></TR>
                      ))}
                    </TBody>
                  </Table>
                  {pageCount > 1 && <Pager label="Activity by day pages" page={shown} pageCount={pageCount} onPage={setPage} />}
                </>
              ) : (
                <Heatmap days={days} steps={steps} label={`Minutes read and listened per day from ${long(from)} to ${long(to)}`}
                  empty={s.activity.length ? "Point at a day to see how long you read and listened." : "Nothing in the last year yet. Open a book to start."} />
              )}
            </Stack>
          </Card>
        </Stack>
      )}
    </Page>
  );
}
