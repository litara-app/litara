import type { MetadataSearchResult } from '../api/books';

let _results: MetadataSearchResult[] = [];
let _selected: MetadataSearchResult | null = null;

export const metadataSearchStore = {
  setResults(r: MetadataSearchResult[]): void {
    _results = r;
  },
  getResults(): MetadataSearchResult[] {
    return _results;
  },
  setSelected(r: MetadataSearchResult): void {
    _selected = r;
  },
  getSelected(): MetadataSearchResult | null {
    return _selected;
  },
  clear(): void {
    _results = [];
    _selected = null;
  },
};
