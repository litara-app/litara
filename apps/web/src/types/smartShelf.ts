export interface SmartShelfRule {
  id: string;
  field: string;
  operator: string;
  value: string;
}

export interface SmartShelfSummary {
  id: string;
  name: string;
  logic: 'AND' | 'OR';
  ruleCount: number;
}

export interface SmartShelfDetail {
  id: string;
  name: string;
  logic: 'AND' | 'OR';
  rules: SmartShelfRule[];
}

export const SMART_SHELF_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'genre', label: 'Genre' },
  { value: 'tag', label: 'Tag' },
  { value: 'language', label: 'Language' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'seriesName', label: 'Series Name' },
  { value: 'format', label: 'Format' },
  { value: 'pageCount', label: 'Page Count' },
  { value: 'publishedYear', label: 'Published Year' },
  { value: 'isbn13', label: 'ISBN-13' },
  { value: 'userRating', label: 'My Rating' },
];

const NUMERIC_FIELDS = new Set(['pageCount', 'publishedYear', 'userRating']);

export const SMART_SHELF_OPERATORS: Array<{
  value: string;
  label: string;
  numericOnly?: boolean;
  stringOnly?: boolean;
}> = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'contains', label: 'contains', stringOnly: true },
  { value: 'startsWith', label: 'starts with', stringOnly: true },
  { value: 'gt', label: 'greater than', numericOnly: true },
  { value: 'lt', label: 'less than', numericOnly: true },
];

export function operatorsForField(field: string) {
  const isNumeric = NUMERIC_FIELDS.has(field);
  return SMART_SHELF_OPERATORS.filter((op) => {
    if (isNumeric && op.stringOnly) return false;
    if (!isNumeric && op.numericOnly) return false;
    return true;
  });
}
