import { api } from './client';

export function getServerInfo(): Promise<{ version: string }> {
  return api.get<{ version: string }>('/server/info').then((r) => r.data);
}
