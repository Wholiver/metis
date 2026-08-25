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

type SettingsTab = 'general' | 'shortcuts' | 'server' | 'model' | 'agent' | 'security' | 'session' | 'about';

type SettingsDialogProps = {
  open: boolean;
  initialTab?: SettingsTab;
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

const tabs: Array<{ id: SettingsTab; label: string; group?: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'General', group: 'Desktop', icon: Settings2 },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'server', label: 'Server & workspace', group: 'Agent', icon: Server },
  { id: 'model', label: 'Models', icon: Bot },
  { id: 'agent', label: 'Workflow & Memory', icon: MemoryStick },
  { id: 'security', label: 'Security & Providers', icon: ShieldCheck },
  { id: 'session', label: 'Session & data', icon: FileArchive },
  { id: 'about', label: 'About', icon: CircleHelp },
];

function Status({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'danger' }) {
  const colors = tone === 'success' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
    : tone === 'danger' ? 'bg-rose-50 text-rose-700 ring-rose-600/15'
      : 'bg-slate-100 text-slate-600 ring-slate-500/15';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${colors}`}>{children}</span>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <header className="mb-7 max-w-2xl"><h2 className="text-balance text-[22px] font-semibold tracking-[-0.02em] text-slate-900">{title}</h2><p className="mt-1.5 text-pretty text-[13px] leading-5 text-slate-500">{description}</p></header>;
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
  return <section className="space-y-1 rounded-[20px] border border-slate-200/90 bg-white p-1.5">{children}</section>;
}

function Row({ label, description, children, stacked = false }: { label: string; description: string; children: React.ReactNode; stacked?: boolean }) {
  return <div className={`flex min-h-14 gap-4 rounded-[14px] px-4 py-3 transition-colors hover:bg-slate-50/80 ${stacked ? 'flex-col items-start' : 'items-center justify-between'} `}>
    <div className="min-w-0"><p className="text-[13px] font-medium text-slate-800">{label}</p><p className="mt-0.5 text-pretty text-[12px] leading-5 text-slate-500">{description}</p></div>
    <div className={stacked ? 'w-full' : 'shrink-0'}>{children}</div>
  </div>;
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="inline-flex h-10 w-10 items-center justify-center bg-transparent p-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-45"><span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-200'}`}><span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(15_23_42_/_0.2)] transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} /></span></button>;
}

const controlClass = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12px] text-slate-700 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/50 disabled:cursor-not-allowed disabled:opacity-50';
const selectClass = 'h-10 rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-[12px] text-slate-700 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-300/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center]';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 transition-[background-color,color,transform] hover:bg-slate-50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-45';

