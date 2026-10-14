import React, { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Plus, Server } from 'lucide-react';
import type { ModelOption } from '../../types';
import type { WorkProgressExpression } from '../../lib/work-progress';
import { translateExact } from '../../i18n';
import { MetisCloudMark } from '../chat/MetisCloudMark';
import { SelfLearningBadge } from '../atoms/SelfLearningBadge';
import './Onboarding.css';

const COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v3';
const LEGACY_COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v2';
const FALLBACK_PROVIDERS = ['siliconflow-cn', 'openai', 'anthropic', 'deepseek', 'siliconflow', 'gemini', 'openrouter', 'orcarouter', 'groq', 'ollama'];
const providerLabel = 'Configure API / OAuth / Base URL';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'siliconflow-cn': 'SiliconFlow 硅基流动 (国内推荐)',
  'siliconflow': 'SiliconFlow (Global)',
  'openai': 'OpenAI (GPT-4o, o3-mini)',
  'anthropic': 'Anthropic (Claude 3.7 Sonnet)',
  'deepseek': 'DeepSeek (V3, R1)',
  'gemini': 'Google Gemini (Flash, Pro)',
  'openrouter': 'OpenRouter',
  'orcarouter': 'OrcaRouter',
  'groq': 'Groq (Ultra-fast)',
  'ollama': 'Ollama (Local 本地模型)',
};

function formatProviderName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id] || id;
}

