import { api } from './client';

export interface MetadataProvider {
  id: string;
  label: string;
}

export async function getMetadataProviders(): Promise<MetadataProvider[]> {
  const { data } = await api.get<MetadataProvider[]>(
    '/settings/metadata-providers',
  );
  return data;
}
