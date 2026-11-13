let _serverUrl: string | null = null;

export const serverUrlStore = {
  get: () => _serverUrl,
  set: (url: string | null) => {
    _serverUrl = url;
  },
};
