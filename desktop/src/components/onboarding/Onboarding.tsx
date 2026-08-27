import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Plus, Server } from 'lucide-react';
import type { ModelOption } from '../../types';
import { translateExact } from '../../i18n';
import './Onboarding.css';

const COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v3';
const LEGACY_COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v2';
const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'gemini', 'openrouter', 'groq', 'ollama'];
const providerLabel = 'Configure API / OAuth / Base URL';

// Inner interactive button radius = 10px (matching Settings sidebar tab)
const ONBOARDING_BTN_CLASS =
  'group inline-flex h-9 min-w-[110px] items-center justify-center rounded-[10px] border border-slate-200 bg-white px-4 text-[13.5px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed';

type Request = <T>(path: string, method?: string, body?: unknown, timeoutMs?: number) => Promise<T>;
type Workspace = { name?: string; path: string };
type ProviderMethod = 'api' | 'oauth' | 'custom';

type OnboardingProps = {
  open: boolean;
  request: Request;
  isConnected: boolean;
  models: ModelOption[];
  onComplete: () => void;
  onProjectReady: (workspace: Workspace) => Promise<void>;
  onSelectModel?: (model: ModelOption) => Promise<void>;
  onRefreshModels?: () => Promise<ModelOption[]>;
};

function detectSystemLanguage(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en';
  }
  return 'zh-CN';
}

