import { useEffect, useState } from 'react';

/**
 * Hook to automatically track the operating system's color scheme (light/dark)
 * and synchronize the 'dark' class on document.documentElement.
 */
export function useSystemTheme(): { isDark: boolean } {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = (matches: boolean) => {
      setIsDark(matches);
      if (matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Initial sync
    updateTheme(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      updateTheme(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return { isDark };
}
