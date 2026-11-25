import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api/client";
import type { ReadingStats } from "../api/types";
import { icons, Busy, Button, Card, ErrorBox, Heatmap, Page, PageHeader, Row, Stack, Table, TBody, TD, Text, TH, THead, TR, type HeatDay } from "../ui";

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

function Tile({ value, label }: { value: string; label: string }) {
  return <div className="lt-stat-tile"><span className="lt-stat-value">{value}</span><span className="lt-stat-label">{label}</span></div>;
}

/** Reading stats from the person's own ebook reading sessions over the last year (ADR-0098). */
export function StatsPage() {
  const [{ from, to, all }] = useState(lastYear);
  const [asTable, setAsTable] = useState(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stats = useQuery({
    queryKey: ["stats", "reading", from, to, timeZone],
    queryFn: () => get<ReadingStats>(`/stats/reading?from=${from}&to=${to}&timeZone=${encodeURIComponent(timeZone)}`),
  });
  const s = stats.data;
  const threshold = readingTime(s?.readingDaySeconds ?? 300);
  const byDate = new Map((s?.days ?? []).map((d) => [d.date, d]));
  const days: HeatDay[] = all.map((date) => {
    const d = byDate.get(date);
    const secs = d?.activeSeconds ?? 0;
    return { date, level: level(secs, s?.readingDaySeconds ?? 300),
      label: `${long(date)}: ${secs ? `${readingTime(secs)} in ${d!.sessions} ${d!.sessions === 1 ? "session" : "sessions"}` : "no reading"}` };
  });
  const steps = ["No reading", `Under ${threshold}`, `${threshold} to 29 min`, "30 to 59 min", "1 hour or more"];
  const streak = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  return (
    <Page>
      <PageHeader title="Reading stats"
        description={`Your own ebook reading over the last year, by day in your time zone (${timeZone}). A day counts toward a streak when you read for ${threshold} or more. Audiobook listening is not counted yet.`} />
      {stats.isPending ? <Busy /> : <ErrorBox error={stats.error} />}
      {s && (
        <Stack>
          <div className="lt-stat-tiles" data-testid="stat-tiles">
            <Tile value={readingTime(s.activeSeconds)} label="Time read" />
            <Tile value={String(s.readingDays)} label="Reading days" />
            <Tile value={streak(s.currentStreak)} label="Current streak" />
            <Tile value={streak(s.longestStreak)} label="Longest streak" />
            <Tile value={String(s.books)} label={s.books === 1 ? "Book" : "Books"} />
            <Tile value={String(s.sessions)} label="Sessions" />
          </div>
          <Card framed>
            <Stack gap="sm">
              <Row justify="between">
                <Text strong>Minutes read per day</Text>
                <Button size="sm" icon={asTable ? icons.stats : icons.list} onClick={() => setAsTable((v) => !v)}>{asTable ? "Show as calendar" : "Show as table"}</Button>
              </Row>
              {asTable ? (
                <Table label="Reading by day" data-testid="stats-table">
                  <THead><TR><TH>Day</TH><TH>Time read</TH><TH>Sessions</TH><TH>Reading day</TH></TR></THead>
                  <TBody>
                    {s.days.length === 0 && <TR><TD colSpan={4}><Text size="sm" tone="dim">No reading in the last year.</Text></TD></TR>}
                    {[...s.days].reverse().map((d) => (
                      <TR key={d.date}><TD>{long(d.date)}</TD><TD>{readingTime(d.activeSeconds)}</TD><TD>{d.sessions}</TD><TD>{d.readingDay ? "Yes" : "No"}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Heatmap days={days} steps={steps} label={`Minutes read per day from ${long(from)} to ${long(to)}`}
                  empty={s.sessions ? "Point at a day to see how long you read." : "No reading in the last year yet. Open a book to start."} />
              )}
            </Stack>
          </Card>
        </Stack>
      )}
    </Page>
  );
}
