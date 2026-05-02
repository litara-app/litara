let _bookId: string | null = null;

export function setActiveBookId(bookId: string | null): void {
  _bookId = bookId;
}

export function activeBookId(): string | null {
  return _bookId;
}