const EASTER_EGGS = [
  'onboardingCloudEasterEgg1',
  'onboardingCloudEasterEgg2',
];

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
  onComplete: (sourceRect?: DOMRect | null) => void;
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
    const raw = new Intl.DisplayNames([code], { type: 'language' }).of(code) || code;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
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
  const [projectMode, setProjectMode] = useState<'create' | 'import'>('create');
  const [parentPath, setParentPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [selectedProject, setSelectedProject] = useState<Workspace>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selfLearningEnabled, setSelfLearningEnabled] = useState(false);
  const [easterEggIndex, setEasterEggIndex] = useState<number | null>(null);
  const [cloudBounce, setCloudBounce] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    setEasterEggIndex(null);
  }, [step]);

  const handleCloudEasterEgg = () => {
    setCloudBounce(true);
    setTimeout(() => setCloudBounce(false), 500);
    setEasterEggIndex((prev) => {
      if (prev === null) return 0;
      return (prev + 1) % EASTER_EGGS.length;
    });
  };

  const getStepExpression = (s: number): WorkProgressExpression => {
    if (easterEggIndex !== null) return 'excited';
    if (s === 0) return 'happy';
    if (s === 1) return 'curious';
    if (s === 2) return 'attentive';
    if (s === 3) return selectedProject?.path ? 'proud' : 'excited';
    return 'neutral';
  };

  const getStepBubbleText = (s: number): string => {
    if (easterEggIndex !== null) {
      return translateExact(EASTER_EGGS[easterEggIndex], language);
    }
    if (s === 0) return translateExact('onboardingCloudBubbleWelcome', language);
    if (s === 1) return translateExact('onboardingCloudBubbleLang', language);
    if (s === 2) return translateExact('onboardingCloudBubbleCredentials', language);
    if (s === 3) return translateExact('onboardingCloudBubbleWorkspace', language);
    return '';
  };

  useEffect(() => {
    if (!open || !isConnected) return;
    void request<{ enabled?: boolean }>('/self-learning')
      .then((data) => {
        if (data && typeof data.enabled === 'boolean') {
          setSelfLearningEnabled(data.enabled);
        }
      })
      .catch(() => null);
  }, [open, isConnected, request]);

  const toggleSelfLearning = (next: boolean) => run(async () => {
    await request('/self-learning', 'PUT', { enabled: next });
    setSelfLearningEnabled(next);
  });

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

    return () => { current = false; };
  }, [isConnected, open, request]);

  if (!open) return null;

  const complete = async () => {
    if (!selectedProject?.path) {
      if (projectMode === 'create' && parentPath.trim()) {
        try {
          if (projectName.trim()) {
            const workspace = await desktop?.workspace?.create?.({ parentPath, name: projectName.trim() });
            if (workspace?.path) {
              setSelectedProject(workspace);
              await onProjectReady(workspace);
            }
          } else {
            const name = parentPath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
            const workspace = { path: parentPath, name };
            await desktop?.workspace?.set?.(parentPath);
            setSelectedProject(workspace);
            await onProjectReady(workspace);
          }
        } catch (err) {
          console.warn('[onboarding] Failed to create/set project on complete:', err);
        }
      }
    }
    const cloudEl = document.querySelector('[data-onboarding-cloud]');
    const rect = cloudEl ? cloudEl.getBoundingClientRect() : null;
    setIsClearing(true);
    setTimeout(() => {
      localStorage.setItem(COMPLETED_KEY, 'true');
      onComplete(rect);
      setIsClearing(false);
    }, 360);
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
    setApiKey('');
    setStep(3);
  });
  const saveOauth = () => run(async () => {
    if (!oauthProvider) throw new Error('No OAuth Providers available');
    await request('/session/command', 'POST', { command: `/login ${oauthProvider}` }, 10 * 60_000);
    await bindModelAfterAuth(oauthProvider);
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
      {/* Stepper Header for Steps 1, 2, 3 */}
      {step > 0 && (
        <div className={`mb-4 flex items-center gap-2 max-w-xl w-full justify-center text-[12px] text-ink-3 font-medium select-none transition-all duration-300 ${isClearing ? 'opacity-0 -translate-y-2' : 'animate-in fade-in duration-200'}`}>
          {[
            { s: 1, label: translateExact('onboardingStepLanguage', language) },
            { s: 2, label: translateExact('onboardingStepCredentials', language) },
            { s: 3, label: translateExact('onboardingStepWorkspace', language) },
          ].map((item, idx) => {
            const isCurrent = step === item.s;
            const isDone = step > item.s;
            return (
              <div key={item.s} className="flex items-center gap-2">
                {idx > 0 && (
                  <div className={`h-[1px] w-5 transition-colors ${isDone ? 'bg-accent' : 'bg-line'}`} />
                )}
                <button
                  type="button"
                  onClick={() => setStep(item.s)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-hover-2 text-ink font-semibold shadow-btn'
                      : isDone
                        ? 'text-accent font-medium hover:bg-hover'
                        : 'text-ink-3 hover:text-ink hover:bg-hover'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      isCurrent
                        ? 'bg-ink text-surface dark:bg-accent dark:text-white font-bold'
                        : isDone
                          ? 'bg-accent text-white font-bold'
                          : 'bg-inset text-ink-3'
                    }`}
                  >
                    {isDone ? '✓' : item.s}
                  </span>
                  <span>{item.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Step 0: Welcome Home Page */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center text-center max-w-md w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-300 motion-reduce:animate-none">
          {/* Cloud Mascot - Clean and proportional (matching main interface 56px visual scale) */}
          <div
            className="mb-4 flex shrink-0 select-none items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
            data-onboarding-home-cloud=""
            onClick={handleCloudEasterEgg}
            title={translateExact('Click to interact with Metis', language)}
          >
            <div className={`onboarding-cloud-float ${cloudBounce ? 'animate-bounce' : ''}`}>
              <MetisCloudMark size={160} className="w-[56px] h-[56px]" expression={getStepExpression(0)} />
            </div>
          </div>

          <h1 id="onboarding-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl text-balance">
            {translateExact('onboardingWelcomeTitle', language)}
          </h1>
          <p className="mt-2 max-w-[360px] text-[13.5px] font-normal leading-relaxed text-ink-3 text-pretty">
            {getStepBubbleText(0)}
          </p>

          {/* Quick 3-Step Setup Preview (Flat, unboxed list directly on canvas matching RoutinesManager Fig 2) */}
          <div className="mt-8 w-full max-w-[400px] text-left">
            <div className="mb-2 px-3 text-[12px] font-medium text-ink-3">
              {translateExact('onboardingSetupPreviewTitle', language)}
            </div>
            <div className="flex flex-col space-y-1">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="group flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-hover active:scale-[0.99] cursor-pointer"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-inset text-[12px] font-semibold text-ink-2 group-hover:text-ink">
                  1
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {translateExact('onboardingStepLanguage', language)}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                    {translateExact('onboardingSetupStep1Desc', language)}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="group flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-hover active:scale-[0.99] cursor-pointer"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-inset text-[12px] font-semibold text-ink-2 group-hover:text-ink">
                  2
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {translateExact('onboardingStepCredentials', language)}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                    {translateExact('onboardingSetupStep2Desc', language)}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="group flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-hover active:scale-[0.99] cursor-pointer"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-inset text-[12px] font-semibold text-ink-2 group-hover:text-ink">
                  3
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {translateExact('onboardingStepWorkspace', language)}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                    {translateExact('onboardingSetupStep3Desc', language)}
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* Action buttons directly on canvas (matching Fig 2 & Fig 4) */}
          <div className="mt-8 flex flex-col items-center gap-3 w-full max-w-[400px]">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex h-9 min-w-[160px] px-8 items-center justify-center rounded-[10px] bg-ink text-surface dark:bg-accent dark:text-white font-medium text-[13.5px] shadow-btn hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Get Started</span>
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <span>{translateExact('onboardingSkipToWorkspace', language)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Language Selection - Fullscreen Centered */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center text-center max-w-lg w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          {/* Guiding Companion Mascot */}
          <div
            className="mb-3.5 flex shrink-0 select-none items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
            onClick={handleCloudEasterEgg}
            title={translateExact('Click to interact with Metis', language)}
          >
            <div className={`onboarding-cloud-float ${cloudBounce ? 'animate-bounce' : ''}`}>
              <MetisCloudMark size={52} expression={getStepExpression(1)} />
            </div>
          </div>

          <h1 id="onboarding-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl text-balance">
            {translateExact('onboardingLanguageTitle', language)}
          </h1>
          <p className="mt-1.5 max-w-[380px] text-[13.5px] font-normal leading-relaxed text-ink-3 text-pretty">
            {getStepBubbleText(1)}
          </p>

          <div className="mt-7 w-full grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {languages.map((item) => {
              const isSelected = language === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => void saveLanguage(item)}
                  aria-pressed={isSelected}
                  className={`flex h-10 items-center justify-between rounded-[10px] border px-3.5 text-left text-[13px] transition-[background-color,border-color,color,transform,box-shadow] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] cursor-pointer ${
                    isSelected
                      ? 'border-line-strong bg-hover-2 font-semibold text-ink shadow-btn'
                      : 'border-line bg-surface/70 font-normal text-ink-2 hover:border-line-strong hover:bg-hover hover:text-ink shadow-hairline'
                  }`}
                >
                  <span className="truncate">{languageName(item)}</span>
                  {isSelected ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink text-surface dark:bg-accent dark:text-white">
                      <Check size={10} className="stroke-[3]" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-9 flex items-center justify-center gap-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(0)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Back</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(2)}
              className={`${ONBOARDING_BTN_CLASS} !bg-ink !text-surface dark:!bg-accent dark:!text-white hover:opacity-95 shadow-btn`}
            >
              <span>Next</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Credentials & Memory - Fullscreen Centered (Unboxed canvas layout matching Step 0) */}
      {step === 2 && (
        <div className="flex flex-col items-center justify-center max-w-md w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          {/* Guiding Companion Mascot */}
          <div
            className="mb-3.5 flex shrink-0 select-none items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
            onClick={handleCloudEasterEgg}
            title={translateExact('Click to interact with Metis', language)}
          >
            <div className={`onboarding-cloud-float ${cloudBounce ? 'animate-bounce' : ''}`}>
              <MetisCloudMark size={52} expression={getStepExpression(2)} />
            </div>
          </div>

          <h1 id="onboarding-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl text-balance text-center">
            {translateExact('onboardingCredentialsTitle', language)}
          </h1>
          <p className="mt-1.5 max-w-[380px] text-[13.5px] font-normal leading-relaxed text-ink-3 text-pretty text-center">
            {getStepBubbleText(2)}
          </p>

          <div className="mt-7 w-full space-y-4">
            {/* Tablist directly on canvas */}
            <div
              role="tablist"
              aria-label={providerLabel}
              className="inline-flex w-full gap-1 rounded-[10px] border border-line bg-inset p-1 shadow-hairline"
            >
              {(['api', 'oauth', 'custom'] as ProviderMethod[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={method === item}
                  onClick={() => setMethod(item)}
                  className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] cursor-pointer ${
                    method === item
                      ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {item === 'api'
                    ? (translateExact('onboardingProviderTabApiKey', language) || 'API Key')
                    : item === 'oauth'
                      ? (translateExact('onboardingProviderTabOAuth', language) || 'OAuth')
                      : (translateExact('onboardingProviderTabCustom', language) || 'Custom Base URL')}
                </button>
              ))}
            </div>

            {/* Input controls directly on canvas */}
            <div className="space-y-3.5 pt-0.5">
              {method === 'api' && (
                <>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">
                      {translateExact('provider', language) || 'Provider'}
                    </label>
                    <select
                      value={provider}
                      onChange={(event) => setProvider(event.target.value)}
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] cursor-pointer shadow-hairline"
                    >
                      {providerChoices.map((item) => (
                        <option key={item} value={item}>{formatProviderName(item)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      autoComplete="off"
                      placeholder={translateExact('inputApiKeyPlaceholder', language) || 'Enter an API Key'}
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                </>
              )}

              {method === 'oauth' && (
                <>
                  {oauthProviders.length ? (
                    <div className="space-y-1.5 text-left">
                      <label className="text-[12.5px] font-medium text-ink-2">
                        {translateExact('provider', language) || 'Provider'}
                      </label>
                      <select
                        value={oauthProvider}
                        onChange={(event) => setOauthProvider(event.target.value)}
                        className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] cursor-pointer shadow-hairline"
                      >
                        {oauthProviders.map((item) => (
                          <option key={item} value={item}>{formatProviderName(item)}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="rounded-[10px] bg-inset border border-line p-3 text-[12px] text-ink-3 text-center">
                      {translateExact('noOAuthProvidersAvailable', language) || 'No OAuth Providers available'}
                    </p>
                  )}
                </>
              )}

              {method === 'custom' && (
                <>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">
                      {translateExact('customProviderName', language) || 'Provider name'}
                    </label>
                    <input
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder={translateExact('customProviderNamePlaceholder', language) || 'Enter a Provider name'}
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">Base URL</label>
                    <input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      autoComplete="off"
                      placeholder={translateExact('inputApiKeyPlaceholder', language) || 'Enter an API Key'}
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={busy || !baseUrl.trim()}
                      onClick={discoverModels}
                      className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-control border border-line bg-surface text-ink-2 text-[12px] font-medium hover:bg-hover active:scale-[0.98] transition-all disabled:opacity-45 cursor-pointer shadow-hairline"
                    >
                      <Server size={14} />
                      <span>{translateExact('discoverModels', language) || 'Discover models'}</span>
                    </button>
                    {discoveredModels.length > 0 && (
                      <span className="text-[11.5px] text-green font-medium truncate">
                        {discoveredModels.map((m) => m.id).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">
                      {translateExact('modelName', language) || 'Model'}
                    </label>
                    <input
                      value={modelIds}
                      onChange={(event) => setModelIds(event.target.value)}
                      placeholder={translateExact('enterCustomModelId', language) || 'Enter model IDs manually; separate multiple IDs with commas'}
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Self-Learning Setting Row directly on canvas */}
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-surface/60 px-4 py-3 shadow-hairline transition-colors hover:bg-surface">
              <div className="space-y-0.5 pr-4 text-left">
                <span className="text-[13px] font-medium text-ink inline-flex items-center gap-1.5">
                  <span>{translateExact('Self-Learning', language)}</span>
                  <SelfLearningBadge />
                </span>
                <p className="text-[12px] leading-relaxed text-ink-3">
                  {translateExact('Runtime architecture adapts from experience. Disabling reverts to default architecture.', language)}
                </p>
              </div>
              <Switch
                label={translateExact('Self-learning', language)}
                checked={selfLearningEnabled}
                disabled={busy || !isConnected}
                onChange={() => void toggleSelfLearning(!selfLearningEnabled)}
              />
            </div>
          </div>

          {feedback && (
            <p role="status" className="w-full mt-4 rounded-[10px] bg-red-tint border border-red/30 px-3.5 py-2.5 text-[12.5px] leading-5 text-red text-center">
              {translateExact(feedback, language)}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(1)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>Back</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(3)}
              className={ONBOARDING_BTN_CLASS}
            >
              <span>{translateExact('onboardingSkipCredentials', language)}</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleContinue}
              className={`${ONBOARDING_BTN_CLASS} !bg-ink !text-surface dark:!bg-accent dark:!text-white hover:opacity-95 shadow-btn`}
            >
              {busy ? <LoaderCircle size={14} className="animate-spin mr-1.5 inline" /> : null}
              <span>Next</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Workspace - Fullscreen Centered (Unboxed canvas layout matching Step 0) */}
      {step === 3 && (
        <div className="flex flex-col items-center justify-center max-w-md w-full mx-auto py-6 animate-in fade-in zoom-in-[0.98] duration-200 motion-reduce:animate-none">
          {/* Guiding Companion Mascot */}
          <div
            className="mb-3.5 flex shrink-0 select-none items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
            data-onboarding-cloud=""
            onClick={handleCloudEasterEgg}
            title={translateExact('Click to interact with Metis', language)}
          >
            <div className={`onboarding-cloud-float ${cloudBounce ? 'animate-bounce' : ''}`}>
              <MetisCloudMark size={52} expression={getStepExpression(3)} />
            </div>
          </div>

          <div className={`flex flex-col items-center w-full transition-all duration-300 ease-out ${isClearing ? 'opacity-0 scale-95 blur-sm pointer-events-none' : 'opacity-100'}`}>
            <h1 id="onboarding-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl text-balance text-center">
              {translateExact('onboardingWorkspaceTitle', language)}
            </h1>
            <p className="mt-1.5 max-w-[380px] text-[13.5px] font-normal leading-relaxed text-ink-3 text-pretty text-center">
              {getStepBubbleText(3)}
            </p>

          <div className="mt-7 w-full space-y-4">
            {/* Tablist directly on canvas */}
            <div
              role="tablist"
              aria-label={translateExact('onboardingWorkspaceTitle', language) || 'Add a project workspace'}
              className="inline-flex w-full gap-1 rounded-[10px] border border-line bg-inset p-1 shadow-hairline"
            >
              <button
                type="button"
                role="tab"
                aria-selected={projectMode === 'create'}
                onClick={() => setProjectMode('create')}
                className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] cursor-pointer ${
                  projectMode === 'create'
                    ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                <Plus size={14} className="mr-1.5 inline" />
                <span>{translateExact('onboardingNewProject', language) || 'New Project'}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={projectMode === 'import'}
                onClick={() => setProjectMode('import')}
                className={`min-h-8 flex-1 rounded-control text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] cursor-pointer ${
                  projectMode === 'import'
                    ? 'bg-hover-2 font-semibold text-ink shadow-btn'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                <FolderOpen size={14} className="mr-1.5 inline" />
                <span>{translateExact('onboardingOpenExistingProject', language) || 'Open Existing Project'}</span>
              </button>
            </div>

            {/* Input controls directly on canvas */}
            <div className="space-y-3.5 pt-0.5">
              {projectMode === 'create' ? (
                <>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">
                      {translateExact('onboardingProjectName', language) || 'Project name'}
                    </label>
                    <input
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      placeholder="my-awesome-project"
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] shadow-hairline"
                    />
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[12.5px] font-medium text-ink-2">
                      {translateExact('onboardingSaveLocation', language) || 'Save location'}
                    </label>
                    <button
                      type="button"
                      onClick={selectParent}
                      disabled={busy}
                      className="flex h-10 w-full items-center justify-between rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink-2 transition-colors hover:bg-hover cursor-pointer shadow-hairline"
                    >
                      <span className="truncate">{parentPath || (translateExact('selectFolder', language) || 'Select folder')}</span>
                      <FolderOpen size={15} className="shrink-0 text-ink-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={createProject}
                    disabled={busy || !parentPath || !projectName.trim()}
                    className="group inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border border-line bg-hover-2 px-3.5 text-[13.5px] font-medium text-ink shadow-hairline transition-all hover:bg-hover hover:border-line-strong active:scale-[0.98] disabled:opacity-45 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>{translateExact('onboardingCreateWorkspace', language) || 'Create & Enter Workspace'}</span>
                  </button>
                </>
              ) : (
                <div className="space-y-3.5 text-left">
                  <p className="text-[12.5px] text-ink-3 leading-relaxed">
                    {translateExact('onboardingImportWorkspaceDesc', language) || 'Select a local project folder, Metis will provide project-wide Agent collaboration.'}
                  </p>
                  <button
                    type="button"
                    onClick={importProject}
                    disabled={busy}
                    className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-line-strong bg-hover-2 px-4 text-[13.5px] font-medium text-ink shadow-btn transition-all hover:bg-hover hover:border-line-strong active:scale-[0.98] disabled:opacity-45 cursor-pointer"
                  >
                    <FolderOpen size={15} />
                    <span>{translateExact('chooseProjectFolder', language) || 'Choose Project Folder'}</span>
                  </button>
                </div>
              )}
            </div>

            {selectedProject?.path && (
              <div className="flex items-center gap-2.5 rounded-control bg-green-tint border border-green/20 px-3.5 py-2.5 text-[12.5px] font-medium text-green shadow-hairline animate-in fade-in">
                <Check size={14} className="shrink-0 stroke-[2.5]" />
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
              <span>Back</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void complete()}
              className={`${ONBOARDING_BTN_CLASS} !bg-ink !text-surface dark:!bg-accent dark:!text-white hover:opacity-95 shadow-btn`}
            >
              <span>Finish & Start Coding</span>
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
