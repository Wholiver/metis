import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, DownloadSimple, GithubLogo } from '@phosphor-icons/react';
import { LivingCloud, type CloudExpression } from './components/LivingCloud';
import { copy, INSTALL_COMMAND, LINKS, type Locale } from './content';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function ExternalLink({ href, className, children, ariaLabel }: {
  href: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer" aria-label={ariaLabel}>
      {children}
    </a>
  );
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const [locale, setLocale] = useState<Locale>(() => {
    try { return localStorage.getItem('metis-site-locale') === 'zh-CN' ? 'zh-CN' : 'en'; }
    catch { return 'en'; }
  });
  const [copied, setCopied] = useState(false);
  const [cloudExpression, setCloudExpression] = useState<CloudExpression>('idle');
  const happyTimeoutRef = useRef<number | null>(null);

  const t = copy[locale];
  const asset = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.metaTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.metaDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', t.metaTitle);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', t.metaDescription);
    try { localStorage.setItem('metis-site-locale', locale); } catch { /* storage optional */ }
  }, [locale, t.metaDescription, t.metaTitle]);

  const copyInstall = async () => {
    try { await navigator.clipboard.writeText(INSTALL_COMMAND); }
    catch {
      const field = document.createElement('textarea');
      field.value = INSTALL_COMMAND;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);

    if (!reducedMotion) {
      setCloudExpression('happy');
      if (happyTimeoutRef.current) clearTimeout(happyTimeoutRef.current);
      happyTimeoutRef.current = window.setTimeout(() => {
        setCloudExpression('idle');
      }, 2000);
    }

    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">{t.skip}</a>

      {/* Minimal Header */}
      <header className="site-header">
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="brand" href="/" aria-label="Metis home">
            <img src={asset('metis-app-icon-centered.svg')} alt="" width="36" height="36" />
            <span className="brand-text">METIS</span>
          </a>

          <div className="nav-actions">
            <button
              type="button"
              className="lang-toggle-btn"
              onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
              aria-label={t.nav.language}
            >
              {locale === 'en' ? '中文' : 'EN'}
            </button>
            <ExternalLink href={LINKS.repository} className="nav-github" ariaLabel={t.nav.github}>
              <GithubLogo size={18} weight="regular" aria-hidden="true" />
              <span>{t.nav.github}</span>
            </ExternalLink>
          </div>
        </nav>
      </header>

      {/* Main Hero-Only Section */}
      <main id="main" className="hero-viewport">
        <div className="hero-content-wrap">
          {/* Core Slogan & Subheadline */}
          <h1 className="hero-headline">{t.hero.headline}</h1>
          <p className="hero-subhead">{t.hero.subhead}</p>

          {/* Living Center Black Cloud */}
          <div
            className="story-main-cloud hero-cloud-container"
            onPointerEnter={() => !reducedMotion && setCloudExpression('happy')}
            onPointerLeave={() => !reducedMotion && setCloudExpression('idle')}
          >
            <div className="hero-cloud-anchor">
              <LivingCloud
                expression={cloudExpression}
                alt={t.hero.cloudAlt}
                reducedMotion={reducedMotion}
                className="main-black-cloud"
              />
            </div>
          </div>

          {/* One-line CLI Install Box */}
          <div className="install-box">
            <div className="install-prompt-symbol" aria-hidden="true">$</div>
            <code className="install-code">{INSTALL_COMMAND}</code>
            <button
              type="button"
              className="copy-btn"
              onClick={copyInstall}
              aria-label={t.hero.copy}
            >
              {copied ? (
                <>
                  <Check size={16} weight="bold" className="copy-icon-check" aria-hidden="true" />
                  <span>{t.hero.copied}</span>
                </>
              ) : (
                <>
                  <Copy size={16} weight="regular" className="copy-icon" aria-hidden="true" />
                  <span>{t.hero.copy}</span>
                </>
              )}
            </button>
          </div>

          {/* Primary Action Buttons */}
          <div className="hero-actions-wrap">
            <div className="hero-actions-row">
              <ExternalLink href={LINKS.releases} className="cta-button cta-primary">
                <DownloadSimple size={18} weight="bold" aria-hidden="true" />
                <span>{t.hero.downloadApp}</span>
              </ExternalLink>

              <ExternalLink href={LINKS.repository} className="cta-button cta-secondary">
                <GithubLogo size={18} weight="regular" aria-hidden="true" />
                <span>{t.hero.viewGithub}</span>
              </ExternalLink>
            </div>
            <span className="platforms-caption">{t.hero.platforms}</span>
          </div>

          {/* Subtle Empirical Evidence Footer Note */}
          <div className="evidence-footnote">
            <span className="evidence-model">DeepSeek V4 Flash</span>
            <span className="evidence-dot" aria-hidden="true">/</span>
            <span className="evidence-accuracy">82.02% Metis</span>
            <span className="evidence-vs">vs</span>
            <span className="evidence-baseline">67.42% OpenCode</span>
            <span className="evidence-dot" aria-hidden="true">/</span>
            <span className="evidence-delta">+13 tasks solved</span>
            <ExternalLink href={LINKS.benchmark} className="evidence-link">
              {t.benchmark.source}
            </ExternalLink>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="site-footer">
        <div className="footer-content">
          <span className="footer-tagline">{t.footer.tagline}</span>
          <div className="footer-links">
            <ExternalLink href={LINKS.releases}>{t.footer.releases}</ExternalLink>
            <ExternalLink href={LINKS.docs}>{t.footer.docs}</ExternalLink>
            <ExternalLink href={LINKS.npm}>{t.footer.npm}</ExternalLink>
            <ExternalLink href={LINKS.repository}>{t.footer.github}</ExternalLink>
            <ExternalLink href={LINKS.license}>{t.footer.license}</ExternalLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
