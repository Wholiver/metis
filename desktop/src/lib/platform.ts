export const isMac = (() => {
  if (typeof window !== 'undefined' && (window as any).metisDesktop?.platform) {
    return (window as any).metisDesktop.platform === 'darwin';
  }
  if (typeof document !== 'undefined' && document.body?.classList?.contains('platform-darwin')) {
    return true;
  }
  if (typeof navigator !== 'undefined') {
    return /Mac/i.test(navigator.userAgent || '');
  }
  return false;
})();

export const isWindows = (() => {
  if (typeof window !== 'undefined' && (window as any).metisDesktop?.platform) {
    return (window as any).metisDesktop.platform === 'win32';
  }
  if (typeof document !== 'undefined' && document.body?.classList?.contains('platform-win32')) {
    return true;
  }
  if (typeof navigator !== 'undefined') {
    return /Win/i.test(navigator.userAgent || '');
  }
  return false;
})();
