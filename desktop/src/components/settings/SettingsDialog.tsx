import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronRight,
  CircleHelp,
  CloudCog,
  Download,
  FileArchive,
  FolderCog,
  Gauge,
  KeyRound,
  Keyboard,
  LoaderCircle,
  MemoryStick,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CollaborationMode, MemoryState, ModelOption, ProjectItem, ThinkingOption } from '../../types';
import { RELEASES_URL, type UpdateCheckState } from '../../hooks/useUpdateCheck';
import { translateExact } from '../../i18n';
import { modelLabel } from '../chat/ModelSwitcher';

type Request = <T>(path: string, method?: string, body?: unknown, timeoutMs?: number) => Promise<T>;

export type SettingsTab = 'general' | 'model' | 'agent' | 'server' | 'about';
export type AnySettingsTab = SettingsTab | 'shortcuts' | 'security' | 'session';

type SettingsDialogProps = {
  open: boolean;
  initialTab?: AnySettingsTab;
  memoryState?: MemoryState;
  onClose: () => void;
  request: Request;
  refresh: () => Promise<void>;
  isConnected: boolean;
  isBusy: boolean;
  models: ModelOption[];
  activeModel?: ModelOption;
  thinkingLevel: string;
  thinkingLevels: string[];
  thinkingOptions: ThinkingOption[];
  supportsThinking: boolean;
  collaborationMode: CollaborationMode;
  activeProject?: ProjectItem;
  updateCheck: UpdateCheckState;
  onCheckForUpdates: () => Promise<void> | void;
  onConnectServer: (options: { baseUrl: string; username: string; password?: string }) => Promise<boolean>;
  onChangeWorkspace: () => Promise<boolean>;
  onOpenOnboarding: () => void;
  onSelectModel: (model: ModelOption) => Promise<void>;
  onSelectThinkingLevel: (level: string) => Promise<void>;
  onSelectCollaborationMode: (mode: CollaborationMode) => Promise<boolean>;
  onNewSession: () => Promise<boolean>;
};

type ProviderConfig = {
  providerId?: string;
  provider?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  modelIds?: string[];
  models?: Array<{ id: string; thinkingOptions: ThinkingOption[] }>;
  discoveredModels?: Array<{ id: string; thinkingOptions: ThinkingOption[] }>;
};

type LanguageOption = { code: string; nativeName: string };

const fallbackLanguageOptions: LanguageOption[] = [
  { code: 'auto', nativeName: 'Automatic' },
  { code: 'en', nativeName: 'English' },
  { code: 'zh-CN', nativeName: '简体中文' },
];

function languageOption(code: string): LanguageOption {
  if (code === 'auto') return fallbackLanguageOptions[0];
  try {
    return { code, nativeName: new Intl.DisplayNames([code], { type: 'language' }).of(code) || code };
  } catch {
    return { code, nativeName: code };
  }
}

const tabMap: Record<string, SettingsTab> = {
  general: 'general',
  shortcuts: 'general',
  model: 'model',
  security: 'model',
  agent: 'agent',
  server: 'server',
  session: 'about',
  about: 'about',
};

function normalizeTab(tabId?: string): SettingsTab {
  if (tabId && tabMap[tabId]) return tabMap[tabId];
  return 'general';
}

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'model', label: 'Models & Providers', icon: Bot },
  { id: 'agent', label: 'Agent & Workflow', icon: Sparkles },
  { id: 'server', label: 'Workspace & Server', icon: Server },
  { id: 'about', label: 'Data & About', icon: FileArchive },
];

