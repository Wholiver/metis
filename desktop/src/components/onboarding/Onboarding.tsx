import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Plus, Server } from 'lucide-react';
import type { ModelOption } from '../../types';
import { translateExact } from '../../i18n';
import { MetisCloudMark } from '../chat/MetisCloudMark';
import './Onboarding.css';

const COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v3';
const LEGACY_COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v2';
const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'gemini', 'openrouter', 'orcarouter', 'groq', 'ollama'];
const providerLabel = 'Configure API / OAuth / Base URL';

// Inner interactive button radius = 10px (matching Settings sidebar tab)
const ONBOARDING_BTN_CLASS =
  'group inline-flex h-9 min-w-[110px] items-center justify-center rounded-[10px] border border-line bg-surface px-4 text-[13.5px] font-medium text-ink-2 shadow-hairline transition-all duration-200 hover:border-line-strong hover:bg-hover hover:text-ink active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed';

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
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-hover-2 shadow-btn ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
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
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-y-auto bg-page p-6 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {/* Step 0: Welcome Home Page */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center text-center max-w-lg mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-300 motion-reduce:animate-none">
          <div className="mb-5 flex items-center justify-center p-2" data-onboarding-home-cloud="">
            <MetisCloudMark size={160} />
          </div>

          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl">
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
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl">
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
                  className={`flex h-10 items-center justify-between rounded-[10px] border px-3.5 text-left text-[13.5px] font-medium transition-[background-color,border-color,color,transform,box-shadow] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                    isSelected
                      ? 'border-ink bg-ink dark:border-accent dark:bg-accent text-white shadow-btn'
                      : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-hover dark:hover:bg-hover shadow-hairline'
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
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl text-center">
            Configure AI credentials
          </h1>

          <div className="mt-8 w-full space-y-4">
            {/* Credentials Card: Inner controls R=10px, padding=16px -> Outer R = 10 + 16 = 26px */}
            <div className="space-y-4 rounded-[26px] border border-line bg-surface p-4 shadow-card">
              {/* Tablist: Inner tabs R=8px, padding=4px (p-1) -> Outer R = 8 + 4 = 12px */}
              <div
                role="tablist"
                aria-label="Configure API / OAuth / Base URL"
                className="inline-flex w-full gap-1 rounded-[12px] border border-line bg-inset p-1"
              >
                {(['api', 'oauth', 'custom'] as ProviderMethod[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={method === item}
                    onClick={() => setMethod(item)}
                    className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                      method === item
                        ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                        : 'text-ink-3 hover:text-ink'
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
                      <label className="text-[12.5px] font-medium text-ink-2">{providerLabel}</label>
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value)}
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      >
                        {providerChoices.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">API Key</label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        placeholder="Enter an API Key"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                  </>
                )}

                {method === 'oauth' && (
                  <>
                    {oauthProviders.length ? (
                      <div className="space-y-1.5">
                        <label className="text-[12.5px] font-medium text-ink-2">{providerLabel}</label>
                        <select
                          value={oauthProvider}
                          onChange={(event) => setOauthProvider(event.target.value)}
                          className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                        >
                          {oauthProviders.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="rounded-[10px] bg-inset border border-line p-3 text-[12px] text-ink-3">
                        No OAuth Providers available
                      </p>
                    )}
                  </>
                )}

                {method === 'custom' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">Provider name</label>
                      <input
                        value={customName}
                        onChange={(event) => setCustomName(event.target.value)}
                        placeholder="Enter a Provider name"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">Base URL</label>
                      <input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="Enter a Base URL"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">API Key</label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        placeholder="Enter an API Key"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={busy || !baseUrl.trim()}
                        onClick={discoverModels}
                        className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-control border border-line bg-surface text-ink-2 text-[12px] font-medium hover:bg-hover active:scale-[0.98] transition-all disabled:opacity-45"
                      >
                        <Server size={14} />
                        <span>Discover models</span>
                      </button>
                      {discoveredModels.length > 0 && (
                        <span className="text-[11.5px] text-green font-medium truncate">
                          {discoveredModels.map((m) => m.id).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">Model</label>
                      <input
                        value={modelIds}
                        onChange={(event) => setModelIds(event.target.value)}
                        placeholder="Enter model IDs manually; separate multiple IDs with commas"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Memory Setting Card: Inner row R=10px, padding=4px (p-1) -> Outer R = 10 + 4 = 14px */}
            <div className="space-y-0.5 rounded-[14px] border border-line bg-surface p-1 shadow-hairline">
              <div className="flex min-h-[48px] items-center justify-between gap-4 rounded-[10px] px-3.5 py-2 transition-colors hover:bg-hover">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-ink">AI Long-term Memory</p>
                  <p className="mt-0.5 text-pretty text-[12px] leading-[18px] text-ink-3">
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
            <p role="status" className="w-full mt-4 rounded-[10px] bg-red-tint border border-red/30 px-3.5 py-2.5 text-[12.5px] leading-5 text-red text-center">
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
          <h1 id="onboarding-title" className="text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl text-center">
            Select a project workspace
          </h1>

          <div className="mt-8 w-full space-y-4">
            {/* Workspace Card: Inner controls R=10px, padding=16px -> Outer R = 10 + 16 = 26px */}
            <div className="space-y-4 rounded-[26px] border border-line bg-surface p-4 shadow-card">
              {/* Tablist: Inner tabs R=8px, padding=4px (p-1) -> Outer R = 8 + 4 = 12px */}
              <div
                role="tablist"
                aria-label="Add a project workspace"
                className="inline-flex w-full gap-1 rounded-[12px] border border-line bg-inset p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={projectMode === 'create'}
                  onClick={() => setProjectMode('create')}
                  className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                    projectMode === 'create'
                      ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <Plus size={14} className="mr-1.5 inline" />New Project
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={projectMode === 'import'}
                  onClick={() => setProjectMode('import')}
                  className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                    projectMode === 'import'
                      ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <FolderOpen size={14} className="mr-1.5 inline" />Open Existing Project
                </button>
              </div>

              <div className="space-y-3 pt-1">
                {projectMode === 'create' ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">Project name</label>
                      <input
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        placeholder="my-awesome-project"
                        className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12.5px] font-medium text-ink-2">Save location</label>
                      <button
                        type="button"
                        onClick={selectParent}
                        disabled={busy}
                        className="flex h-9 w-full items-center justify-between rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink-2 transition-colors hover:bg-hover"
                      >
                        <span className="truncate">{parentPath || 'Select folder'}</span>
                        <FolderOpen size={15} className="shrink-0 text-ink-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={createProject}
                      disabled={busy || !parentPath || !projectName.trim()}
                      className="group inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[14px] font-medium text-ink-2 shadow-hairline transition-all hover:bg-hover hover:border-line-strong hover:text-ink active:scale-[0.98] disabled:opacity-45"
                    >
                      <Plus size={14} />
                      <span>Create & Enter Workspace</span>
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12.5px] text-ink-3">
                      Select a local project folder, Metis will provide project-wide Agent collaboration.
                    </p>
                    <button
                      type="button"
                      onClick={importProject}
                      disabled={busy}
                      className="group inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 text-[14px] font-medium text-ink-2 shadow-hairline transition-all hover:bg-hover hover:border-line-strong hover:text-ink active:scale-[0.98] disabled:opacity-45"
                    >
                      <FolderOpen size={15} />
                      <span>Choose Project Folder</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {selectedProject?.path && (
              <div className="flex items-center gap-2 rounded-card bg-green-tint px-3.5 py-2.5 text-[12.5px] font-medium text-green shadow-hairline animate-in fade-in">
                <Check size={15} className="shrink-0 text-green" />
                <span className="truncate">{selectedProject.path}</span>
              </div>
            )}
          </div>

          {feedback && (
            <p role="status" className="w-full mt-4 rounded-[10px] bg-red-tint border border-red/30 px-3.5 py-2.5 text-[12.5px] leading-5 text-red text-center">
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
