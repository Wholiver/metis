import '@testing-library/jest-dom/vitest';

class MatchMediaMock {
  matches = false;
  media = '';
  onchange = null;

  addEventListener() {}
  removeEventListener() {}
  addListener() {}
  removeListener() {}
  dispatchEvent() { return true; }
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => new MatchMediaMock(),
});
