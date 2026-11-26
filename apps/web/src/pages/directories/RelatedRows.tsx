import { useQuery } from "@tanstack/react-query";
import type { Title } from "../../api/types";
import { icons, Button, CoverLink, Heading, Row, Stack } from "../../ui";
import { authorPath, bookNumber, coverMedium, seriesPath, titlesBy } from "./directory";

const LIMIT = 12;
const AUTHORS = 2;

function Related({ heading, to, field, name, current, numbered, testId }: {
  heading: string; to: string; field: "author" | "series"; name: string; current: string; numbered?: boolean; testId: string;
}) {
  const q = useQuery({ queryKey: ["titles", `by-${field}`, name.toLowerCase()], queryFn: () => titlesBy(field, name), staleTime: 60_000 });
  const others = (q.data ?? []).filter((t) => t.id !== current);
  if (others.length === 0) return null; // nothing else to show, or not loaded yet
  return (
    <section aria-label={heading} data-testid={testId}>
      <Stack gap="sm">
        <Row justify="between">
          <Heading level={3}>{heading}</Heading>
          {others.length > LIMIT && <Button size="sm" to={to} icon={icons.chevRight}>See all {others.length + 1}</Button>}
        </Row>
        <div className="lt-cover-row">
          {others.slice(0, LIMIT).map((t) => (
            <CoverLink key={t.id} to={`/titles/${t.id}`} name={numbered && t.seriesIndex !== null ? `${bookNumber(t.seriesIndex)} ${t.title}` : t.title}
              title={t.title} author={t.authors[0]} titleId={t.id} medium={coverMedium(t)} />
          ))}
        </div>
      </Stack>
    </section>
  );
}

/** "In this series" and "More by" rows under a title page's tabs (ADR-0100); each hides when it has nothing else. */
export function RelatedRows({ title }: { title: Title }) {
  const series = title.series[0]?.trim();
  const authors = title.authors.map((a) => a.trim()).filter(Boolean).slice(0, AUTHORS);
  if (!series && authors.length === 0) return null;
  return (
    <Stack gap="lg" data-testid="related">
      {series && <Related heading={`In this series: ${series}`} to={seriesPath(series)} field="series" name={series} current={title.id} numbered testId="related-series" />}
      {authors.map((a) => <Related key={a.toLowerCase()} heading={`More by ${a}`} to={authorPath(a)} field="author" name={a} current={title.id} testId="related-author" />)}
    </Stack>
  );
}