function languageName(code: string): string {
  if (code === 'auto') return 'Automatic';
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-blue-600' : 'bg-slate-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

const SVG_D = "M91.76 0C93.05 2.98 94.08 6.16 94.77 9.34C95.46 12.52 95.85 15.83 95.91 19.08C95.97 22.34 95.7 25.66 95.13 28.86C94.55 32.07 93.64 35.27 92.45 38.3C91.26 41.33 89.74 44.3 87.98 47.03C86.23 49.77 84.16 52.38 81.9 54.72C79.64 57.06 77.11 59.22 74.44 61.07C71.77 62.92 68.86 64.54 65.88 65.84C62.9 67.13 59.73 68.15 56.55 68.84C53.38 69.52 49.47 68.77 46.82 69.95C44.17 71.13 42.86 74.06 40.66 75.9C38.47 77.73 36.11 79.46 33.65 80.98C31.19 82.5 28.59 83.87 25.92 85.02C23.25 86.18 20.45 87.15 17.63 87.91C14.81 88.67 11.89 89.22 8.98 89.56C6.07 89.89 3.1 90.01 0.18 89.91C-2.74 89.81 -5.69 89.5 -8.56 88.97C-11.43 88.45 -14.29 87.7 -17.04 86.77C-19.79 85.84 -22.49 84.69 -25.06 83.37C-27.62 82.06 -30.08 80.5 -32.43 78.9C-34.78 77.3 -36.41 74.63 -39.16 73.76C-41.92 72.9 -45.71 74.02 -48.96 73.7C-52.21 73.38 -55.49 72.75 -58.65 71.83C-61.8 70.92 -64.94 69.69 -67.88 68.21C-70.83 66.72 -73.7 64.93 -76.33 62.92C-78.96 60.91 -81.45 58.62 -83.67 56.15C-85.9 53.68 -87.93 50.96 -89.66 48.12C-91.39 45.28 -92.88 42.23 -94.06 39.12C-95.23 36.01 -96.13 32.73 -96.72 29.46C-97.3 26.18 -97.58 22.8 -97.55 19.48C-97.52 16.16 -97.17 12.79 -96.53 9.55C-95.9 6.3 -94.94 3.06 -93.72 0C-92.51 -3.06 -90.98 -6.05 -89.23 -8.82C-87.49 -11.6 -85.46 -14.24 -83.26 -16.63C-81.06 -19.02 -77.97 -20.97 -76.03 -23.17C-74.1 -25.36 -72.47 -27.32 -71.62 -29.8C-70.77 -32.29 -71.4 -35.36 -70.93 -38.09C-70.46 -40.82 -69.75 -43.57 -68.81 -46.19C-67.86 -48.82 -66.67 -51.41 -65.28 -53.84C-63.89 -56.27 -62.26 -58.62 -60.46 -60.77C-58.66 -62.92 -56.64 -64.95 -54.49 -66.76C-52.34 -68.56 -49.99 -70.2 -47.56 -71.6C-45.13 -73 -42.53 -74.19 -39.9 -75.14C-37.27 -76.09 -34.51 -76.81 -31.76 -77.27C-29.01 -77.74 -26.19 -77.97 -23.42 -77.95C-20.65 -77.93 -17.84 -77.66 -15.14 -77.17C-12.43 -76.67 -9.74 -75.93 -7.19 -74.99C-4.64 -74.05 -2.14 -72.86 0.18 -71.52C2.51 -70.18 4.63 -68.12 6.76 -66.94C8.89 -65.77 10.7 -64.48 12.98 -64.47C15.25 -64.46 17.88 -66.3 20.42 -66.87C22.97 -67.45 25.62 -67.81 28.25 -67.92C30.88 -68.03 33.58 -67.9 36.2 -67.53C38.82 -67.16 41.46 -66.54 43.99 -65.7C46.51 -64.85 49 -63.76 51.34 -62.46C53.67 -61.17 55.93 -59.63 57.99 -57.93C60.05 -56.23 61.99 -54.3 63.71 -52.25C65.43 -50.2 66.99 -47.95 68.3 -45.61C69.62 -43.28 70.74 -40.79 71.6 -38.26C72.47 -35.73 73.11 -33.07 73.5 -30.43C73.89 -27.8 72.77 -24.82 73.95 -22.42C75.14 -20.02 78.44 -18.34 80.61 -16.03C82.78 -13.72 85.12 -11.24 86.97 -8.57C88.83 -5.89 90.46 -2.98 91.76 0Z";

function MetisBrandLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      width="220"
      height="220"
      viewBox="-125 -125 250 250"
      role="img"
      aria-label="Metis logo"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-lg transition-transform duration-300 hover:scale-105 ${className}`}
    >
      <defs>
        <mask id="bot-mask-in5s39" maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316">
          <path d={SVG_D} fill="#fff" />
          <path d="M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z" transform="matrix(0.92,-0.3,0.38,0.84,4.48,-27.18)" opacity="1" fill="#000" />
          <path d="M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z" transform="matrix(0.74,-0.02,0.38,0.84,43.55,-41.89)" opacity="1" fill="#000" />
        </mask>
      </defs>
      <g fill="none" strokeLinecap="round" />
      <g opacity="1">
        <path d={SVG_D} fill="#f9f9f9" />
        <g mask="url(#bot-mask-in5s39)">
          <rect x="-158" y="-158" width="316" height="316" fill="#0a0a0c" />
        </g>
      </g>
    </svg>
  );
}

export function shouldShowOnboarding(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return !storage.getItem(COMPLETED_KEY) && !storage.getItem(LEGACY_COMPLETED_KEY);
}

export function Onboarding({ open, request, isConnected, models, onComplete, onProjectReady, onSelectModel, onRefreshModels }: OnboardingProps) {
  const desktop = (window as any).metisDesktop;
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState('auto');
  const [languages, setLanguages] = useState<string[]>(['auto', 'en', 'zh-CN']);
  const [method, setMethod] = useState<ProviderMethod>('api');
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS);
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState('openai');
  const [oauthProvider, setOauthProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [customName, setCustomName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelIds, setModelIds] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; thinkingOptions: Array<{ id: string; label: string; value: string }> }>>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [projectMode, setProjectMode] = useState<'create' | 'import'>('create');
  const [parentPath, setParentPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [selectedProject, setSelectedProject] = useState<Workspace>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const providerChoices = useMemo(() => Array.from(new Set([
    ...FALLBACK_PROVIDERS,
    ...providers,
    ...models.map((model) => model.provider),
  ])).sort(), [models, providers]);

  // Auto-detect and sync language upon mounting
  useEffect(() => {
    if (!open) return;
    setFeedback('');
    setStep(0);
    const defaultDetected = detectSystemLanguage();
    setLanguage(defaultDetected);

    void desktop?.appInfo?.().then((info: { language?: string; languages?: string[] }) => {
      let resolved = defaultDetected;
      if (typeof info?.language === 'string' && info.language !== 'auto') {
        resolved = info.language;
      }
      setLanguage(resolved);
      if (Array.isArray(info?.languages)) {
        setLanguages(['auto', ...info.languages.filter((item) => item !== 'auto')]);
      }
      void desktop?.setUiLanguage?.(resolved);
      window.dispatchEvent(new CustomEvent('metis:language-changed', { detail: resolved }));
    }).catch(() => {
      void desktop?.setUiLanguage?.(defaultDetected);
      window.dispatchEvent(new CustomEvent('metis:language-changed', { detail: defaultDetected }));
    });
  }, [desktop, open]);

  useEffect(() => {
    if (!open || !isConnected) return;
    let current = true;
    void request<{ providers?: string[]; oauthProviders?: string[] }>('/session/command', 'POST', { command: '/login' })
      .then((result) => {
        if (!current) return;
        if (Array.isArray(result.providers)) setProviders(result.providers);
        if (Array.isArray(result.oauthProviders)) {
          setOauthProviders(result.oauthProviders);
          setOauthProvider((selected) => result.oauthProviders?.includes(selected) ? selected : result.oauthProviders?.[0] || '');
        }
      })
      .catch(() => undefined);

    void request<{ enabled?: boolean }>('/memory')
      .then((result) => {
        if (!current) return;
        if (typeof result?.enabled === 'boolean') {
          setMemoryEnabled(result.enabled);
        }
      })
      .catch(() => undefined);

    return () => { current = false; };
  }, [isConnected, open, request]);

  if (!open) return null;

  const complete = () => {
    localStorage.setItem(COMPLETED_KEY, 'true');
    onComplete();
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setFeedback('');
    try { await operation(); }
    catch (error) { setFeedback(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const saveLanguage = async (nextLanguage: string) => {
    setLanguage(nextLanguage);
    await desktop?.setUiLanguage?.(nextLanguage);
    window.dispatchEvent(new CustomEvent('metis:language-changed', { detail: nextLanguage }));
  };
  const toggleMemory = async () => {
    const next = !memoryEnabled;
    setMemoryEnabled(next);
    try {
      await request('/memory/settings', 'PUT', { enabled: next });
    } catch (err) {
      console.warn('[onboarding] Failed to update memory settings:', err);
    }
  };
  const bindModelAfterAuth = async (targetProvider?: string) => {
    const updatedModels = onRefreshModels
      ? await onRefreshModels()
      : (await request<{ models?: ModelOption[] }>('/config/providers').then((res) => Array.isArray(res.models) ? res.models : []).catch(() => []));

    let targetModel: ModelOption | undefined;
    if (targetProvider) {
      targetModel = updatedModels.find((m) => m.provider === targetProvider);
    }
    if (!targetModel && updatedModels.length > 0) {
      targetModel = updatedModels[0];
    }

    if (targetModel) {
      try {
        await request('/session/model', 'PUT', { provider: targetModel.provider, modelId: targetModel.id });
        await request('/settings/defaults', 'PUT', { provider: targetModel.provider, modelId: targetModel.id });
        if (onSelectModel) {
          await onSelectModel(targetModel);
        }
      } catch (err) {
        console.warn('[onboarding] Failed to bind initial model:', err);
      }
    }
  };
  const saveApiKey = () => run(async () => {
    if (!apiKey.trim()) throw new Error('API Key is required');
    await request('/session/command', 'POST', { command: `/login ${provider} ${apiKey.trim()}` });
    await bindModelAfterAuth(provider);
    await request('/memory/settings', 'PUT', { enabled: memoryEnabled }).catch(() => undefined);
    setApiKey('');
    setStep(3);
  });
  const saveOauth = () => run(async () => {
    if (!oauthProvider) throw new Error('No OAuth Providers available');
    await request('/session/command', 'POST', { command: `/login ${oauthProvider}` }, 10 * 60_000);
    await bindModelAfterAuth(oauthProvider);
    await request('/memory/settings', 'PUT', { enabled: memoryEnabled }).catch(() => undefined);
    setStep(3);
  });
  const discoverModels = () => run(async () => {
    const results = await desktop?.providerConfig?.discoverModels?.({ baseUrl, apiKey });
    if (!Array.isArray(results) || results.length === 0) throw new Error('No models were returned. Enter model IDs manually.');
    setDiscoveredModels(results);
    setModelIds(results.map((model) => model.id).join(', '));
  });
  const saveCustomProvider = () => run(async () => {
    if (!customName.trim()) throw new Error('Provider name is required');
    if (!baseUrl.trim()) throw new Error('Base URL must be a valid http or https URL');
    const ids = modelIds.split(',').map((item) => item.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error('No models were returned. Enter model IDs manually.');
    const saved = await desktop?.providerConfig?.saveCustom?.({ name: customName.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, modelIds: ids, discoveredModels });
    if (!saved?.provider) throw new Error('Creation failed');
    await request('/session/command', 'POST', { command: '/reload' });
    if (apiKey.trim()) await request('/session/command', 'POST', { command: `/login ${saved.provider} ${apiKey.trim()}` });
    await bindModelAfterAuth(saved.provider);
    await request('/memory/settings', 'PUT', { enabled: memoryEnabled }).catch(() => undefined);
    setApiKey('');
    setStep(3);
  });
  const selectParent = () => run(async () => {
    const selected = await desktop?.workspace?.selectParent?.();
    if (selected) setParentPath(selected);
  });
  const createProject = () => run(async () => {
    const workspace = await desktop?.workspace?.create?.({ parentPath, name: projectName });
    if (!workspace?.path) throw new Error('Creation failed');
    setSelectedProject(workspace);
    await onProjectReady(workspace);
  });
  const importProject = () => run(async () => {
    const workspace = await desktop?.workspace?.select?.();
    if (!workspace?.path) return;
    setSelectedProject(workspace);
    await onProjectReady(workspace);
  });

  const handleContinue = () => {
    if (step === 2) {
      if (method === 'api' && apiKey.trim()) {
        void saveApiKey();
        return;
      }
      if (method === 'oauth' && oauthProvider) {
        void saveOauth();
        return;
      }
      if (method === 'custom' && customName.trim() && baseUrl.trim()) {
        void saveCustomProvider();
        return;
      }
      if (models.length > 0) {
        void request('/memory/settings', 'PUT', { enabled: memoryEnabled }).catch(() => undefined);
        setStep(3);
        return;
      }
      if (method === 'api' && !apiKey.trim()) {
        setFeedback('API Key is required');
        return;
      }
    }
    setStep((current) => current + 1);
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-y-auto bg-[#f8fafc] p-6 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {/* Step 0: Welcome Home Page */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center text-center max-w-lg mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-300 motion-reduce:animate-none">
          <div className="mb-5 flex items-center justify-center p-2">
            <MetisBrandLogo />
          </div>

          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl">
            Welcome to Metis
          </h1>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Get Started</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Language Selection - Fullscreen Centered */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center text-center max-w-xl w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl">
            Choose your language
          </h1>

          <div className="mt-8 w-full grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {languages.map((item) => {
              const isSelected = language === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => void saveLanguage(item)}
                  aria-pressed={isSelected}
                  className={`flex h-10 items-center justify-between rounded-[10px] border px-3.5 text-left text-[13.5px] font-medium transition-[background-color,border-color,color,transform,box-shadow] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
                  }`}
                >
                  <span>{languageName(item)}</span>
                  {isSelected && <Check size={14} className="stroke-[2.5]" />}
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex items-center justify-center gap-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(0)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Home</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(2)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Next</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Credentials & Memory - Fullscreen Centered */}
      {step === 2 && (
        <div className="flex flex-col items-center justify-center max-w-xl w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl text-center">
            Configure AI credentials
          </h1>

          <div className="mt-8 w-full space-y-4">
            {/* Credentials Card: Inner controls R=10px, padding=16px -> Outer R = 10 + 16 = 26px */}
            <div className="space-y-4 rounded-[26px] border border-slate-200/90 bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
              {/* Tablist: Inner tabs R=8px, padding=4px (p-1) -> Outer R = 8 + 4 = 12px */}
              <div
                role="tablist"
                aria-label="Configure API / OAuth / Base URL"
                className="inline-flex w-full gap-1 rounded-[12px] border border-slate-200/60 bg-slate-100/90 p-1"
              >
                {(['api', 'oauth', 'custom'] as ProviderMethod[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={method === item}
                    onClick={() => setMethod(item)}
                    className={`min-h-8 flex-1 rounded-[8px] text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                      method === item
                        ? 'bg-white font-semibold text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {item === 'api' ? 'API Key' : item === 'oauth' ? 'OAuth' : 'Custom Base URL'}
                  </button>
                ))}
              </div>

              <div className="space-y-3 pt-1">
                {method === 'api' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">{providerLabel}</label>
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value)}
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      >
                        {providerChoices.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">API Key</label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        placeholder="Enter an API Key"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                  </>
                )}

                {method === 'oauth' && (
                  <>
                    {oauthProviders.length ? (
                      <div className="space-y-1.5">
                        <label className="text-[12.5px] font-medium text-slate-700">{providerLabel}</label>
                        <select
                          value={oauthProvider}
                          onChange={(event) => setOauthProvider(event.target.value)}
                          className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                        >
                          {oauthProviders.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="rounded-[10px] bg-slate-50 border border-slate-100 p-3 text-[12px] text-slate-500">
                        No OAuth Providers available
                      </p>
                    )}
                  </>
                )}

                {method === 'custom' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">Provider name</label>
                      <input
                        value={customName}
                        onChange={(event) => setCustomName(event.target.value)}
                        placeholder="Enter a Provider name"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">Base URL</label>
                      <input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="Enter a Base URL"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">API Key</label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        placeholder="Enter an API Key"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={busy || !baseUrl.trim()}
                        onClick={discoverModels}
                        className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-[8px] border border-slate-200 bg-white text-slate-700 text-[12px] font-medium hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-45"
                      >
                        <Server size={14} />
                        <span>Discover models</span>
                      </button>
                      {discoveredModels.length > 0 && (
                        <span className="text-[11.5px] text-emerald-600 font-medium truncate">
                          {discoveredModels.map((m) => m.id).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">Model</label>
                      <input
                        value={modelIds}
                        onChange={(event) => setModelIds(event.target.value)}
                        placeholder="Enter model IDs manually; separate multiple IDs with commas"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Memory Setting Card: Inner row R=10px, padding=4px (p-1) -> Outer R = 10 + 4 = 14px */}
            <div className="space-y-0.5 rounded-[14px] border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
              <div className="flex min-h-[48px] items-center justify-between gap-4 rounded-[10px] px-3.5 py-2 transition-colors hover:bg-slate-50/80">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-slate-800">AI Long-term Memory</p>
                  <p className="mt-0.5 text-pretty text-[12px] leading-[18px] text-slate-500">
                    Automatically consolidates work experience and historical context to retrieve in future conversations.
                  </p>
                </div>
                <div className="shrink-0">
                  <Switch
                    label="AI Long-term Memory"
                    checked={memoryEnabled}
                    onChange={toggleMemory}
                    disabled={busy || !isConnected}
                  />
                </div>
              </div>
            </div>
          </div>

          {feedback && (
            <p role="status" className="w-full mt-4 rounded-[10px] bg-rose-50 border border-rose-200/80 px-3.5 py-2.5 text-[12.5px] leading-5 text-rose-700 text-center">
              {translateExact(feedback, language)}
            </p>
          )}

          <div className="mt-8 flex items-center justify-center gap-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(1)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Previous</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleContinue}
              className={ONBOARDING_BTN_CLASS}
            >
              {busy ? <LoaderCircle size={14} className="animate-spin mr-1.5 inline" /> : null}
              <span>Next</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Workspace - Fullscreen Centered */}
      {step === 3 && (
        <div className="flex flex-col items-center justify-center max-w-xl w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl text-center">
            Select a project workspace
          </h1>

          <div className="mt-8 w-full space-y-4">
            {/* Workspace Card: Inner controls R=10px, padding=16px -> Outer R = 10 + 16 = 26px */}
            <div className="space-y-4 rounded-[26px] border border-slate-200/90 bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
              {/* Tablist: Inner tabs R=8px, padding=4px (p-1) -> Outer R = 8 + 4 = 12px */}
              <div
                role="tablist"
                aria-label="Add a project workspace"
                className="inline-flex w-full gap-1 rounded-[12px] border border-slate-200/60 bg-slate-100/90 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={projectMode === 'create'}
                  onClick={() => setProjectMode('create')}
                  className={`min-h-8 flex-1 rounded-[8px] text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                    projectMode === 'create'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Plus size={14} className="mr-1.5 inline" />New Project
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={projectMode === 'import'}
                  onClick={() => setProjectMode('import')}
                  className={`min-h-8 flex-1 rounded-[8px] text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                    projectMode === 'import'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FolderOpen size={14} className="mr-1.5 inline" />Open Existing Project
                </button>
              </div>

              <div className="space-y-3 pt-1">
                {projectMode === 'create' ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">Project name</label>
                      <input
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        placeholder="my-awesome-project"
                        className="h-9 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-slate-700">Save location</label>
                      <button
                        type="button"
                        onClick={selectParent}
                        disabled={busy}
                        className="flex h-9 w-full items-center justify-between rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <span className="truncate">{parentPath || 'Select folder'}</span>
                        <FolderOpen size={15} className="shrink-0 text-slate-400" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={createProject}
                      disabled={busy || !parentPath || !projectName.trim()}
                      className="group inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 active:scale-[0.98] disabled:opacity-45"
                    >
                      <Plus size={14} />
                      <span>Create & Enter Workspace</span>
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12.5px] text-slate-500">
                      Select a local project folder, Metis will provide project-wide Agent collaboration.
                    </p>
                    <button
                      type="button"
                      onClick={importProject}
                      disabled={busy}
                      className="group inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 active:scale-[0.98] disabled:opacity-45"
                    >
                      <FolderOpen size={15} />
                      <span>Choose Project Folder</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {selectedProject?.path && (
              <div className="flex items-center gap-2 rounded-[10px] border border-emerald-200/80 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-medium text-emerald-800 animate-in fade-in">
                <Check size={15} className="shrink-0 text-emerald-600" />
                <span className="truncate">{selectedProject.path}</span>
              </div>
            )}
          </div>

          {feedback && (
            <p role="status" className="w-full mt-4 rounded-[10px] bg-rose-50 border border-rose-200/80 px-3.5 py-2.5 text-[12.5px] leading-5 text-rose-700 text-center">
              {translateExact(feedback, language)}
            </p>
          )}

          <div className="mt-8 flex items-center justify-center gap-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(2)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Previous</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={complete}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Finish & Start Coding</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

