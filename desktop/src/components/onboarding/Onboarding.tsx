import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderOpen, KeyRound, LoaderCircle, Plus, Server } from 'lucide-react';
import type { ModelOption, ProjectItem } from '../../types';
import './Onboarding.css';

const COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v3';
const LEGACY_COMPLETED_KEY = 'metis.desktopOnboardingCompleted.v2';
const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'gemini', 'openrouter', 'groq', 'ollama'];
const providerLabel = 'Configure API / OAuth / Base URL';

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
};

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

export function shouldShowOnboarding(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return !storage.getItem(COMPLETED_KEY) && !storage.getItem(LEGACY_COMPLETED_KEY);
}

export function Onboarding({ open, request, isConnected, models, onComplete, onProjectReady }: OnboardingProps) {
  const desktop = (window as any).metisDesktop;
  const [step, setStep] = useState(1);
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
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
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

  useEffect(() => {
    if (!open) return;
    setFeedback('');
    setStep(1);
    void desktop?.appInfo?.().then((info: { language?: string; languages?: string[] }) => {
      setLanguage(typeof info?.language === 'string' ? info.language : 'auto');
      if (Array.isArray(info?.languages)) setLanguages(['auto', ...info.languages.filter((item) => item !== 'auto')]);
    }).catch(() => undefined);
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
  const saveApiKey = () => run(async () => {
    if (!apiKey.trim()) throw new Error('API Key is required');
    await request('/session/command', 'POST', { command: `/login ${provider} ${apiKey.trim()}` });
    setApiKey('');
    setStep(3);
  });
  const saveOauth = () => run(async () => {
    if (!oauthProvider) throw new Error('No OAuth Providers available');
    await request('/session/command', 'POST', { command: `/login ${oauthProvider}` }, 10 * 60_000);
    setStep(3);
  });
  const discoverModels = () => run(async () => {
    const results = await desktop?.providerConfig?.discoverModels?.({ baseUrl, apiKey });
    if (!Array.isArray(results) || results.length === 0) throw new Error('No models were returned. Enter model IDs manually.');
    setDiscoveredModels(results);
    setModelIds(results.join(', '));
  });
  const saveCustomProvider = () => run(async () => {
    if (!customName.trim()) throw new Error('Provider name is required');
    if (!baseUrl.trim()) throw new Error('Base URL must be a valid http or https URL');
    const ids = modelIds.split(',').map((item) => item.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error('No models were returned. Enter model IDs manually.');
    const saved = await desktop?.providerConfig?.saveCustom?.({ name: customName.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, modelIds: ids });
    if (!saved?.provider) throw new Error('Creation failed');
    await request('/session/command', 'POST', { command: '/reload' });
    if (apiKey.trim()) await request('/session/command', 'POST', { command: `/login ${saved.provider} ${apiKey.trim()}` });
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

  const providerPanel = method === 'api' ? <>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">{providerLabel}
      <select value={provider} onChange={(event) => setProvider(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60">
        {providerChoices.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">API Key
      <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Enter an API Key" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" />
    </label>
    <button type="button" disabled={busy || !isConnected} onClick={saveApiKey} className="onboarding-primary"><KeyRound size={16} />Save & Continue</button>
  </> : method === 'oauth' ? <>
    {oauthProviders.length ? <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">{providerLabel}
      <select value={oauthProvider} onChange={(event) => setOauthProvider(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60">
        {oauthProviders.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label> : <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500">No OAuth Providers available</p>}
    <button type="button" disabled={busy || !isConnected || !oauthProvider} onClick={saveOauth} className="onboarding-primary"><KeyRound size={16} />Save & Continue</button>
  </> : <>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">Name
      <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Enter a Provider name" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" />
    </label>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">Custom Base URL
      <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Enter a Base URL" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" />
    </label>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">API Key
      <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Enter an API Key" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" />
    </label>
    <div className="flex gap-2"><button type="button" disabled={busy || !baseUrl.trim()} onClick={discoverModels} className="onboarding-secondary">Discover models</button><span className="self-center text-[11px] text-slate-500">{discoveredModels.length ? discoveredModels.join(', ') : ''}</span></div>
    <label className="grid gap-1.5 text-[12px] font-medium text-slate-700">Model
      <input value={modelIds} onChange={(event) => setModelIds(event.target.value)} placeholder="Enter model IDs manually; separate multiple IDs with commas" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" />
    </label>
    <button type="button" disabled={busy || !isConnected} onClick={saveCustomProvider} className="onboarding-primary"><Server size={16} />Save & Continue</button>
  </>;

  return <div className="fixed inset-0 z-[300] grid overflow-y-auto bg-slate-950/35 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <main className="m-auto w-full max-w-3xl overflow-hidden rounded-xl border border-white/70 bg-white shadow-[0_28px_90px_rgb(15_23_42_/_0.25)]">
      <section className="px-6 py-8 sm:px-12 sm:py-11">
        {step === 1 && <div className="mx-auto max-w-xl animate-in fade-in duration-300 motion-reduce:animate-none"><p className="text-sm font-medium text-slate-500">Welcome to Metis</p><h1 id="onboarding-title" className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] text-slate-950">Choose your language</h1><p className="mt-3 max-w-lg text-pretty text-sm leading-6 text-slate-500">Select your preferred display language for Metis Desktop</p><div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">{languages.map((item) => <button key={item} type="button" onClick={() => void saveLanguage(item)} aria-pressed={language === item} className={`min-h-12 rounded-xl border px-3 text-left text-sm font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 motion-reduce:transition-none ${language === item ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>{languageName(item)}</button>)}</div></div>}
        {step === 2 && <div className="mx-auto max-w-xl animate-in fade-in duration-300 motion-reduce:animate-none"><p className="text-sm font-medium text-slate-500">Configure AI credentials</p><h1 id="onboarding-title" className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] text-slate-950">Configure API / OAuth / Base URL</h1><p className="mt-3 text-pretty text-sm leading-6 text-slate-500">Provider login supports API Key, OAuth, or a custom Base URL. Save any one option to enable Metis.</p><div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50/70 p-2"><div role="tablist" aria-label="Configure API / OAuth / Base URL" className="grid grid-cols-3 gap-1">{(['api', 'oauth', 'custom'] as ProviderMethod[]).map((item) => <button key={item} type="button" role="tab" aria-selected={method === item} onClick={() => setMethod(item)} className={`min-h-10 rounded-xl px-2 text-[12px] font-semibold transition-[background-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${method === item ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{item === 'api' ? 'API Key' : item === 'oauth' ? 'OAuth' : 'Custom Base URL'}</button>)}</div><div className="grid gap-3 p-3 pt-5">{providerPanel}</div></div></div>}
        {step === 3 && <div className="mx-auto max-w-xl animate-in fade-in duration-300 motion-reduce:animate-none"><p className="text-sm font-medium text-slate-500">Add a project workspace</p><h1 id="onboarding-title" className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] text-slate-950">Add a project workspace</h1><p className="mt-3 text-pretty text-sm leading-6 text-slate-500">Choose or create a local repository folder. Metis will provide project-wide Agent collaboration.</p><div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50/70 p-2"><div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Add a project workspace"><button type="button" role="tab" aria-selected={projectMode === 'create'} onClick={() => setProjectMode('create')} className={`min-h-10 rounded-xl text-[12px] font-semibold transition-[background-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${projectMode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><Plus size={14} className="mr-1 inline" />Add project</button><button type="button" role="tab" aria-selected={projectMode === 'import'} onClick={() => setProjectMode('import')} className={`min-h-10 rounded-xl text-[12px] font-semibold transition-[background-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${projectMode === 'import' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><FolderOpen size={14} className="mr-1 inline" />Open</button></div><div className="grid gap-3 p-3 pt-5">{projectMode === 'create' ? <><label className="grid gap-1.5 text-[12px] font-medium text-slate-700">Name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60" /></label><button type="button" onClick={selectParent} disabled={busy} className="onboarding-secondary justify-start"><FolderOpen size={16} />{parentPath || 'Select folder'}</button><button type="button" onClick={createProject} disabled={busy || !parentPath || !projectName.trim()} className="onboarding-primary"><Plus size={16} />Save & Continue</button></> : <><p className="text-[12px] leading-5 text-slate-500">Choose Project Folder</p><button type="button" onClick={importProject} disabled={busy} className="onboarding-primary"><FolderOpen size={16} />Choose Project Folder</button></>}</div></div>{selectedProject?.path && <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800"><Check size={15} />{selectedProject.path}</div>}</div>}
        {feedback && <p role="status" className="mx-auto mt-5 max-w-xl rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] leading-5 text-rose-700">{feedback}</p>}
      </section>
      <footer className="flex flex-wrap items-center justify-end gap-2 px-6 pb-7 pt-2 sm:px-12 sm:pb-9"><button type="button" disabled={busy || step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))} className="onboarding-secondary"><ArrowLeft size={16} />Back</button>{step < 3 ? <button type="button" disabled={busy} onClick={() => setStep((current) => current + 1)} className="onboarding-primary">Continue<ArrowRight size={16} /></button> : <button type="button" disabled={busy} onClick={complete} className="onboarding-primary">Finish<Check size={16} /></button>}</footer>
    </main>
  </div>;
}
