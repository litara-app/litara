let _enabled = false;
const _listeners: Array<(enabled: boolean) => void> = [];

export const podcastsEnabledStore = {
  get: () => _enabled,
  set: (enabled: boolean) => {
    _enabled = enabled;
    _listeners.forEach((fn) => fn(enabled));
  },
  subscribe: (fn: (enabled: boolean) => void) => {
    _listeners.push(fn);
    return () => {
      const idx = _listeners.indexOf(fn);
      if (idx >= 0) _listeners.splice(idx, 1);
    };
  },
};