export function SettingsDialog(props: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(props.initialTab || 'general');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (props.initialTab) setTab(props.initialTab);
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

  if (!props.open) return null;

  const general = <>
    <SectionHeading title="General" description="Desktop language and default Agent interaction behaviour." />
    <Card>
      <Row label="Language" description="Applied to Desktop immediately and synchronized to Agent while connected."><select className={selectClass} value={language} onChange={(e) => void setLanguage(e.target.value)} disabled={desktopDisabled}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}</select></Row>
      <Row label="Onboarding" description="Reopen the welcome and setup spotlight shown on first launch."><button type="button" className={buttonClass} onClick={props.onOpenOnboarding}><Sparkles className="h-3.5 w-3.5" />Open</button></Row>
    </Card>
    <h3 className="mt-7 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Session behaviour</h3>
    <Card>
      <Row label="Auto-compact context" description="Consolidate the current session as it approaches its context limit."><Switch label="Auto-compact context" checked={Boolean(session.autoCompactionEnabled)} onChange={() => void updateSession({ autoCompactionEnabled: !session.autoCompactionEnabled }, 'Auto-compact preference saved.')} disabled={disabled} /></Row>
      <Row label="Automatic retry" description="Retry transient model and transport failures."><Switch label="Automatic retry" checked={Boolean(session.autoRetryEnabled)} onChange={() => void updateSession({ autoRetryEnabled: !session.autoRetryEnabled }, 'Retry preference saved.')} disabled={disabled} /></Row>
      <Row label="Steering messages" description="How Agent receives instructions while working."><select className={selectClass} value={session.steeringMode || 'one-at-a-time'} onChange={(e) => void updateSession({ steeringMode: e.target.value }, 'Steering preference saved.')} disabled={disabled}><option value="one-at-a-time">One at a time</option><option value="all">All at once</option></select></Row>
      <Row label="Follow-up messages" description="How Agent handles queued messages after it completes."><select className={selectClass} value={session.followUpMode || 'one-at-a-time'} onChange={(e) => void updateSession({ followUpMode: e.target.value }, 'Follow-up preference saved.')} disabled={disabled}><option value="one-at-a-time">One at a time</option><option value="all">All at once</option></select></Row>
    </Card>
  </>;

  const shortcuts = <><SectionHeading title="Keyboard shortcuts" description="Common Desktop actions. Native text-editing shortcuts continue to work while typing." /><Card>{[
    ['New task', '⌘ N'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Close settings', 'Esc'],
  ].map(([label, key]) => <Row key={label} label={label} description=""><kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600">{key}</kbd></Row>)}</Card></>;

  const server = <><SectionHeading title="Server & workspace" description="Manage Desktop connection and the workspace used by the active session." /><Card>
    <Row label="Connection status" description={String(workspace.path || props.activeProject?.path || 'No workspace selected')}><Status tone={props.isConnected ? 'success' : 'danger'}><i className={`h-1.5 w-1.5 rounded-full ${props.isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />{props.isConnected ? 'Connected' : 'Disconnected'}</Status></Row>
      <Row label="Server configuration" description="Configure address and optional authentication." stacked><div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_110px_auto]"><input id="serverUrlInput" className={controlClass} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label="Server address" /><input className={controlClass} value={serverUsername} onChange={(e) => setServerUsername(e.target.value)} aria-label="Server username" /><input className={controlClass} value={serverPassword} onChange={(e) => { setServerPassword(e.target.value); setServerPasswordChanged(true); }} type="password" placeholder={serverHasPassword ? 'Password set; edit to replace or clear' : 'Password'} aria-label="Server password" /><button id="connectServerButton" className={buttonClass} disabled={connectionDisabled || !serverUrl.trim()} onClick={() => void run(async () => { const connected = await props.onConnectServer({ baseUrl: serverUrl.trim(), username: serverUsername.trim() || 'metis', ...(serverPasswordChanged ? { password: serverPassword } : {}) }); if (!connected) throw new Error('Unable to connect to the Metis Server'); setServerPassword(''); setServerPasswordChanged(false); return true; }, 'Server connected.')}><CloudCog className="h-3.5 w-3.5" />Connect</button></div></Row>
    <Row label="Workspace" description={String(props.activeProject?.path || workspace.path || '—')}><button className={buttonClass} disabled={connectionDisabled} onClick={() => void run(props.onChangeWorkspace, 'Workspace changed.')}><FolderCog className="h-3.5 w-3.5" />Change…</button></Row>
  </Card></>;

  const model = <><SectionHeading title="Models" description="Select the current model and reasoning level, then set defaults for new sessions." /><Card>
    <Row label="Current model" description="Applied to the active session immediately."><select className={`${selectClass} max-w-60`} value={props.activeModel ? `${props.activeModel.provider}/${props.activeModel.id}` : ''} onChange={(e) => { const selected = props.models.find((item) => `${item.provider}/${item.id}` === e.target.value); if (selected) void props.onSelectModel(selected); }} disabled={disabled}><option value="" disabled>Choose model</option>{props.models.map((item) => <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>{modelLabel(item)} · {item.provider}</option>)}</select></Row>
    <Row label="Reasoning effort" description="Options reported by the current model provider."><select className={selectClass} value={props.thinkingLevel} onChange={(e) => void props.onSelectThinkingLevel(e.target.value)} disabled={disabled || !props.supportsThinking}>{props.thinkingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Row>
  </Card><h3 className="mt-7 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">New session defaults</h3><Card>
    <Row label="Default model" description="Used only for newly created sessions."><select className={`${selectClass} max-w-60`} value={defaults.provider && defaults.modelId ? `${defaults.provider}/${defaults.modelId}` : ''} onChange={(e) => void run(async () => { const selected = props.models.find((item) => `${item.provider}/${item.id}` === e.target.value); await props.request('/settings/defaults', 'PUT', selected ? { provider: selected.provider, modelId: selected.id } : { provider: null, modelId: null }); }, 'Default model saved.')} disabled={!props.isConnected || saving}><option value="">No default</option>{props.models.map((item) => <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>{modelLabel(item)} · {item.provider}</option>)}</select></Row>
    <Row label="Default reasoning" description="Used only for newly created sessions."><select className={selectClass} value={defaults.thinkingLevel || ''} onChange={(e) => void run(() => props.request('/settings/defaults', 'PUT', { thinkingLevel: e.target.value || null }), 'Default reasoning saved.')} disabled={!props.isConnected || saving}><option value="">No default</option>{props.thinkingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Row>
  </Card></>;

  const instructionSources = Array.isArray(session.instructionSources) ? session.instructionSources.map(instructionSourceLabel) : [];
  const currentMemory = {
    ...memory,
    ...(props.memoryState || {}),
  };
  const isConsolidating = currentMemory.phase === 'extracting' || currentMemory.phase === 'consolidating';
  const totalJobs = currentMemory.extractingTotal || currentMemory.pendingJobs || 0;
  const processedJobs = currentMemory.extractingProcessed ?? 0;
  const progressPercent = totalJobs > 0 ? Math.min(100, Math.round((processedJobs / totalJobs) * 100)) : (currentMemory.phase === 'consolidating' ? 100 : 0);

  const agent = <><SectionHeading title="Workflow & Memory" description="Control this session’s tool boundary and review advisory long-term memory." /><Card>
    <Row label="Collaboration mode" description="Plan uses read-only tools. Build can make changes; neither mode is an OS sandbox."><select className={selectClass} value={props.collaborationMode} onChange={(e) => void props.onSelectCollaborationMode(e.target.value as CollaborationMode)} disabled={disabled}><option value="plan">Plan</option><option value="build">Build</option></select></Row>
    <Row label="Memory" description="Optional advisory knowledge. It never changes Plan or Build permissions."><Switch label="Memory" checked={Boolean(currentMemory.enabled)} onChange={() => void run(() => props.request('/memory/settings', 'PUT', { enabled: !currentMemory.enabled }), 'Memory setting saved.')} disabled={disabled} /></Row>
  </Card><div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50/70 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div>
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
    <p className="mt-3 max-w-lg text-pretty text-[13px] leading-5 text-slate-600">
      {isConsolidating
        ? (currentMemory.phase === 'consolidating'
            ? 'New candidates are being validated, deduplicated, and saved.'
            : 'The background model is reviewing completed work and extracting reusable knowledge.')
        : (currentMemory.summary || (currentMemory.enabled ? 'Memory is ready to collect reusable knowledge from completed work.' : 'Enable Memory to collect reusable knowledge from completed work.'))}
    </p></div><div className="flex gap-2">
      {isConsolidating ? (
        <button className={`${buttonClass} border-rose-200 text-rose-700 hover:bg-rose-50`} disabled={saving} onClick={() => void run(() => props.request('/memory/abort', 'POST'), 'Memory extraction stopped.')}><Square className="h-3.5 w-3.5 fill-current" />Stop</button>
      ) : (
        <button className={buttonClass} disabled={disabled || !currentMemory.enabled} onClick={() => void run(() => props.request('/memory/run', 'POST', undefined, 10 * 60_000), 'Memory extraction started.')}><RefreshCw className="h-3.5 w-3.5" />Run now</button>
      )}
      <button className={buttonClass} disabled={disabled || isConsolidating} onClick={() => { const query = window.prompt(translate('Search memory')); if (query?.trim()) void run(async () => { const records = await props.request<any[]>(`/memory/search?q=${encodeURIComponent(query)}`); const record = records[0]; if (record && window.confirm(`${record.content}\n\n${translate('Remove this memory?')}`)) await props.request(`/memory/${encodeURIComponent(record.id)}`, 'DELETE'); }, 'Memory search completed.'); }}><Gauge className="h-3.5 w-3.5" />Search</button>
    </div></div>
    {isConsolidating && (
      <div className="mt-5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-emerald-900">
            {currentMemory.phase === 'consolidating'
              ? 'Consolidating & saving records…'
              : `Extracting checkpoints (${processedJobs} / ${totalJobs})`}
          </span>
          <span className="font-semibold tabular-nums text-emerald-800">{progressPercent}%</span>
        </div>
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-emerald-200/60">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-emerald-700">
          <div className="flex items-center gap-3">
            <span className="font-medium text-emerald-800">+{currentMemory.extractingAdded ?? 0} added</span>
            <span className="text-emerald-600">{currentMemory.extractingSkipped ?? 0} skipped</span>
          </div>
          {currentMemory.fallbackUsed && <span className="font-medium text-amber-700">Safe fallback active</span>}
        </div>
      </div>
    )}
    <dl className="mt-5 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
      <div><dt className="text-slate-400">Records</dt><dd className="mt-1 font-semibold tabular-nums text-slate-700">{currentMemory.recordCount ?? (currentMemory.globalCount !== undefined ? currentMemory.globalCount + (currentMemory.projectCount || 0) : 0)}</dd></div>
      <div><dt className="text-slate-400">Pending</dt><dd className="mt-1 font-semibold tabular-nums text-slate-700">{currentMemory.pendingJobs ?? 0}</dd></div>
      <div><dt className="text-slate-400">Last run</dt><dd className="mt-1 font-semibold text-slate-700">{currentMemory.lastRunAt || currentMemory.lastExtractedAt ? new Date(currentMemory.lastRunAt || currentMemory.lastExtractedAt).toLocaleString() : '—'}</dd></div>
      <div><dt className="text-slate-400">Method</dt><dd className="mt-1 font-semibold text-slate-700">{currentMemory.extractionMethod || currentMemory.lastExtractionMethod || '—'}</dd></div>
    </dl>
    {currentMemory.lastRunProcessed !== undefined && currentMemory.lastRunProcessed > 0 && !isConsolidating && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100/90 px-3.5 py-2.5 text-[12px] text-slate-600">
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
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-[12px] text-rose-700">
        Last failure: {currentMemory.error}
        {currentMemory.nextRetryAt && ` (Retry scheduled at ${new Date(currentMemory.nextRetryAt).toLocaleTimeString()})`}
      </div>
    )}
    <div className="mt-5 border-t border-slate-200 pt-4">
      <button className={`${buttonClass} text-rose-700 hover:bg-rose-50`} disabled={disabled || isConsolidating} onClick={() => { if (window.confirm(translate('Reset all stored Memory records? This cannot be undone.'))) void run(() => props.request('/memory/reset', 'POST', { confirm: 'RESET_MEMORY' }), 'Memory reset.'); }}><Trash2 className="h-3.5 w-3.5" />Reset Memory…</button>
    </div>
  </div><h3 className="mt-7 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Instruction sources</h3><Card><Row label="Loaded instructions" description="The active session’s trusted context and instruction sources."><span className="max-w-72 truncate text-right text-[12px] text-slate-500" title={instructionSources.join(', ')}>{instructionSources.length ? instructionSources.join(', ') : 'No sources reported'}</span></Row></Card></>;

  const security = <><SectionHeading title="Security & Providers" description="Manage project resources and model-provider credentials." /><Card>
    <Row label="Current project trust" description="Controls loading of project resources, not Server network access."><select className={selectClass} value={trust} onChange={(e) => void run(() => command(`/trust ${e.target.value || 'clear'}`), 'Project trust saved.')} disabled={disabled}><option value="">Follow global default</option><option value="trusted">Trusted</option><option value="untrusted">Untrusted</option></select></Row>
    <Row label="OAuth sign in" description="Authorize a subscription account without an API key."><div className="flex gap-2"><select className={selectClass} value={oauthProvider} onChange={(event) => setOauthProvider(event.target.value)}>{oauthProviders.map((provider: string) => <option key={provider}>{provider}</option>)}</select><button className={buttonClass} disabled={disabled || !oauthProvider} onClick={() => void run(() => command(`/login ${oauthProvider}`, 10 * 60_000), 'Authorization completed.')}><KeyRound className="h-3.5 w-3.5" />Sign in</button></div></Row>
    <Row label="API key" description="Save an independent API key for a provider." stacked><ApiKeyControl providers={providers} disabled={disabled} onSave={(provider, key) => run(() => command(`/login ${provider} ${key}`), 'API key saved.')} /></Row>
    <Row label="Remove credentials" description="Deletes local Metis credentials only." stacked><LogoutControl providers={credentialProviders} disabled={disabled} translate={translate} onLogout={(provider) => run(() => command(`/logout ${provider}`), 'Credentials removed.')} /></Row>
  </Card><h3 className="mt-7 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Custom OpenAI-compatible provider</h3><Card>
    <Row label="Saved provider" description="Create a provider or edit a saved one." stacked><select className={`${selectClass} w-full`} value={providerForm.providerId || ''} onChange={(e) => { const provider = customProviders.find((item) => item.providerId === e.target.value); setProviderForm(provider || {}); }}><option value="">Add new provider…</option>{customProviders.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.name || provider.providerId}</option>)}</select></Row>
    <Row label="Connection" description="Provider name, OpenAI-compatible endpoint and optional API key." stacked><div className="grid w-full gap-2 sm:grid-cols-2"><input className={controlClass} value={providerForm.name || ''} onChange={(e) => setProviderForm((current) => ({ ...current, name: e.target.value }))} placeholder="Provider name" /><input className={controlClass} value={providerForm.baseUrl || ''} onChange={(e) => setProviderForm((current) => ({ ...current, baseUrl: e.target.value }))} placeholder="https://api.example.com/v1" /><input className={controlClass} value={providerForm.apiKey || ''} onChange={(e) => setProviderForm((current) => ({ ...current, apiKey: e.target.value }))} type="password" placeholder="API key (leave blank to keep)" /><input className={controlClass} value={(providerForm.modelIds || []).join(', ')} onChange={(e) => setProviderForm((current) => ({ ...current, modelIds: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="Model IDs, separated by commas" /></div><p className="mt-3 text-[12px] text-slate-500">Reasoning options come from model metadata returned by this API.</p><div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} disabled={saving || !providerForm.baseUrl?.trim()} onClick={() => void run(async () => { const discoveredModels = await requireDesktop<Array<{ id: string; thinkingOptions: ThinkingOption[] }>>(desktop?.providerConfig?.discoverModels ? () => desktop.providerConfig.discoverModels(providerForm) : undefined, 'Provider discovery'); setProviderForm((current) => ({ ...current, discoveredModels, modelIds: Array.isArray(discoveredModels) ? discoveredModels.map((model) => model.id) : current.modelIds })); }, 'Available models and reasoning options discovered.')}><RefreshCw className="h-3.5 w-3.5" />Discover models</button><button className={buttonClass} disabled={!props.isConnected || saving || !providerForm.name?.trim() || !providerForm.baseUrl?.trim()} onClick={() => void run(async () => { const saved = await requireDesktop<{ provider?: string }>(desktop?.providerConfig?.saveCustom ? () => desktop.providerConfig.saveCustom(providerForm) : undefined, 'Provider settings'); await command('/reload'); if (providerForm.apiKey?.trim() && saved?.provider) await command(`/login ${saved.provider} ${providerForm.apiKey.trim()}`); setProviderForm({}); }, 'Custom provider saved and models reloaded.')}><Save className="h-3.5 w-3.5" />Save provider</button><button className={`${buttonClass} text-rose-700 hover:bg-rose-50`} disabled={!props.isConnected || saving || !providerForm.providerId} onClick={() => { if (window.confirm(translate(`Delete ${providerForm.name || providerForm.providerId}?`))) void run(async () => { await requireDesktop(desktop?.providerConfig?.deleteCustom ? () => desktop.providerConfig.deleteCustom(providerForm.providerId!) : undefined, 'Provider settings'); setProviderForm({}); }, 'Custom provider deleted.'); }}><Trash2 className="h-3.5 w-3.5" />Delete</button></div></Row>
  </Card></>;

  const sessionTab = <><SectionHeading title="Session & data" description="Manage the active session, imports, exports and sharing." /><Card>
    <Row label="Session name" description="Shown in the conversation list." stacked><div className="flex w-full gap-2"><input className={`${controlClass} min-w-0 flex-1`} value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="Session name" /><button className={buttonClass} disabled={disabled || !sessionName.trim()} onClick={() => void run(() => props.request('/session/name', 'PUT', { name: sessionName.trim() }), 'Session name saved.')}><Save className="h-3.5 w-3.5" />Save</button></div></Row>
    <Row label="Compact now" description="Consolidate the current session without changing auto-compact."><button className={buttonClass} disabled={disabled} onClick={() => void run(() => props.request('/session/compact', 'POST', {}, 10 * 60_000), 'Context compaction started.')}><SlidersHorizontal className="h-3.5 w-3.5" />Compact now</button></Row>
    <Row label="New session" description="Keep this session and begin a new empty task."><button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const created = await props.onNewSession(); if (!created) throw new Error('Unable to create a new session'); return true; }, 'New session created.')}><Plus className="h-3.5 w-3.5" />Create</button></Row>
  </Card><h3 className="mt-7 mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Transfer & share</h3><Card>
    <Row label="Export session" description="HTML is readable; JSONL can be resumed."><div className="flex gap-2"><button className={buttonClass} disabled={disabled} onClick={() => void run(() => exportSession('html'), 'Session exported as HTML.')}><Download className="h-3.5 w-3.5" />HTML</button><button className={buttonClass} disabled={disabled} onClick={() => void run(() => exportSession('jsonl'), 'Session exported as JSONL.')}><Download className="h-3.5 w-3.5" />JSONL</button></div></Row>
    <Row label="Import session" description="Create and switch to a session from JSONL."><button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const file = await requireDesktop(desktop?.sessionFile?.open ? () => desktop.sessionFile.open() : undefined, 'Session import'); if (!file) return false; const result = await command(`/import ${file}`, 10 * 60_000); return result.cancelled !== true; }, 'Session imported.')}><Upload className="h-3.5 w-3.5" />Choose file…</button></Row>
    <Row label="Share session" description="Create a private GitHub Gist link."><button className={buttonClass} disabled={disabled} onClick={() => void run(async () => { const result = await command('/share', 2 * 60_000); if (!result.url) throw new Error('Server did not return a share link'); await requireDesktop(desktop?.openExternal ? () => desktop.openExternal(result.url) : undefined, 'Open share link'); }, 'Share link created.')}><ChevronRight className="h-3.5 w-3.5" />Create link</button></Row>
  </Card></>;

  async function exportSession(format: 'html' | 'jsonl') {    const target = await requireDesktop(desktop?.sessionFile?.save ? () => desktop.sessionFile.save(format) : undefined, 'Session export');
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

  const about = <><SectionHeading title="About" description="Application information and maintenance operations." /><Card>
    <Row label="Metis Desktop" description={`Version ${appInfo.version || '—'} · ${appInfo.platform || '—'}`}><Status>{appInfo.name || 'Metis'}</Status></Row>
    <Row label="Software update" description={updateDescription}>
      <div className="flex items-center gap-2">
        {updateStatus}
        <button className={buttonClass} disabled={desktopDisabled || updateCheck.status === 'checking'} onClick={() => void props.onCheckForUpdates()}><RefreshCw className={`h-3.5 w-3.5 ${updateCheck.status === 'checking' ? 'animate-spin' : ''}`} />Check for updates</button>
        {updateCheck.status === 'available' && <button className={buttonClass} disabled={desktopDisabled} onClick={() => void run(() => requireDesktop(desktop?.openExternal ? () => desktop.openExternal(RELEASES_URL) : undefined, 'Open releases page'), 'Opened the GitHub Releases page.')}><Download className="h-3.5 w-3.5" />Download</button>}
      </div>
    </Row>
    <Row label="Reload Agent resources" description="Reload extensions, Skills, themes and models."><button className={buttonClass} disabled={disabled} onClick={() => void run(() => command('/reload'), 'Agent resources reloaded.')}><RefreshCw className="h-3.5 w-3.5" />Reload</button></Row>
  </Card></>;

  const sections: Record<SettingsTab, React.ReactNode> = { general, shortcuts, server, model, agent, security, session: sessionTab, about };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 p-5 backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex h-[min(680px,calc(100vh-40px))] w-[min(920px,calc(100vw-40px))] overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_24px_70px_rgb(15_23_42_/_0.2)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/70 p-2.5"><div className="mb-4 px-2.5 pt-4"><h1 id="settings-title" className="text-balance text-[20px] font-semibold tracking-[-0.02em] text-slate-900">Settings</h1></div><nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Settings sections">{tabs.map((item, index) => <div key={item.id}>{item.group && <p className={`${index ? 'mt-4' : ''} px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400`}>{item.group}</p>}<button type="button" data-settings-panel={item.id} onClick={() => { setTab(item.id); setFeedback(''); setError(''); }} className={`mb-0.5 flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${tab === item.id ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.06)]' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`} aria-current={tab === item.id ? 'page' : undefined}><item.icon className="h-4 w-4" />{item.label}</button></div>)}</nav><p className="px-2.5 pt-3 text-[10px] text-slate-400">{appInfo.version ? `v${appInfo.version}` : 'Loading version…'}</p></aside>
      <main className="relative min-w-0 flex-1 overflow-y-auto bg-slate-50/30 p-7"><button type="button" className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-[background-color,color,transform] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60" onClick={props.onClose} aria-label="Close settings"><X className="h-4 w-4" /></button>{loading ? <div className="flex h-full items-center justify-center gap-2 text-[13px] text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" />Loading settings…</div> : sections[tab]}{(feedback || error) && <div role={error ? 'alert' : 'status'} className={`sticky bottom-0 mt-5 rounded-[14px] border px-3 py-2 text-[12px] ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || feedback}</div>}</main>
    </section>
  </div>;
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
