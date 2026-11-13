let _token: string | null = null;
let _logoutCallback: (() => void) | null = null;

export const tokenStore = {
  get: () => _token,

  set: (token: string | null) => {
    const prev = _token;
    _token = token;
    // Fire the logout callback when the token is cleared from a non-null state
    // (e.g., 401 interceptor). Guarded so re-entrant calls from clearToken are no-ops.
    if (prev !== null && token === null && _logoutCallback) {
      void _logoutCallback();
    }
  },

  /** AuthContext registers clearToken here so 401s trigger a full logout. */
  registerLogoutCallback: (cb: (() => void) | null) => {
    _logoutCallback = cb;
  },
};
