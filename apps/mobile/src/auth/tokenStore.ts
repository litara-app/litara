let _token: string | null = null;

export const tokenStore = {
  get: () => _token,
  set: (token: string | null) => {
    _token = token;
  },
};
