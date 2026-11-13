import { api } from './client';

export interface RecipientEmail {
  id: string;
  email: string;
  label: string | null;
  isDefault: boolean;
}

export function getRecipientEmails(): Promise<RecipientEmail[]> {
  return api
    .get<RecipientEmail[]>('/users/me/recipient-emails')
    .then((r) => r.data);
}

export function sendBook(
  bookId: string,
  opts?: { recipientEmailId?: string; fileId?: string },
): Promise<void> {
  return api.post(`/books/${bookId}/send`, opts ?? {}).then(() => undefined);
}
