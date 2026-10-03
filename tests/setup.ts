import '@testing-library/jest-dom/vitest';

// jsdom lacks these; Radix, react-virtual and framer-motion all touch them.
if (typeof window !== 'undefined') {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom has no canvas; the editor draws nothing there, which is fine for behaviour tests.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom does no layout, so every element measures 0x0 and the virtual list would render nothing.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 640 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 640, width: 800, height: 640, toJSON() {} } as DOMRect;
  };
}
