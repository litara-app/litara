// jsdom lacks APIs that UI SDK popups use for enter and exit animation. Report "no animations" so they settle at once.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
}
