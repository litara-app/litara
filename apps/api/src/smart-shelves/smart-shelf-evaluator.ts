import { Prisma } from '@prisma/client';

interface Rule {
  field: string;
  operator: string;
  value: string;
}

type BookWhereInput = Prisma.BookWhereInput;

function buildStringFilter(
  operator: string,
  value: string,
): Prisma.StringFilter | string | { not: Prisma.StringFilter } | undefined {
  switch (operator) {
    case 'eq':
      return { equals: value, mode: 'insensitive' };
    case 'ne':
      return { not: { equals: value } };
    case 'contains':
      return { contains: value, mode: 'insensitive' };
    case 'startsWith':
      return { startsWith: value, mode: 'insensitive' };
    default:
      return undefined;
  }
}

function buildNumericFilter(
  operator: string,
  value: string,
): Prisma.IntFilter | undefined {
  const num = Number(value);
  if (isNaN(num)) return undefined;
  switch (operator) {
    case 'eq':
      return { equals: num };
    case 'ne':
      return { not: { equals: num } };
    case 'gt':
      return { gt: num };
    case 'lt':
      return { lt: num };
    default:
      return undefined;
  }
}

function buildFloatFilter(
  operator: string,
  value: string,
): Prisma.FloatNullableFilter | undefined {
  const num = Number(value);
  if (isNaN(num)) return undefined;
  switch (operator) {
    case 'eq':
      return { equals: num };
    case 'ne':
      return { not: { equals: num } };
    case 'gt':
      return { gt: num };
    case 'lt':
      return { lt: num };
    default:
      return undefined;
  }
}

function buildRuleFilter(rule: Rule, userId?: string): BookWhereInput | null {
  const { field, operator, value } = rule;
  if (!value?.trim()) return null;

  switch (field) {
    case 'title': {
      const f = buildStringFilter(operator, value);
      return f ? { title: f as Prisma.StringFilter } : null;
    }
    case 'language': {
      const f = buildStringFilter(operator, value);
      return f ? { language: f as Prisma.StringFilter } : null;
    }
    case 'publisher': {
      const f = buildStringFilter(operator, value);
      return f ? { publisher: f as Prisma.StringFilter } : null;
    }
    case 'isbn13': {
      const f = buildStringFilter(operator, value);
      return f ? { isbn13: f as Prisma.StringFilter } : null;
    }
    case 'author': {
      const f = buildStringFilter(operator, value);
      return f
        ? {
            authors: {
              some: { author: { name: f as Prisma.StringFilter } },
            },
          }
        : null;
    }
    case 'genre': {
      const f = buildStringFilter(operator, value);
      return f
        ? { genres: { some: { name: f as Prisma.StringFilter } } }
        : null;
    }
    case 'tag': {
      const f = buildStringFilter(operator, value);
      return f ? { tags: { some: { name: f as Prisma.StringFilter } } } : null;
    }
    case 'seriesName': {
      const f = buildStringFilter(operator, value);
      return f
        ? {
            series: {
              some: { series: { name: f as Prisma.StringFilter } },
            },
          }
        : null;
    }
    case 'format': {
      const f = buildStringFilter(operator, value);
      return f
        ? { files: { some: { format: f as Prisma.StringFilter } } }
        : null;
    }
    case 'pageCount': {
      const f = buildNumericFilter(operator, value);
      return f ? { pageCount: f } : null;
    }
    case 'userRating': {
      if (!userId) return null;
      const f = buildFloatFilter(operator, value);
      return f ? { reviews: { some: { userId, rating: f } } } : null;
    }
    case 'publishedYear': {
      const year = parseInt(value, 10);
      if (isNaN(year)) return null;
      const start = new Date(`${year}-01-01T00:00:00.000Z`);
      const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
      if (operator === 'eq') {
        return { publishedDate: { gte: start, lt: end } };
      } else if (operator === 'ne') {
        return {
          OR: [
            { publishedDate: { lt: start } },
            { publishedDate: { gte: end } },
          ],
        };
      } else if (operator === 'gt') {
        return { publishedDate: { gte: end } };
      } else if (operator === 'lt') {
        return { publishedDate: { lt: start } };
      }
      return null;
    }
    default:
      return null;
  }
}

export function buildBookWhere(
  rules: Rule[],
  logic: string,
  userId?: string,
): BookWhereInput {
  const filters = rules
    .map((r) => buildRuleFilter(r, userId))
    .filter((f): f is BookWhereInput => f !== null);

  if (filters.length === 0) return {};

  if (logic === 'OR') {
    return { OR: filters };
  }

  return { AND: filters };
}