function Status({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'danger' }) {
  const colors = tone === 'success' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
    : tone === 'danger' ? 'bg-rose-50 text-rose-700 ring-rose-600/15'
      : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${colors}`}>{children}</span>;
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return <header className="mb-4 max-w-2xl"><h2 className="text-balance text-[16px] font-semibold tracking-[-0.01em] text-slate-900 leading-6">{title}</h2>{description && <p className="mt-1 text-pretty text-[12.5px] leading-5 text-slate-500">{description}</p>}</header>;
}

function instructionSourceLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    for (const key of ['path', 'name', 'source', 'type']) {
      if (typeof source[key] === 'string') return source[key] as string;
    }
  }
  return 'Unknown source';
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="space-y-0.5 rounded-[16px] border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.02)]">{children}</section>;
}

function Row({ label, description, children, stacked = false }: { label: string; description: string; children: React.ReactNode; stacked?: boolean }) {
  return <div className={`flex min-h-[48px] gap-4 rounded-[10px] px-3.5 py-2 transition-colors hover:bg-slate-50/80 ${stacked ? 'flex-col items-start gap-2' : 'items-center justify-between'} `}>
    <div className="min-w-0"><p className="text-[13.5px] font-medium text-slate-800">{label}</p>{description && <p className="mt-0.5 text-pretty text-[12px] leading-[18px] text-slate-500">{description}</p>}</div>
    <div className={stacked ? 'w-full' : 'shrink-0'}>{children}</div>
  </div>;
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
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

const controlClass = 'h-[34px] rounded-[8px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/50 disabled:cursor-not-allowed disabled:opacity-50';
const selectClass = 'h-[34px] rounded-[8px] border border-slate-200 bg-white pl-3 pr-8 text-[13px] text-slate-800 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center]';
const buttonClass = 'inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 transition-[background-color,color,box-shadow] hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-45 shadow-[0_1px_2px_rgba(0,0,0,0.02)]';

export function SettingsDialog(props: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(() => normalizeTab(props.initialTab));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (props.initialTab) setTab(normalizeTab(props.initialTab));
  }, [props.initialTab]);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [session, setSession] = useState<Record<string, any>>({});
  const [defaults, setDefaults] = useState<Record<string, any>>({});
  const [memory, setMemory] = useState<Record<string, any>>({});
  const [appInfo, setAppInfo] = useState<Record<string, any>>({});
  const [workspace, setWorkspace] = useState<Record<string, any>>({});
  const [trust, setTrust] = useState<string>('');
  const [loginInfo, setLoginInfo] = useState<Record<string, any>>({});
  const [credentialInfo, setCredentialInfo] = useState<Record<string, any>>({});
  const [customProviders, setCustomProviders] = useState<ProviderConfig[]>([]);
  const [providerForm, setProviderForm] = useState<ProviderConfig>({});
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:4096');
  const [serverUsername, setServerUsername] = useState('metis');
  const [serverPassword, setServerPassword] = useState('');
  const [serverHasPassword, setServerHasPassword] = useState(false);
  const [serverPasswordChanged, setServerPasswordChanged] = useState(false);
  const [oauthProvider, setOauthProvider] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [language, setLanguagePreference] = useState('auto');
  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>(fallbackLanguageOptions);
  const translate = (value: string) => translateExact(value, language);

  const desktop = (window as any).metisDesktop;
  const disabled = !props.isConnected || props.isBusy || saving;
  const desktopDisabled = saving;
  const connectionDisabled = props.isBusy || saving;
  const providers = useMemo(() => Array.from(new Set([
    ...(Array.isArray(loginInfo.providers) ? loginInfo.providers : []),
    ...props.models.map((model) => model.provider),
  ])).sort(), [loginInfo.providers, props.models]);
  const oauthProviders = Array.isArray(loginInfo.oauthProviders) ? loginInfo.oauthProviders : [];
  const credentialProviders = Array.isArray(credentialInfo.providers) ? credentialInfo.providers : [];

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [nextAppInfo, nextWorkspace, nextProviders, nextConnection] = await Promise.all([
        desktop?.appInfo?.() || Promise.resolve({}),
        desktop?.workspace?.get?.() || Promise.resolve({}),
        desktop?.providerConfig?.listCustom?.() || Promise.resolve([]),
        desktop?.metis?.getConnection?.() || Promise.resolve({}),
      ]);
      setAppInfo(nextAppInfo || {}); setWorkspace(nextWorkspace || {});
      setCustomProviders(Array.isArray(nextProviders)
        ? nextProviders.map((provider) => ({ ...provider, providerId: provider.providerId || provider.provider }))
        : []);
      setLanguagePreference(typeof nextAppInfo?.language === 'string' ? nextAppInfo.language : 'auto');
      setLanguageOptions(Array.isArray(nextAppInfo?.languages)
        ? ['auto', ...nextAppInfo.languages.filter((code: unknown) => typeof code === 'string' && code !== 'auto')].map(languageOption)
        : fallbackLanguageOptions);
      setServerUrl(typeof nextConnection?.baseUrl === 'string' ? nextConnection.baseUrl : 'http://127.0.0.1:4096');
      setServerUsername(typeof nextConnection?.username === 'string' ? nextConnection.username : 'metis');
      setServerHasPassword(Boolean(nextConnection?.hasPassword));
      if (!props.isConnected) return;
      const [nextSession, nextDefaults, nextMemory, nextTrust, nextLogin, nextCredentials, nextLanguage] = await Promise.all([
        props.request<Record<string, any>>('/session'),
        props.request<Record<string, any>>('/settings/defaults'),
        props.request<Record<string, any>>('/memory'),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/trust' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/login' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/logout' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/language' }),
      ]);
      setSession(nextSession || {}); setDefaults(nextDefaults || {}); setMemory(nextMemory || {});
      setTrust(typeof nextTrust?.decision === 'string' ? nextTrust.decision : '');
      setLoginInfo(nextLogin || {}); setCredentialInfo(nextCredentials || {});
      setSessionName(String(nextSession?.sessionName || nextSession?.name || ''));
      setLanguageOptions(Array.isArray(nextLanguage?.options)
        ? nextLanguage.options.filter((item: unknown): item is LanguageOption => Boolean(item && typeof (item as LanguageOption).code === 'string' && typeof (item as LanguageOption).nativeName === 'string'))
        : languageOptions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!oauthProvider && oauthProviders[0]) setOauthProvider(oauthProviders[0]);
    if (oauthProvider && !oauthProviders.includes(oauthProvider)) setOauthProvider(oauthProviders[0] || '');
  }, [oauthProvider, oauthProviders]);

  useEffect(() => { if (props.open) void load(); }, [props.open, props.isConnected]);
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    const onExtensionNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; tone?: string }>).detail;
      if (!detail?.message) return;
      if (detail.tone === 'error') setError(detail.message);
      else setFeedback(detail.message);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('metis:extension-notify', onExtensionNotice);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('metis:extension-notify', onExtensionNotice);
    };
  }, [props.open, props.onClose]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    setSaving(true); setFeedback(''); setError('');
    try {
      const result = await work();
      if (result === false) return;
      setFeedback(success);
      await load();
      if (props.isConnected) await props.refresh();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const command = (value: string, timeoutMs?: number) => props.request<Record<string, any>>('/session/command', 'POST', { command: value }, timeoutMs);
  const updateSession = (value: Record<string, unknown>, success: string) => run(async () => { await props.request('/session/settings', 'PUT', value); }, success);
  const requireDesktop = <T,>(operation: (() => Promise<T>) | undefined, name: string): Promise<T> => {
    if (!operation) throw new Error(`${name} is unavailable in this Desktop build.`);
    return operation();
  };
  const setLanguage = (value: string) => run(async () => {
    if (props.isConnected) await command(`/language ${value}`);
    await requireDesktop(desktop?.setUiLanguage ? () => desktop.setUiLanguage(value) : undefined, 'Language settings');
    setLanguagePreference(value);
    window.dispatchEvent(new CustomEvent('metis:language-changed', { detail: value }));
  }, 'Language saved.');

  async function exportSession(format: 'html' | 'jsonl') {
    const target = await requireDesktop(desktop?.sessionFile?.save ? () => desktop.sessionFile.save(format) : undefined, 'Session export');
    if (!target) return false;
    await command(`/export ${target}`, 10 * 60_000);
    return true;
  }

  const { updateCheck } = props;
  const updateStatus = updateCheck.status === 'checking' ? <Status>Checking…</Status>
    : updateCheck.status === 'available' ? <Status tone="success">Update available</Status>
      : updateCheck.status === 'current' ? <Status tone="success">Already the latest version</Status>
        : updateCheck.status === 'failed' ? <Status tone="danger">Check failed</Status>
          : null;
  const updateDescription = updateCheck.status === 'available'
    ? `New version ${updateCheck.latestVersion || '—'} is available. Download the installer from GitHub Releases.`
    : updateCheck.status === 'failed'
      ? updateCheck.error || 'Could not read the release manifest. Check your network connection.'
      : 'Compare this build against the published release manifest.';

  const instructionSources = Array.isArray(session.instructionSources) ? session.instructionSources.map(instructionSourceLabel) : [];
  const currentMemory = {
    ...memory,
    ...(props.memoryState || {}),
  };
  const isConsolidating = currentMemory.phase === 'extracting' || currentMemory.phase === 'consolidating';
  const totalJobs = currentMemory.extractingTotal || currentMemory.pendingJobs || 0;
  const processedJobs = currentMemory.extractingProcessed ?? 0;
  const progressPercent = totalJobs > 0 ? Math.min(100, Math.round((processedJobs / totalJobs) * 100)) : (currentMemory.phase === 'consolidating' ? 100 : 0);

  // Section 1: General (Language, Onboarding, Shortcuts)
  const general = (
    <>
      <SectionHeading title="General" />
      <div className="space-y-3">
        <Card>
          <Row label="Language" description="Applied to Desktop immediately and synchronized to Agent while connected.">
            <select className={selectClass} value={language} onChange={(e) => void setLanguage(e.target.value)} disabled={desktopDisabled}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}</select>
          </Row>
          <Row label="Onboarding" description="Reopen the welcome and setup spotlight shown on first launch.">
            <button type="button" className={buttonClass} onClick={props.onOpenOnboarding}><Sparkles className="h-3.5 w-3.5" />Open</button>
          </Row>
        </Card>
        <Card>
          {[
            ['New task', '⌘ N'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Close settings', 'Esc'],
          ].map(([label, key]) => <Row key={label} label={label} description=""><kbd className="rounded-[6px] border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">{key}</kbd></Row>)}
        </Card>
      </div>
    </>
  );

  // Section 2: Models & Providers (Current/Default model & reasoning, Cloud keys, Custom providers)
  const model = (
    <>
      <SectionHeading title="Models & Providers" />
      <div className="space-y-3">
        <Card>
          <Row label="Current model" description="Applied to the active session immediately.">
            <select className={`${selectClass} max-w-60`} value={props.activeModel ? `${props.activeModel.provider}/${props.activeModel.id}` : ''} onChange={(e) => { const selected = props.models.find((item) => `${item.provider}/${item.id}` === e.target.value); if (selected) void props.onSelectModel(selected); }} disabled={disabled}>
              <option value="" disabled>Choose model</option>
              {props.models.map((item) => <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>{modelLabel(item)} · {item.provider}</option>)}
            </select>
          </Row>
          <Row label="Reasoning effort" description="Options reported by the current model provider.">
            <select className={selectClass} value={props.thinkingLevel} onChange={(e) => void props.onSelectThinkingLevel(e.target.value)} disabled={disabled || !props.supportsThinking}>
              {props.thinkingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Row>
          <Row label="Default model" description="Used only for newly created sessions.">
            <select className={`${selectClass} max-w-60`} value={defaults.provider && defaults.modelId ? `${defaults.provider}/${defaults.modelId}` : ''} onChange={(e) => void run(async () => { const selected = props.models.find((item) => `${item.provider}/${item.id}` === e.target.value); await props.request('/settings/defaults', 'PUT', selected ? { provider: selected.provider, modelId: selected.id } : { provider: null, modelId: null }); }, 'Default model saved.')} disabled={!props.isConnected || saving}>
              <option value="">No default</option>
              {props.models.map((item) => <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>{modelLabel(item)} · {item.provider}</option>)}
            </select>
          </Row>
          <Row label="Default reasoning" description="Used only for newly created sessions.">
            <select className={selectClass} value={defaults.thinkingLevel || ''} onChange={(e) => void run(() => props.request('/settings/defaults', 'PUT', { thinkingLevel: e.target.value || null }), 'Default reasoning saved.')} disabled={!props.isConnected || saving}>
              <option value="">No default</option>
              {props.thinkingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Row>
        </Card>
        <Card>
          <Row label="OAuth sign in" description="Authorize a subscription account without an API key.">
            <div className="flex gap-2">
              <select className={selectClass} value={oauthProvider} onChange={(event) => setOauthProvider(event.target.value)}>
                {oauthProviders.map((provider: string) => <option key={provider}>{provider}</option>)}
              </select>
              <button className={buttonClass} disabled={disabled || !oauthProvider} onClick={() => void run(() => command(`/login ${oauthProvider}`, 10 * 60_000), 'Authorization completed.')}><KeyRound className="h-3.5 w-3.5" />Sign in</button>
            </div>
          </Row>
          <Row label="API key" description="Save an independent API key for a provider." stacked>
            <ApiKeyControl providers={providers} disabled={disabled} onSave={(provider, key) => run(() => command(`/login ${provider} ${key}`), 'API key saved.')} />
          </Row>
          <Row label="Remove credentials" description="Deletes local Metis credentials only." stacked>
            <LogoutControl providers={credentialProviders} disabled={disabled} translate={translate} onLogout={(provider) => run(() => command(`/logout ${provider}`), 'Credentials removed.')} />
          </Row>
        </Card>
        <Card>
          <Row label="Saved provider" description="Create a provider or edit a saved one." stacked>
            <select className={`${selectClass} w-full`} value={providerForm.providerId || ''} onChange={(e) => { const provider = customProviders.find((item) => item.providerId === e.target.value); setProviderForm(provider || {}); }}>
              <option value="">Add new provider…</option>
              {customProviders.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.name || provider.providerId}</option>)}
            </select>
          </Row>
          <Row label="Connection" description="Provider name, OpenAI-compatible endpoint and optional API key." stacked>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              <input className={controlClass} value={providerForm.name || ''} onChange={(e) => setProviderForm((current) => ({ ...current, name: e.target.value }))} placeholder="Provider name" />
              <input className={controlClass} value={providerForm.baseUrl || ''} onChange={(e) => setProviderForm((current) => ({ ...current, baseUrl: e.target.value }))} placeholder="https://api.example.com/v1" />
              <input className={controlClass} value={providerForm.apiKey || ''} onChange={(e) => setProviderForm((current) => ({ ...current, apiKey: e.target.value }))} type="password" placeholder="API key (leave blank to keep)" />
              <input className={controlClass} value={(providerForm.modelIds || []).join(', ')} onChange={(e) => setProviderForm((current) => ({ ...current, modelIds: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="Model IDs, separated by commas" />
            </div>
            <p className="mt-2 text-[12px] text-slate-500">Reasoning options come from model metadata returned by this API.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={buttonClass} disabled={saving || !providerForm.baseUrl?.trim()} onClick={() => void run(async () => { const discoveredModels = await requireDesktop<Array<{ id: string; thinkingOptions: ThinkingOption[] }>>(desktop?.providerConfig?.discoverModels ? () => desktop.providerConfig.discoverModels(providerForm) : undefined, 'Provider discovery'); setProviderForm((current) => ({ ...current, discoveredModels, modelIds: Array.isArray(discoveredModels) ? discoveredModels.map((model) => model.id) : current.modelIds })); }, 'Available models and reasoning options discovered.')}>
                <RefreshCw className="h-3.5 w-3.5" />Discover models
              </button>
              <button className={buttonClass} disabled={!props.isConnected || saving || !providerForm.name?.trim() || !providerForm.baseUrl?.trim()} onClick={() => void run(async () => { const saved = await requireDesktop<{ provider?: string }>(desktop?.providerConfig?.saveCustom ? () => desktop.providerConfig.saveCustom(providerForm) : undefined, 'Provider settings'); await command('/reload'); if (providerForm.apiKey?.trim() && saved?.provider) await command(`/login ${saved.provider} ${providerForm.apiKey.trim()}`); setProviderForm({}); }, 'Custom provider saved and models reloaded.')}>
                <Save className="h-3.5 w-3.5" />Save provider
              </button>
              <button className={`${buttonClass} text-rose-700 hover:bg-rose-50`} disabled={!props.isConnected || saving || !providerForm.providerId} onClick={() => { if (window.confirm(translate(`Delete ${providerForm.name || providerForm.providerId}?`))) void run(async () => { await requireDesktop(desktop?.providerConfig?.deleteCustom ? () => desktop.providerConfig.deleteCustom(providerForm.providerId!) : undefined, 'Provider settings'); setProviderForm({}); }, 'Custom provider deleted.'); }}>
                <Trash2 className="h-3.5 w-3.5" />Delete
              </button>
            </div>
          </Row>
        </Card>
      </div>
    </>
  );

  // Section 3: Agent & Workflow (Collaboration mode, message queuing & retry, compaction, Memory, instruction sources)
  const agent = (
    <>
      <SectionHeading title="Agent & Workflow" />
      <div className="space-y-3">
        <Card>
          <Row label="Collaboration mode" description="Plan uses read-only tools. Build can make changes; neither mode is an OS sandbox.">
            <select className={selectClass} value={props.collaborationMode} onChange={(e) => void props.onSelectCollaborationMode(e.target.value as CollaborationMode)} disabled={disabled}>
              <option value="plan">Plan</option>
              <option value="build">Build</option>
            </select>
          </Row>
          <Row label="Concurrency strategy" description="Default subagent concurrency limit for Build mode tasks.">
            <select
              className={selectClass}
              value={session.concurrencyStrategy || 'tokensaver'}
              onChange={(e) => void updateSession({ concurrencyStrategy: e.target.value }, 'Concurrency settings saved.')}
              disabled={disabled}
            >
              <option value="tokensaver">Token saver (up to 6 agents)</option>
              <option value="wide">Wide concurrency (up to 200 agents)</option>
              <option value="custom">Custom concurrency limit</option>
            </select>
          </Row>
          {session.concurrencyStrategy === 'custom' && (
            <Row label="Concurrency limit" description="Maximum number of live subagents when custom concurrency is selected.">
              <select
                className={selectClass}
                value={String(session.maxConcurrent || 12)}
                onChange={(e) => void updateSession({ maxConcurrent: parseInt(e.target.value, 10) || 12 }, 'Concurrency settings saved.')}
                disabled={disabled}
              >
                <option value="6">6</option>
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </Row>
          )}
          <Row label="Steering messages" description="How Agent receives instructions while working.">
            <select className={selectClass} value={session.steeringMode || 'one-at-a-time'} onChange={(e) => void updateSession({ steeringMode: e.target.value }, 'Steering preference saved.')} disabled={disabled}>
              <option value="one-at-a-time">One at a time</option>
              <option value="all">All at once</option>
            </select>
          </Row>
          <Row label="Follow-up messages" description="How Agent handles queued messages after it completes.">
            <select className={selectClass} value={session.followUpMode || 'one-at-a-time'} onChange={(e) => void updateSession({ followUpMode: e.target.value }, 'Follow-up preference saved.')} disabled={disabled}>
              <option value="one-at-a-time">One at a time</option>
              <option value="all">All at once</option>
            </select>
          </Row>
          <Row label="Automatic retry" description="Retry transient model and transport failures.">
            <Switch label="Automatic retry" checked={Boolean(session.autoRetryEnabled)} onChange={() => void updateSession({ autoRetryEnabled: !session.autoRetryEnabled }, 'Retry preference saved.')} disabled={disabled} />
          </Row>
        </Card>
        <Card>
          <Row label="Auto-compact context" description="Consolidate the current session as it approaches its context limit.">
            <Switch label="Auto-compact context" checked={Boolean(session.autoCompactionEnabled)} onChange={() => void updateSession({ autoCompactionEnabled: !session.autoCompactionEnabled }, 'Auto-compact preference saved.')} disabled={disabled} />
          </Row>
          <Row label="Compact now" description="Consolidate the current session without changing auto-compact.">
            <button className={buttonClass} disabled={disabled} onClick={() => void run(() => props.request('/session/compact', 'POST', {}, 10 * 60_000), 'Context compaction started.')}>
              <SlidersHorizontal className="h-3.5 w-3.5" />Compact now
            </button>
          </Row>
        </Card>
        <div>
          <Card>
            <Row label="Memory" description="Optional advisory knowledge. It never changes Plan or Build permissions.">
              <Switch label="Memory" checked={Boolean(currentMemory.enabled)} onChange={() => void run(() => props.request('/memory/settings', 'PUT', { enabled: !currentMemory.enabled }), 'Memory setting saved.')} disabled={disabled} />
            </Row>
          </Card>
          <div className="mt-2.5 rounded-[16px] border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {isConsolidating ? (
                  <Status tone="success">
                    <LoaderCircle className="h-3 w-3 animate-spin text-emerald-600" />
                    {currentMemory.phase === 'consolidating' ? 'Saving memory' : 'Extracting memory'}
                  </Status>
                ) : (
                  <Status tone={currentMemory.enabled ? 'success' : 'neutral'}>
                    {currentMemory.enabled ? 'Memory enabled' : 'Memory off'}
                  </Status>
                )}
                <p className="mt-2.5 max-w-lg text-pretty text-[12.5px] leading-5 text-slate-600">
                  {isConsolidating
                    ? (currentMemory.phase === 'consolidating'
                        ? 'New candidates are being validated, deduplicated, and saved.'
                        : 'The background model is reviewing completed work and extracting reusable knowledge.')
                    : (currentMemory.summary || (currentMemory.enabled ? 'Memory is ready to collect reusable knowledge from completed work.' : 'Enable Memory to collect reusable knowledge from completed work.'))}
                </p>
              </div>
              <div className="flex gap-2">
                {isConsolidating ? (
                  <button className={`${buttonClass} border-rose-200 text-rose-700 hover:bg-rose-50`} disabled={saving} onClick={() => void run(() => props.request('/memory/abort', 'POST'), 'Memory extraction stopped.')}>
                    <Square className="h-3.5 w-3.5 fill-current" />Stop
                  </button>
                ) : (
                  <button className={buttonClass} disabled={disabled || !currentMemory.enabled} onClick={() => void run(() => props.request('/memory/run', 'POST', undefined, 10 * 60_000), 'Memory extraction started.')}>
                    <RefreshCw className="h-3.5 w-3.5" />Run now
                  </button>
                )}
                <button className={buttonClass} disabled={disabled || isConsolidating} onClick={() => { const query = window.prompt(translate('Search memory')); if (query?.trim()) void run(async () => { const records = await props.request<any[]>(`/memory/search?q=${encodeURIComponent(query)}`); const record = records[0]; if (record && window.confirm(`${record.content}\n\n${translate('Remove this memory?')}`)) await props.request(`/memory/${encodeURIComponent(record.id)}`, 'DELETE'); }, 'Memory search completed.'); }}>
                  <Gauge className="h-3.5 w-3.5" />Search
                </button>
              </div>
            </div>
            {isConsolidating && (
              <div className="mt-4 rounded-[12px] border border-emerald-200/80 bg-emerald-50/50 p-3.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-emerald-900">
                    {currentMemory.phase === 'consolidating'
                      ? 'Consolidating & saving records…'
                      : `Extracting checkpoints (${processedJobs} / ${totalJobs})`}
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-800">{progressPercent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-emerald-200/60">
                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-emerald-700">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-emerald-800">+{currentMemory.extractingAdded ?? 0} added</span>
                    <span className="text-emerald-600">{currentMemory.extractingSkipped ?? 0} skipped</span>
                  </div>
                  {currentMemory.fallbackUsed && <span className="font-medium text-amber-700">Safe fallback active</span>}
                </div>
              </div>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
              <div><dt className="text-slate-400">Records</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-700">{currentMemory.recordCount ?? (currentMemory.globalCount !== undefined ? currentMemory.globalCount + (currentMemory.projectCount || 0) : 0)}</dd></div>
              <div><dt className="text-slate-400">Pending</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-700">{currentMemory.pendingJobs ?? 0}</dd></div>
              <div><dt className="text-slate-400">Last run</dt><dd className="mt-0.5 font-semibold text-slate-700">{currentMemory.lastRunAt || currentMemory.lastExtractedAt ? new Date(currentMemory.lastRunAt || currentMemory.lastExtractedAt).toLocaleString() : '—'}</dd></div>
              <div><dt className="text-slate-400">Method</dt><dd className="mt-0.5 font-semibold text-slate-700">{currentMemory.extractionMethod || currentMemory.lastExtractionMethod || '—'}</dd></div>
            </dl>
            {currentMemory.lastRunProcessed !== undefined && currentMemory.lastRunProcessed > 0 && !isConsolidating && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-slate-100/90 px-3 py-2 text-[12px] text-slate-600">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-slate-400" />
                  <span>
                    Last run: {currentMemory.lastRunProcessed} processed · {currentMemory.lastRunAdded ?? 0} added · {currentMemory.lastRunSkipped ?? 0} skipped
                    {currentMemory.fallbackUsed ? ' (safe fallback used)' : ''}
                  </span>
                </div>
                {currentMemory.modelFailureReason && (
                  <span className="max-w-xs truncate text-[11px] text-amber-600" title={currentMemory.modelFailureReason}>{currentMemory.modelFailureReason}</span>
                )}
              </div>
            )}
            {currentMemory.error && !isConsolidating && (
              <div className="mt-3 rounded-[10px] border border-rose-200 bg-rose-50/80 p-3 text-[12px] text-rose-700">
                Last failure: {currentMemory.error}
                {currentMemory.nextRetryAt && ` (Retry scheduled at ${new Date(currentMemory.nextRetryAt).toLocaleTimeString()})`}
              </div>
            )}
            <div className="mt-4 border-t border-slate-200 pt-3.5">
              <button className={`${buttonClass} text-rose-700 hover:bg-rose-50`} disabled={disabled || isConsolidating} onClick={() => { if (window.confirm(translate('Reset all stored Memory records? This cannot be undone.'))) void run(() => props.request('/memory/reset', 'POST', { confirm: 'RESET_MEMORY' }), 'Memory reset.'); }}>
                <Trash2 className="h-3.5 w-3.5" />Reset Memory…
              </button>
            </div>
          </div>
        </div>
        <Card>
          <Row label="Loaded instructions" description="The active session’s trusted context and instruction sources.">
            <span className="max-w-72 truncate text-right text-[12px] text-slate-500" title={instructionSources.join(', ')}>{instructionSources.length ? instructionSources.join(', ') : 'No sources reported'}</span>
          </Row>
        </Card>
      </div>
    </>
  );

  // Section 4: Workspace & Server (Connection, Workspace, Trust)
  const server = (
    <>
      <SectionHeading title="Workspace & Server" />
      <div className="space-y-3">
        <Card>
          <Row label="Connection status" description={String(workspace.path || props.activeProject?.path || 'No workspace selected')}>
            <Status tone={props.isConnected ? 'success' : 'danger'}>
              <i className={`h-1.5 w-1.5 rounded-full ${props.isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {props.isConnected ? 'Connected' : 'Disconnected'}
            </Status>
          </Row>
          <Row label="Server configuration" description="Configure address and optional authentication." stacked>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_110px_auto]">
              <input id="serverUrlInput" className={controlClass} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label="Server address" />
              <input className={controlClass} value={serverUsername} onChange={(e) => setServerUsername(e.target.value)} aria-label="Server username" />
              <input className={controlClass} value={serverPassword} onChange={(e) => { setServerPassword(e.target.value); setServerPasswordChanged(true); }} type="password" placeholder={serverHasPassword ? 'Password set; edit to replace or clear' : 'Password'} aria-label="Server password" />
              <button id="connectServerButton" className={buttonClass} disabled={connectionDisabled || !serverUrl.trim()} onClick={() => void run(async () => { const connected = await props.onConnectServer({ baseUrl: serverUrl.trim(), username: serverUsername.trim() || 'metis', ...(serverPasswordChanged ? { password: serverPassword } : {}) }); if (!connected) throw new Error('Unable to connect to the Metis Server'); setServerPassword(''); setServerPasswordChanged(false); return true; }, 'Server connected.')}>
                <CloudCog className="h-3.5 w-3.5" />Connect
              </button>
            </div>
          </Row>
        </Card>
        <Card>
          <Row label="Workspace" description={String(props.activeProject?.path || workspace.path || '—')}>
            <button className={buttonClass} disabled={connectionDisabled} onClick={() => void run(props.onChangeWorkspace, 'Workspace changed.')}>
              <FolderCog className="h-3.5 w-3.5" />Change…
            </button>
          </Row>
        </Card>
        <Card>
          <Row label="Current project trust" description="Controls loading of project resources, not Server network access.">
            <select className={selectClass} value={trust} onChange={(e) => void run(() => command(`/trust ${e.target.value || 'clear'}`), 'Project trust saved.')} disabled={disabled}>
              <option value="">Follow global default</option>
              <option value="trusted">Trusted</option>
              <option value="untrusted">Untrusted</option>
            </select>
          </Row>
        </Card>
      </div>
    </>
  );

  // Section 5: Data & About (Session data, Import/Export/Share, Version, Updates, Maintenance)
  const about = (
    <>
      <SectionHeading title="Data & About" />
      <div className="space-y-3">
        <Card>
          <Row label="Session name" description="Shown in the conversation list." stacked>
            <div className="flex w-full gap-2">
              <input className={`${controlClass} min-w-0 flex-1`} value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="Session name" />
              <button className={buttonClass} disabled={disabled || !sessionName.trim()} onClick={() => void run(() => props.request('/session/name', 'PUT', { name: sessionName.trim() }), 'Session name saved.')}>
                <Save className="h-3.5 w-3.5" />Save
              </button>
            </div>
          </Row>
          <Row label="New session" description="Keep this session and begin a new empty task.">
            <button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const created = await props.onNewSession(); if (!created) throw new Error('Unable to create a new session'); return true; }, 'New session created.')}>
              <Plus className="h-3.5 w-3.5" />Create
            </button>
          </Row>
          <Row label="Export session" description="HTML is readable; JSONL can be resumed.">
            <div className="flex gap-2">
              <button className={buttonClass} disabled={disabled} onClick={() => void run(() => exportSession('html'), 'Session exported as HTML.')}>
                <Download className="h-3.5 w-3.5" />HTML
              </button>
              <button className={buttonClass} disabled={disabled} onClick={() => void run(() => exportSession('jsonl'), 'Session exported as JSONL.')}>
                <Download className="h-3.5 w-3.5" />JSONL
              </button>
            </div>
          </Row>
          <Row label="Import session" description="Create and switch to a session from JSONL.">
            <button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const file = await requireDesktop(desktop?.sessionFile?.open ? () => desktop.sessionFile.open() : undefined, 'Session import'); if (!file) return false; const result = await command(`/import ${file}`, 10 * 60_000); return result.cancelled !== true; }, 'Session imported.')}>
              <Upload className="h-3.5 w-3.5" />Choose file…
            </button>
          </Row>
          <Row label="Share session" description="Create a private GitHub Gist link.">
            <button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const result = await command('/share', 2 * 60_000); if (!result.url) throw new Error('Server did not return a share link'); await requireDesktop(desktop?.openExternal ? () => desktop.openExternal(result.url) : undefined, 'Open share link'); }, 'Share link created.')}>
              <ChevronRight className="h-3.5 w-3.5" />Create link
            </button>
          </Row>
        </Card>
        <Card>
          <Row label="Metis Desktop" description={`Version ${appInfo.version || '—'} · ${appInfo.platform || '—'}`}>
            <Status>{appInfo.name || 'Metis'}</Status>
          </Row>
          <Row label="Software update" description={updateDescription}>
            <div className="flex items-center gap-2">
              {updateStatus}
              <button className={buttonClass} disabled={desktopDisabled || updateCheck.status === 'checking'} onClick={() => void props.onCheckForUpdates()}>
                <RefreshCw className={`h-3.5 w-3.5 ${updateCheck.status === 'checking' ? 'animate-spin' : ''}`} />Check for updates
              </button>
              {updateCheck.status === 'available' && (
                <button className={buttonClass} disabled={desktopDisabled} onClick={() => void run(() => requireDesktop(desktop?.openExternal ? () => desktop.openExternal(RELEASES_URL) : undefined, 'Open releases page'), 'Opened the GitHub Releases page.')}>
                  <Download className="h-3.5 w-3.5" />Download
                </button>
              )}
            </div>
          </Row>
        </Card>
        <Card>
          <Row label="Reload Agent resources" description="Reload extensions, Skills, themes and models.">
            <button className={buttonClass} disabled={disabled} onClick={() => void run(() => command('/reload'), 'Agent resources reloaded.')}>
              <RefreshCw className="h-3.5 w-3.5" />Reload
            </button>
          </Row>
        </Card>
      </div>
    </>
  );

  const sections: Record<SettingsTab, React.ReactNode> = {
    general,
    model,
    agent,
    server,
    about,
  };

  // Search index definition
  const searchItems = useMemo(() => [
    { id: 'language', tab: 'general' as SettingsTab, title: 'Language', desc: 'Applied to Desktop immediately and synchronized to Agent while connected.', keywords: 'interface language 语言 界面 简体中文 english' },
    { id: 'onboarding', tab: 'general' as SettingsTab, title: 'Onboarding', desc: 'Reopen the welcome and setup spotlight shown on first launch.', keywords: 'welcome guide onboarding 新手 引导 欢迎' },
    { id: 'shortcuts', tab: 'general' as SettingsTab, title: 'Keyboard shortcuts', desc: 'Common Desktop actions. Native text-editing shortcuts continue to work while typing.', keywords: 'hotkeys shortcuts 快捷键 键盘' },
    { id: 'model', tab: 'model' as SettingsTab, title: 'Current model', desc: 'Applied to the active session immediately.', keywords: 'active current model 模型 当前模型' },
    { id: 'reasoning', tab: 'model' as SettingsTab, title: 'Reasoning effort', desc: 'Options reported by the current model provider.', keywords: 'thinking effort reasoning 思考 推理 深度' },
    { id: 'default-model', tab: 'model' as SettingsTab, title: 'Default model', desc: 'Used only for newly created sessions.', keywords: 'default model 默认模型' },
    { id: 'default-reasoning', tab: 'model' as SettingsTab, title: 'Default reasoning', desc: 'Used only for newly created sessions.', keywords: 'default thinking reasoning 默认思考 默认推理' },
    { id: 'oauth', tab: 'model' as SettingsTab, title: 'OAuth sign in', desc: 'Authorize a subscription account without an API key.', keywords: 'oauth login sign in 授权 登录' },
    { id: 'api-key', tab: 'model' as SettingsTab, title: 'API key', desc: 'Save an independent API key for a provider.', keywords: 'api key token 密钥 接口' },
    { id: 'custom-provider', tab: 'model' as SettingsTab, title: 'Custom OpenAI-compatible provider', desc: 'Provider name, OpenAI-compatible endpoint and optional API key.', keywords: 'custom provider endpoint base url openai 自定义 服务商' },
    { id: 'collaboration-mode', tab: 'agent' as SettingsTab, title: 'Collaboration mode', desc: 'Plan uses read-only tools. Build can make changes; neither mode is an OS sandbox.', keywords: 'collaboration mode plan build 协作模式 计划 构建' },
    { id: 'steering-messages', tab: 'agent' as SettingsTab, title: 'Steering messages', desc: 'How Agent receives instructions while working.', keywords: 'steering queue message 转向 指导 消息' },
    { id: 'follow-up-messages', tab: 'agent' as SettingsTab, title: 'Follow-up messages', desc: 'How Agent handles queued messages after it completes.', keywords: 'follow up queue message 排队 消息' },
    { id: 'auto-retry', tab: 'agent' as SettingsTab, title: 'Automatic retry', desc: 'Retry transient model and transport failures.', keywords: 'auto retry 自动重试 重试' },
    { id: 'auto-compact', tab: 'agent' as SettingsTab, title: 'Auto-compact context', desc: 'Consolidate the current session as it approaches its context limit.', keywords: 'auto compact context 上下文 自动压缩 压缩' },
    { id: 'compact-now', tab: 'agent' as SettingsTab, title: 'Compact now', desc: 'Consolidate the current session without changing auto-compact.', keywords: 'compact now 手动压缩 立即压缩' },
    { id: 'memory', tab: 'agent' as SettingsTab, title: 'Memory', desc: 'Optional advisory knowledge. It never changes Plan or Build permissions.', keywords: 'memory long term dream 记忆 长期记忆' },
    { id: 'instruction-sources', tab: 'agent' as SettingsTab, title: 'Instruction sources', desc: 'The active session’s trusted context and instruction sources.', keywords: 'instruction prompt source 指令源' },
    { id: 'server-connection', tab: 'server' as SettingsTab, title: 'Server configuration', desc: 'Configure address and optional authentication.', keywords: 'server connection url username password 服务端 连接' },
    { id: 'workspace', tab: 'server' as SettingsTab, title: 'Workspace', desc: 'Manage Desktop connection and the workspace used by the active session.', keywords: 'workspace folder project 工作区 目录 项目' },
    { id: 'project-trust', tab: 'server' as SettingsTab, title: 'Current project trust', desc: 'Controls loading of project resources, not Server network access.', keywords: 'trust security permissions 信任 安全 权限' },
    { id: 'session-name', tab: 'about' as SettingsTab, title: 'Session name', desc: 'Shown in the conversation list.', keywords: 'session name rename 会话 名称 改名' },
    { id: 'export-session', tab: 'about' as SettingsTab, title: 'Export session', desc: 'HTML is readable; JSONL can be resumed.', keywords: 'export html jsonl 导出 会话' },
    { id: 'import-session', tab: 'about' as SettingsTab, title: 'Import session', desc: 'Create and switch to a session from JSONL.', keywords: 'import 导入 会话' },
    { id: 'share-session', tab: 'about' as SettingsTab, title: 'Share session', desc: 'Create a private GitHub Gist link.', keywords: 'share gist 分享 链接' },
    { id: 'app-update', tab: 'about' as SettingsTab, title: 'Software update', desc: 'Compare this build against the published release manifest.', keywords: 'software update version check 软件更新 检查更新' },
    { id: 'reload-resources', tab: 'about' as SettingsTab, title: 'Reload Agent resources', desc: 'Reload extensions, Skills, themes and models.', keywords: 'reload restart resources 重载 重新加载' },
  ], []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return searchItems.filter((item) => {
      const matchTitle = item.title.toLowerCase().includes(normalizedQuery);
      const matchDesc = item.desc.toLowerCase().includes(normalizedQuery);
      const matchKeywords = item.keywords.toLowerCase().includes(normalizedQuery);
      const translatedTitle = translate(item.title).toLowerCase();
      const translatedDesc = translate(item.desc).toLowerCase();
      return matchTitle || matchDesc || matchKeywords || translatedTitle.includes(normalizedQuery) || translatedDesc.includes(normalizedQuery);
    });
  }, [normalizedQuery, searchItems, language]);

  const searchResultsByTab = useMemo(() => {
    const map = new Map<SettingsTab, number>();
    for (const item of searchResults) {
      map.set(item.tab, (map.get(item.tab) || 0) + 1);
    }
    return map;
  }, [searchResults]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 p-5 backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex h-[min(680px,calc(100vh-40px))] w-[min(920px,calc(100vw-40px))] overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_24px_70px_rgb(15_23_42_/_0.2)]">
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-slate-200/80 bg-[#f6f7f9] px-3 pb-3 pt-6 sm:pt-7 select-none">
          <div className="mb-3.5 px-1 flex items-center h-6">
            <h1 id="settings-title" className="text-balance text-[16px] font-semibold tracking-[-0.01em] text-slate-900 leading-6">Settings</h1>
          </div>
          <div className="pb-2.5 flex-shrink-0">
            <div className="relative flex items-center w-full bg-[#eef0f3] rounded-[8px] h-[34px] px-2.5 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-300/60 focus-within:shadow-sm">
              <Search className="w-4 h-4 text-[#9ca3af] mr-2 flex-shrink-0" />
              <input
                type="text"
                className="w-full bg-transparent text-[13px] text-[#1e293b] outline-none placeholder-[#9ca3af]"
                placeholder={translate('Search settings…')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search settings…"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 text-[#9ca3af] hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto space-y-0.5" aria-label="Settings sections">
            {tabs.map((item) => {
              const matchCount = searchResultsByTab.get(item.id) || 0;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-settings-panel={item.id}
                  onClick={() => { setTab(item.id); setFeedback(''); setError(''); }}
                  className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-[10px] flex items-center justify-between transition-[background-color,color,box-shadow] text-left relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                    isActive
                      ? 'bg-[#e0e3e8] shadow-[0_1px_2px_rgba(0,0,0,0.03)] font-medium text-[#0f172a]'
                      : 'hover:bg-black/[0.035] text-[#334155]'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#0f172a]' : 'text-[#64748b]'}`} />
                    <span className="truncate text-[13.5px]">{item.label}</span>
                  </span>
                  {searchQuery && matchCount > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-300/70 px-1.5 text-[10.5px] font-semibold text-slate-700">
                      {matchCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <p className="px-1 pt-2 text-[11px] text-[#9ca3af]">{appInfo.version ? `v${appInfo.version}` : 'Loading version…'}</p>
        </aside>
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-slate-50/30 px-6 pb-6 pt-6 sm:px-7 sm:pb-7 sm:pt-7">
          <button type="button" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-slate-400 transition-[background-color,color] hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60" onClick={props.onClose} aria-label="Close settings">
            <X className="h-4 w-4" />
          </button>
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" />Loading settings…
            </div>
          ) : searchQuery && searchResults.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <CircleHelp className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-[14px] font-medium text-slate-700">No matching settings</p>
              <button type="button" className={`mt-4 ${buttonClass}`} onClick={() => setSearchQuery('')}>Clear search</button>
            </div>
          ) : searchQuery ? (
            <div>
              <SectionHeading title="Search results" description={`Found ${searchResults.length} setting${searchResults.length === 1 ? '' : 's'} matching “${searchQuery}”.`} />
              <Card>
                {searchResults.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => { setTab(item.tab); setSearchQuery(''); }}
                    className="flex cursor-pointer items-center justify-between rounded-[10px] px-3.5 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-slate-800">{item.title}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">
                          {tabs.find((t) => t.id === item.tab)?.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-pretty text-[12px] leading-5 text-slate-500">{item.desc}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </div>
                ))}
              </Card>
            </div>
          ) : (
            sections[tab]
          )}
          {(feedback || error) && (
            <div role={error ? 'alert' : 'status'} className={`sticky bottom-0 mt-5 rounded-[12px] border px-3 py-2 text-[12px] ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error || feedback}
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function ApiKeyControl({ providers, disabled, onSave }: { providers: string[]; disabled: boolean; onSave: (provider: string, key: string) => void }) {
  const [provider, setProvider] = useState(''); const [key, setKey] = useState('');
  useEffect(() => { if (!provider && providers[0]) setProvider(providers[0]); }, [provider, providers]);
  return <div className="flex w-full flex-wrap gap-2"><select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value)}>{providers.map((item) => <option key={item}>{item}</option>)}</select><input className={`${controlClass} min-w-48 flex-1`} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API key" autoComplete="off" /><button className={buttonClass} disabled={disabled || !provider || !key.trim()} onClick={() => { onSave(provider, key.trim()); setKey(''); }}><Save className="h-3.5 w-3.5" />Save</button></div>;
}

function LogoutControl({ providers, disabled, translate, onLogout }: { providers: string[]; disabled: boolean; translate: (value: string) => string; onLogout: (provider: string) => void }) {
  const [provider, setProvider] = useState('');
  useEffect(() => { if (!provider && providers[0]) setProvider(providers[0]); }, [provider, providers]);
  return <div className="flex w-full flex-wrap gap-2"><select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value)}>{providers.map((item) => <option key={item}>{item}</option>)}</select><button className={`${buttonClass} text-rose-700 hover:bg-rose-50`} disabled={disabled || !provider} onClick={() => { if (window.confirm(translate(`Remove saved credentials for ${provider}?`))) onLogout(provider); }}><Trash2 className="h-3.5 w-3.5" />Sign out</button></div>;
}
