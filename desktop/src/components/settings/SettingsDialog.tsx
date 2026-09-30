import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  Upload,
  Brain,
  X,
} from 'lucide-react';
import type { AdaptationSummaryItem, CollaborationMode, ModelOption, ProjectItem, ProviderCatalogEntry, ThinkingOption } from '../../types';
import type { ArchivedSessionRecord } from '../../lib/archived-sessions';
import { RELEASES_URL, type UpdateCheckState } from '../../hooks/useUpdateCheck';
import { translateExact } from '../../i18n';
import { modelLabel } from '../chat/ModelSwitcher';
import { Button } from '../atoms/Button';
import { ValuePill } from '../atoms/ValuePill';
import ApprovalDialog from '../primitives/ApprovalDialog';
import GlideMenu from '../primitives/GlideMenu';
import { AddModelModal } from './AddModelModal';

type Request = <T>(path: string, method?: string, body?: unknown, timeoutMs?: number) => Promise<T>;

export type SettingsTab = 'general' | 'model' | 'agent' | 'adaptations' | 'server' | 'about';
export type AnySettingsTab = SettingsTab | 'shortcuts' | 'security' | 'session';

type SettingsDialogProps = {
  open: boolean;
  initialTab?: AnySettingsTab;
  onClose: () => void;
  request: Request;
  refresh: () => Promise<void>;
  isConnected: boolean;
  isBusy: boolean;
  models: ModelOption[];
  providerCatalog: ProviderCatalogEntry[];
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
  archivedSessions?: ArchivedSessionRecord[];
  onRestoreArchivedSession?: (sessionId: string) => void;
  onDeleteArchivedSession?: (sessionId: string) => Promise<void>;
};

type ProviderConfig = {
  providerId?: string;
  provider?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  modelsPath?: string;
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
  adaptations: 'adaptations',
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
  { id: 'adaptations', label: 'Self-Learning', icon: SlidersHorizontal },
  { id: 'server', label: 'Workspace & Server', icon: Server },
  { id: 'about', label: 'Data & About', icon: FileArchive },
];

function Status({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'danger' }) {
  const colors = tone === 'success' ? 'bg-green-tint text-green ring-green/20'
    : tone === 'danger' ? 'bg-red-tint text-red ring-red/20'
      : 'bg-hover-2 text-ink-2 ring-[color:var(--focus)]';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${colors}`}>{children}</span>;
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return <header className="mb-4 max-w-2xl"><h2 className="text-balance text-[16px] font-semibold tracking-[-0.01em] text-ink leading-6">{title}</h2>{description && <p className="mt-1 text-pretty text-[12.5px] leading-5 text-ink-3">{description}</p>}</header>;
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
  return <section className="space-y-0.5 rounded-card bg-surface p-1 shadow-card">{children}</section>;
}

function Row({ label, description, children, stacked = false }: { label: string; description: string; children: React.ReactNode; stacked?: boolean }) {
  return <div className={`flex min-h-[48px] gap-4 rounded-control px-3.5 py-2 transition-colors hover:bg-hover-2 ${stacked ? 'flex-col items-start gap-2' : 'items-center justify-between'} `}>
    <div className="min-w-0"><p className="text-[13.5px] font-medium text-ink">{label}</p>{description && <p className="mt-0.5 text-pretty text-[12px] leading-[18px] text-ink-3">{description}</p>}</div>
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

const controlClass = 'h-9 w-full rounded-control border border-line-strong bg-field px-3 text-[13px] text-ink shadow-inset-field outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';
const selectClass = 'h-9 rounded-control border border-line-strong bg-field pl-3 pr-8 text-[13px] text-ink shadow-inset-field outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center]';
const iconButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-[background-color,color] hover:bg-hover-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:opacity-50';
const dangerIconButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-red-tint hover:text-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:opacity-50';

export function SettingsDialog(props: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(() => normalizeTab(props.initialTab));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [approval, setApproval] = useState<{
    title: string;
    message: string;
    inputLabel?: string;
    confirmLabel: string;
    danger?: boolean;
    resolve: (value: string | null) => void;
  } | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);

  const requestApproval = useCallback((options: {
    title: string;
    message: string;
    inputLabel?: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => new Promise<string | null>((resolve) => {
    setApproval({ ...options, confirmLabel: options.confirmLabel || 'Continue', resolve });
  }), []);

  const closeApproval = useCallback((value: string | null) => {
    setApproval((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const handleTabChange = (nextTab: SettingsTab) => {
    setTab(nextTab);
    setFeedback('');
    setError('');
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    setIsScrolled(false);
  };

  useEffect(() => {
    if (props.initialTab) setTab(normalizeTab(props.initialTab));
  }, [props.initialTab]);

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    setIsScrolled(false);
  }, [searchQuery, tab]);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [session, setSession] = useState<Record<string, any>>({});
  const [defaults, setDefaults] = useState<Record<string, any>>({});
  const [appInfo, setAppInfo] = useState<Record<string, any>>({});
  const [workspace, setWorkspace] = useState<Record<string, any>>({});
  const [trust, setTrust] = useState<string>('');
  const [loginInfo, setLoginInfo] = useState<Record<string, any>>({});
  const [credentialInfo, setCredentialInfo] = useState<Record<string, any>>({});
  const [customProviders, setCustomProviders] = useState<ProviderConfig[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
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
  const [deletingArchivedId, setDeletingArchivedId] = useState<string | null>(null);
  const [selfLearningEnabled, setSelfLearningEnabled] = useState(false);
  const [maxLearnedSkills, setMaxLearnedSkills] = useState(30);
  const [adaptations, setAdaptations] = useState<AdaptationSummaryItem[]>([]);
  const [userProfile, setUserProfile] = useState<any>();
  const [growthReport, setGrowthReport] = useState<any>();
  const [adaptationScopeFilter, setAdaptationScopeFilter] = useState<'all' | 'project' | 'user'>('all');
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [retiringCheckId, setRetiringCheckId] = useState<string | null>(null);
  const [refreshingSelfLearning, setRefreshingSelfLearning] = useState(false);
  const hasLoadedRef = useRef(false);
  const translate = (keyOrText: string, variables?: Record<string, string | number>) => translateExact(keyOrText, language, variables);

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
    if (!hasLoadedRef.current) setLoading(true);
    setError('');
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
      const [nextSession, nextDefaults, nextTrust, nextLogin, nextCredentials, nextLanguage, nextAdaptations, nextSelfLearning] = await Promise.all([
        props.request<Record<string, any>>('/session'),
        props.request<Record<string, any>>('/settings/defaults'),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/trust' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/login' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/logout' }),
        props.request<Record<string, any>>('/session/command', 'POST', { command: '/language' }),
        props.request<{ enabled: boolean; adaptations: AdaptationSummaryItem[]; unnotifiedCount: number }>('/adaptations').catch(() => null),
        props.request<{ enabled: boolean; maxLearnedSkills?: number }>('/self-learning').catch(() => null),
      ]);
      setSession(nextSession || {}); setDefaults(nextDefaults || {});
      setTrust(typeof nextTrust?.decision === 'string' ? nextTrust.decision : '');
      setLoginInfo(nextLogin || {}); setCredentialInfo(nextCredentials || {});
      setSessionName(String(nextSession?.sessionName || nextSession?.name || ''));
      setLanguageOptions(Array.isArray(nextLanguage?.options)
        ? nextLanguage.options.filter((item: unknown): item is LanguageOption => Boolean(item && typeof (item as LanguageOption).code === 'string' && typeof (item as LanguageOption).nativeName === 'string'))
        : languageOptions);
      if (nextSelfLearning) {
        if (typeof nextSelfLearning.enabled === 'boolean') {
          setSelfLearningEnabled(nextSelfLearning.enabled);
        }
        if (typeof nextSelfLearning.maxLearnedSkills === 'number') {
          setMaxLearnedSkills(nextSelfLearning.maxLearnedSkills);
        }
      } else if (nextAdaptations && typeof nextAdaptations.enabled === 'boolean') {
        setSelfLearningEnabled(nextAdaptations.enabled);
      }
      if (nextAdaptations) {
        if (Array.isArray(nextAdaptations.adaptations)) {
          setAdaptations(nextAdaptations.adaptations);
        }
        if ((nextAdaptations as any).growth) {
          setGrowthReport((nextAdaptations as any).growth);
        }
        if ((nextAdaptations as any).profile) {
          setUserProfile((nextAdaptations as any).profile);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  };

  const loadAdaptations = useCallback(async (isManual = false) => {
    if (!props.isConnected) return;
    if (isManual) setRefreshingSelfLearning(true);
    try {
      const [nextAdaptations, nextSelfLearning] = await Promise.all([
        props.request<{ enabled: boolean; adaptations: AdaptationSummaryItem[]; unnotifiedCount: number; growth?: any; profile?: any }>('/adaptations').catch(() => null),
        props.request<{ enabled: boolean; maxLearnedSkills?: number }>('/self-learning').catch(() => null),
      ]);
      if (nextSelfLearning) {
        if (typeof nextSelfLearning.enabled === 'boolean') {
          setSelfLearningEnabled(nextSelfLearning.enabled);
        }
        if (typeof nextSelfLearning.maxLearnedSkills === 'number') {
          setMaxLearnedSkills(nextSelfLearning.maxLearnedSkills);
        }
      } else if (nextAdaptations && typeof nextAdaptations.enabled === 'boolean') {
        setSelfLearningEnabled(nextAdaptations.enabled);
      }
      if (nextAdaptations) {
        if (Array.isArray(nextAdaptations.adaptations)) {
          setAdaptations(nextAdaptations.adaptations);
        }
        if (nextAdaptations.growth) {
          setGrowthReport(nextAdaptations.growth);
        }
        if (nextAdaptations.profile) {
          setUserProfile(nextAdaptations.profile);
        }
      }
    } catch {
      // ignore transient load errors
    } finally {
      if (isManual) setRefreshingSelfLearning(false);
    }
  }, [props.isConnected, props.request]);

  useEffect(() => {
    if (!props.open || tab !== 'adaptations' || !props.isConnected) return;
    void loadAdaptations();
    const unsubscribe = desktop?.metis?.onEvent?.((payload: any) => {
      try {
        const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (
          event?.type === 'adaptation_changed' ||
          event?.type === 'turn_complete' ||
          event?.type === 'session_state' ||
          event?.type === 'message'
        ) {
          void loadAdaptations();
        }
      } catch {}
    });
    const interval = setInterval(() => {
      void loadAdaptations();
    }, 4000);
    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [props.open, tab, props.isConnected, loadAdaptations, desktop]);

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

  // Section 1: General (Language, Onboarding, Shortcuts)
  const general = (
    <div className="space-y-3">
        <Card>
          <Row label="Language" description="Applied to Desktop immediately and synchronized to Agent while connected.">
            <select className={selectClass} value={language} onChange={(e) => void setLanguage(e.target.value)} disabled={desktopDisabled}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}</select>
          </Row>
          <Row label="Onboarding" description="Reopen the welcome and setup spotlight shown on first launch.">
            <Button type="button" variant="secondary" size="sm" onClick={props.onOpenOnboarding}><Sparkles className="h-3.5 w-3.5" />Open</Button>
          </Row>
        </Card>
        <Card>
          {[
            ['New task', '⌘ N'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Close settings', 'Esc'],
          ].map(([label, key]) => <Row key={label} label={label} description=""><kbd className="rounded-control border border-line bg-inset px-2 py-0.5 font-mono text-[11px] text-ink-2">{key}</kbd></Row>)}
        </Card>
      </div>
  );

  const modelsFilePath = useMemo(() => {
    const rawPath = customProviders[0]?.modelsPath || '~/.metis/agent/models.json';
    return rawPath
      .replace(/^\/Users\/[^/]+/, '~')
      .replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
  }, [customProviders]);

  const handleSaveCustomModel = async (config: {
    name: string;
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
    modelIds?: string[];
    models?: Array<{ id: string; name?: string }>;
    discoveredModels?: Array<{ id: string; name?: string }>;
    builtin?: boolean;
  }) => {
    await run(async () => {
      const saved = await requireDesktop<{ provider?: string }>(
        desktop?.providerConfig?.saveCustom ? () => desktop.providerConfig.saveCustom(config) : undefined,
        'Provider settings'
      );
      await command('/reload');
      if (config.apiKey?.trim() && saved?.provider) {
        await command(`/login ${saved.provider} ${config.apiKey.trim()}`);
      }
    }, config.builtin
      ? (translate('API key saved.') || 'API key saved.')
      : (translate('modelSavedSuccess') || 'Custom model saved successfully.'));
  };

  const refreshProviderState = async () => {
    await load();
    if (props.isConnected) await props.refresh();
  };

  const handleApiKeyLogin = async (providerId: string, apiKey: string) => {
    await command(`/login ${providerId} ${apiKey}`);
    setFeedback(translate('API key saved.'));
    await refreshProviderState();
  };

  const handleOAuthLogin = async (providerId: string) => {
    await command(`/login ${providerId}`, 300_000);
    setFeedback(translate('Authorization started.'));
    await refreshProviderState();
  };

  const handleRemoveCredential = async (providerId: string, name: string) => {
    const approved = await requestApproval({
      title: translate('Remove credentials'),
      message: translate(`Remove saved credentials for ${name}?`),
      confirmLabel: translate('Remove'),
      danger: true,
    });
    if (approved !== null) {
      await run(async () => {
        await command(`/logout ${providerId}`);
        await refreshProviderState();
      }, translate('Credentials removed.'));
    }
  };

  const savedOAuthAndBuiltinProviders = useMemo(() => {
    return credentialProviders
      .filter((providerId) => !customProviders.some((custom) => (custom.providerId || custom.provider) === providerId))
      .map((providerId) => {
        const catalog = props.providerCatalog?.find((p) => p.id === providerId);
        const isOAuth = catalog?.authMethods?.includes('oauth') || oauthProviders.includes(providerId);
        const associatedModels = props.models.filter((m) => m.provider === providerId);
        const modelNames = associatedModels.length > 0
          ? associatedModels.map((m) => m.name || m.id).slice(0, 3).join(', ') + (associatedModels.length > 3 ? '…' : '')
          : isOAuth ? 'OAuth' : 'API Key';
        return {
          id: providerId,
          name: catalog?.name || providerId,
          isOAuth,
          tag: isOAuth ? 'OAuth' : 'API Key',
          modelsSummary: modelNames,
          baseUrl: catalog?.baseUrl || (isOAuth ? translate('OAuth authorized account') : translate('API key authorized')),
        };
      });
  }, [credentialProviders, customProviders, props.providerCatalog, props.models, oauthProviders, translate]);

  const model = (
    <>
      <div className="space-y-6">
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0 pr-3">
              <h3 className="text-[13.5px] font-medium text-ink truncate">
                {translate('Local configuration file')}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-3 truncate">
                {translate(`Manage local custom model configurations written to ${modelsFilePath}.`)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="h-3.5 w-3.5" />
                <span>{translate('Add model')}</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[14px] font-semibold text-ink">
            {translate('Saved models')}
          </h3>

          {customProviders.length === 0 && savedOAuthAndBuiltinProviders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-inset/50 dark:bg-surface/50 py-10 px-6 text-center">
              <p className="text-[13.5px] font-semibold text-ink-2">
                {translate('No custom models configured yet')}
              </p>
              <p className="mt-1.5 max-w-md text-[12px] text-ink-3 leading-normal">
                {translate('Added models will automatically be written to local models.json and appear in the chat model dropdown under the "Custom Models" group.')}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
              {customProviders.map((provider) => {
                const modelNames =
                  provider.modelIds && provider.modelIds.length > 0
                    ? provider.modelIds.join(', ')
                    : provider.models && provider.models.length > 0
                    ? provider.models.map((m) => m.id).join(', ')
                    : 'Auto';
                return (
                  <div
                    key={provider.providerId}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-hover-2"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium text-ink truncate">
                          {provider.name || provider.providerId}
                        </span>
                        <ValuePill className="text-[11px]">{modelNames}</ValuePill>
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-ink-3 truncate">
                        {provider.baseUrl}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        title={translate('Delete')}
                        onClick={async () => {
                          const approved = await requestApproval({
                            title: translate('Delete custom model'),
                            message: translate(`Delete custom model ${provider.name || provider.providerId || ''}?`),
                            confirmLabel: translate('Delete'),
                            danger: true,
                          });
                          if (approved !== null) {
                            void run(async () => {
                              await requireDesktop(
                                desktop?.providerConfig?.deleteCustom
                                  ? () => desktop.providerConfig.deleteCustom(provider.providerId!)
                                  : undefined,
                                'Provider settings'
                              );
                            }, translate('Custom model deleted successfully.'));
                          }
                        }}
                        className={dangerIconButtonClass}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {savedOAuthAndBuiltinProviders.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-hover-2"
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-medium text-ink truncate">
                        {item.name}
                      </span>
                      <ValuePill tone="accent" className="text-[11px]">{item.tag}</ValuePill>
                      {item.modelsSummary && item.modelsSummary !== item.tag ? (
                        <ValuePill className="text-[11px]">{item.modelsSummary}</ValuePill>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-3 truncate">
                      {item.baseUrl}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      title={translate('Sign out')}
                      onClick={() => void handleRemoveCredential(item.id, item.name)}
                      className={dangerIconButtonClass}
                      aria-label="Sign out"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AddModelModal
        open={showAddModal}
        providers={props.providerCatalog}
        knownModels={props.models}
        onClose={() => setShowAddModal(false)}
        onSave={handleSaveCustomModel}
        onApiKeyLogin={handleApiKeyLogin}
        onOAuthLogin={handleOAuthLogin}
        onDiscoverModels={(options) => desktop?.providerConfig?.discoverModels?.(options)}
        translate={translate}
      />
    </>
  );

  // Section 3: Agent & Workflow (Collaboration mode, message queuing & retry, compaction, Memory, instruction sources)
  const agent = (
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
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(() => props.request('/session/compact', 'POST', {}, 10 * 60_000), 'Context compaction started.')}>
              <SlidersHorizontal className="h-3.5 w-3.5" />Compact now
            </Button>
          </Row>
        </Card>
        <Card>
          <Row label="Loaded instructions" description="The active session’s trusted context and instruction sources.">
            <span className="max-w-72 truncate text-right text-[12px] text-ink-3" title={instructionSources.join(', ')}>{instructionSources.length ? instructionSources.join(', ') : 'No sources reported'}</span>
          </Row>
        </Card>
      </div>
  );

  const handleToggleSelfLearning = async (enabled: boolean) => {
    await run(async () => {
      await props.request('/self-learning', 'PUT', { enabled });
      setSelfLearningEnabled(enabled);
    }, enabled ? (translate('selfLearningEnabled') || 'Self-learning enabled.') : (translate('selfLearningOff') || 'Self-learning disabled.'));
  };

  const handleUpdateMaxSkills = async (val: number) => {
    const clamped = Math.max(1, Math.min(100, Math.floor(val) || 30));
    setMaxLearnedSkills(clamped);
    await run(async () => {
      await props.request('/self-learning', 'PUT', { maxLearnedSkills: clamped });
    });
  };

  const handleRollbackAdaptation = async (item: AdaptationSummaryItem) => {
    const title = translate('selfLearningRollbackConfirmTitle') || 'Rollback adaptation';
    const message = (translate('selfLearningRollbackConfirmMessage') || 'Roll back adaptation {name} to previous revision?').replace('{name}', item.name || item.kind);
    const confirmed = await requestApproval({
      title,
      message,
      confirmLabel: translate('selfLearningRollback') || 'Rollback',
      danger: false,
    });
    if (confirmed === null) return;
    setRollingBackId(item.id);
    try {
      await run(async () => {
        await props.request('/adaptations/rollback', 'POST', {
          scope: item.scope,
          kind: item.kind,
          name: item.name,
          targetRevision: item.revision - 1,
        });
      }, translate('selfLearningRollbackSuccess') || 'Adaptation rolled back successfully.');
    } finally {
      setRollingBackId(null);
    }
  };

  const handleRetireCheck = async (checkId: string) => {
    setRetiringCheckId(checkId);
    try {
      await run(async () => {
        await props.request(`/adaptations/checks/${encodeURIComponent(checkId)}/retire`, 'POST');
      }, translate('selfLearningRetireCheckSuccess') || 'Check retired successfully.');
    } finally {
      setRetiringCheckId(null);
    }
  };

  const filteredAdaptations = useMemo(() => {
    if (adaptationScopeFilter === 'all') return adaptations;
    return adaptations.filter((item) => item.scope === adaptationScopeFilter);
  }, [adaptations, adaptationScopeFilter]);

  const liveActiveCount = useMemo(() => {
    return adaptations.filter((a) => a.status !== 'retired' && !a.isRetired && !a.trial && a.status !== 'trial' && a.status !== 'tentative').length;
  }, [adaptations]);

  const liveTrialCount = useMemo(() => {
    return adaptations.filter((a) => a.trial || a.status === 'trial' || a.status === 'tentative').length;
  }, [adaptations]);

  const liveRetiredCount = useMemo(() => {
    return adaptations.filter((a) => a.status === 'retired' || a.isRetired).length;
  }, [adaptations]);

  const getAdaptationDisplayName = (item: AdaptationSummaryItem) => {
    if (item.name) return item.name;
    if (item.kind === 'architecture') return translate('selfLearningKindArchitecture') || 'Architecture Guidelines';
    if (item.kind === 'profile') return translate('selfLearningKindProfile') || 'User Preferences';
    if (item.kind === 'workflow') return translate('selfLearningKindWorkflow') || 'Workflow Rules';
    return item.kind;
  };

  const getAdaptationKindBadge = (kind: string) => {
    switch (kind) {
      case 'architecture': return translate('selfLearningBadgeArchitecture') || 'Architecture';
      case 'skill': return translate('selfLearningBadgeSkill') || 'Skill';
      case 'profile': return translate('selfLearningBadgeProfile') || 'Profile';
      case 'workflow': return translate('selfLearningBadgeWorkflow') || 'Workflow';
      case 'role': return translate('selfLearningBadgeRole') || 'Role';
      case 'tool': return translate('selfLearningBadgeTool') || 'Tool';
      case 'hook': return translate('selfLearningBadgeHook') || 'Hook';
      default: return kind.toUpperCase();
    }
  };

  // Section 3b: Self-Learning Adaptations
  const adaptationsSection = (
    <div className="space-y-4">
      <Card>
        <Row
          label={translate('selfLearning') || 'Self-Learning'}
          description={translate('selfLearningDescription') || 'Runtime architecture adapts from experience. Disabling reverts to default architecture.'}
        >
          <Switch
            label={translate('selfLearningEnabled') || 'Self-learning enabled'}
            checked={selfLearningEnabled}
            disabled={disabled}
            onChange={() => void handleToggleSelfLearning(!selfLearningEnabled)}
          />
        </Row>
        {selfLearningEnabled && (
          <Row
            label={translate('selfLearningMaxSkills') || 'Learned Skills Limit'}
            description={translate('selfLearningMaxSkillsDesc') || 'Maximum number of learned skills to retain. Exceeding skills are archived based on value or model replacement.'}
          >
            <input
              type="number"
              min={1}
              max={100}
              value={maxLearnedSkills}
              disabled={disabled}
              onChange={(e) => void handleUpdateMaxSkills(Number(e.target.value))}
              className="w-20 rounded-control border border-line bg-surface px-2.5 py-1 text-right text-[13px] text-ink font-mono focus:border-accent focus:outline-none"
            />
          </Row>
        )}
        {!selfLearningEnabled && (
          <div className="flex items-center gap-2.5 border-t border-line/60 bg-inset/30 px-3.5 py-2.5 text-[11.5px] text-ink-3">
            <CircleHelp className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <p className="min-w-0 flex-1 leading-normal">
              {translate('selfLearningDisabledBanner') || 'Self-learning is currently disabled. Learned adaptations remain on disk but will not take effect.'}
            </p>
          </div>
        )}
      </Card>

      {selfLearningEnabled && userProfile && Array.isArray(userProfile.traits) && userProfile.traits.length > 0 && (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-control bg-accent-tint text-accent">
                <Brain className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-[13.5px] font-medium text-ink">
                {translate('selfLearningUserModel') || 'User Model'}
              </h3>
            </div>
            <span className="text-[11px] font-medium text-ink-3 tabular-nums font-mono">
              {`${userProfile.traits.length} ${translate('selfLearningTraits') || 'Traits'}`}
            </span>
          </div>

          <div className="p-3.5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {userProfile.traits.map((trait: any, idx: number) => {
                const statement = trait.statement || trait.trait || '';
                const dimension = trait.dimension || trait.category || 'trait';
                const confidence = Math.round((trait.confidence ?? 1) * 100);
                const dimLabel =
                  dimension === 'communication'
                    ? (translate('selfLearningDimCommunication') || 'Communication')
                    : dimension === 'coding_style'
                    ? (translate('selfLearningDimCodingStyle') || 'Coding Style')
                    : dimension === 'rigor_and_acceptance'
                    ? (translate('selfLearningDimRigor') || 'Rigor & Testing')
                    : dimension === 'toolchain'
                    ? (translate('selfLearningDimToolchain') || 'Toolchain')
                    : dimension === 'autonomy'
                    ? (translate('selfLearningDimAutonomy') || 'Autonomy')
                    : dimension === 'domain_vocabulary'
                    ? (translate('selfLearningDimDomain') || 'Domain')
                    : (translate('selfLearningTrait') || dimension);

                return (
                  <div
                    key={idx}
                    className="flex flex-col justify-between gap-2 rounded-control bg-inset/40 dark:bg-inset/25 p-3 border border-line/60 transition-colors hover:border-line-strong hover:bg-inset/60"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <ValuePill tone="accent" className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0">
                          {dimLabel}
                        </ValuePill>
                        {trait.userStated && (
                          <ValuePill tone="green" className="text-[10px] px-1.5 py-0">
                            {translate('selfLearningUserStated') || 'User Stated'}
                          </ValuePill>
                        )}
                      </div>
                      <span className="text-[10.5px] font-mono tabular-nums text-ink-3">
                        {`${confidence}%`}
                      </span>
                    </div>

                    <p className="text-[12.5px] text-ink font-medium leading-snug line-clamp-3" title={statement}>
                      {statement}
                    </p>

                    {Array.isArray(trait.evidence) && trait.evidence.length > 0 && (
                      <p className="text-[11px] text-ink-3 truncate" title={trait.evidence.join(' · ')}>
                        {trait.evidence[0]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {Array.isArray(userProfile.predictedFollowUps) && userProfile.predictedFollowUps.length > 0 && (
              <div className="pt-2.5 border-t border-line/60 flex items-center gap-2 flex-wrap">
                <span className="text-[11.5px] font-medium text-ink-3">
                  {`${translate('selfLearningPredictedFollowUps') || 'Predicted Follow-ups'}:`}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {userProfile.predictedFollowUps.map((p: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-chip bg-accent/10 border border-accent/20 px-2 py-0.5 text-[11px] text-accent font-medium"
                    >
                      {p.action || p.intent || p.prediction}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selfLearningEnabled && growthReport && (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-control bg-green-tint text-green">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-[13.5px] font-medium text-ink">
                {translate('selfLearningGrowthTrend') || 'Growth Trend'}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {typeof growthReport.adaptationSuccessRate === 'number' && (growthReport.totalEvaluatedRuns ?? 0) > 0 ? (
                <ValuePill tone="green" className="text-[11px]">
                  {(translate('selfLearningWinRate') || 'Success: {rate}%').replace(
                    '{rate}',
                    String(Math.round(growthReport.adaptationSuccessRate * 100)),
                  )}
                </ValuePill>
              ) : (
                <ValuePill tone="neutral" className="text-[11px]">
                  {translate('selfLearningNoEvaluations') || 'No evaluations yet'}
                </ValuePill>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-ink-3 hover:text-ink cursor-pointer"
                title={translate('selfLearningRefresh') || 'Refresh'}
                disabled={refreshingSelfLearning}
                onClick={() => void loadAdaptations(true)}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingSelfLearning ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="px-4 pt-2.5 pb-0.5">
            <p className="text-[12px] text-ink-3 leading-relaxed">
              {translate('selfLearningGrowthDesc') || 'Real-time evaluation of adaptation effectiveness in tasks and continuous optimization.'}
            </p>
          </div>

          <div className="p-3.5 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="flex flex-col items-center justify-center rounded-control bg-inset/40 dark:bg-inset/25 py-2.5 px-3 border border-line/50 transition-colors">
                <span className="text-[10.5px] font-medium text-ink-3 uppercase tracking-wider">
                  {translate('selfLearningTotalRuns') || 'Total Runs'}
                </span>
                <span className="mt-1 font-semibold text-[17px] tabular-nums text-ink">
                  {growthReport.totalEvaluatedRuns ?? 0}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-control bg-inset/40 dark:bg-inset/25 py-2.5 px-3 border border-line/50 transition-colors">
                <span className="text-[10.5px] font-medium text-ink-3 uppercase tracking-wider">
                  {translate('selfLearningActive') || 'Active'}
                </span>
                <span className="mt-1 font-semibold text-[17px] tabular-nums text-green">
                  {typeof growthReport.activeCount === 'number' && growthReport.activeCount > 0
                    ? growthReport.activeCount
                    : liveActiveCount}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-control bg-inset/40 dark:bg-inset/25 py-2.5 px-3 border border-line/50 transition-colors">
                <span className="text-[10.5px] font-medium text-ink-3 uppercase tracking-wider">
                  {translate('selfLearningTrial') || 'Trial'}
                </span>
                <span className="mt-1 font-semibold text-[17px] tabular-nums text-orange">
                  {typeof growthReport.trialCount === 'number' && growthReport.trialCount > 0
                    ? growthReport.trialCount
                    : liveTrialCount}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-control bg-inset/40 dark:bg-inset/25 py-2.5 px-3 border border-line/50 transition-colors">
                <span className="text-[10.5px] font-medium text-ink-3 uppercase tracking-wider">
                  {translate('selfLearningRetired') || 'Retired'}
                </span>
                <span className="mt-1 font-semibold text-[17px] tabular-nums text-ink-3">
                  {typeof growthReport.retiredCount === 'number' && growthReport.retiredCount > 0
                    ? growthReport.retiredCount
                    : liveRetiredCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <h3 className="text-[14px] font-semibold text-ink">
          {`${translate('learnedAdaptations') || 'Learned Adaptations'} (${filteredAdaptations.length})`}
        </h3>
        <div className="flex items-center gap-0.5 rounded-chip bg-field p-0.5 border border-line">
          {(['all', 'project', 'user'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAdaptationScopeFilter(s)}
              className={`rounded-chip px-2.5 py-1 text-[11px] font-medium transition-all duration-150 outline-none focus:outline-none focus-visible:outline-none select-none active:scale-[0.97] ${
                adaptationScopeFilter === s
                  ? 'bg-surface text-ink shadow-xs ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-ink-3 hover:text-ink hover:bg-hover-2'
              }`}
            >
              {s === 'all'
                ? (translate('selfLearningScopeAll') || 'All')
                : s === 'project'
                ? (translate('selfLearningScopeProject') || 'Project')
                : (translate('selfLearningScopeUser') || 'User')}
            </button>
          ))}
        </div>
      </div>

      {filteredAdaptations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-inset/30 dark:bg-surface/30 py-10 px-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-xs border border-line/60 mb-3 text-ink-3">
            <SlidersHorizontal className="h-4 w-4 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="text-[13.5px] font-semibold text-ink-2">
            {translate('selfLearningEmpty') || 'No adaptations recorded yet.'}
          </p>
          <p className="mt-1.5 max-w-md text-[12px] text-ink-3 leading-relaxed">
            {translate('selfLearningEmptyHint') || 'Metis learns adaptations from task outcomes, corrections, and user preferences automatically when self-learning is enabled.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredAdaptations.map((item) => {
            const isRollingBack = rollingBackId === item.id;
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-card bg-surface shadow-card border border-line/40 transition-colors hover:border-line"
              >
                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-[13.5px] font-medium text-ink truncate">
                        {getAdaptationDisplayName(item)}
                      </span>
                      <ValuePill tone="accent" className="text-[10.5px] font-medium">
                        {getAdaptationKindBadge(item.kind)}
                      </ValuePill>
                      <ValuePill className="text-[10.5px]">
                        {item.scope === 'project' ? (translate('selfLearningScopeProject') || 'Project') : (translate('selfLearningScopeUser') || 'User')}
                      </ValuePill>
                      <ValuePill className="text-[10.5px]">{`Rev ${item.revision}`}</ValuePill>
                      {item.trial && (
                        <ValuePill tone="orange" className="text-[10.5px] font-semibold">
                          {translate('selfLearningTrial') || 'Trial'}
                        </ValuePill>
                      )}
                      {item.status && item.status !== 'active' && (
                        <Status tone={item.status === 'retired' ? 'neutral' : 'warning'}>
                          {item.status === 'retired' ? (translate('selfLearningRetired') || 'Retired') : item.status}
                        </Status>
                      )}
                      {!selfLearningEnabled && (
                        <Status tone="neutral">{translate('notApplied') || 'Not Applied'}</Status>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={disabled || Boolean(rollingBackId) || item.revision <= 1}
                        title={item.revision <= 1 ? (translate('noPreviousRevision') || 'No previous revision') : (translate('selfLearningRollback') || 'Rollback')}
                        onClick={() => void handleRollbackAdaptation(item)}
                      >
                        {isRollingBack ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        <span>{translate('selfLearningRollback') || 'Rollback'}</span>
                      </Button>
                    </div>
                  </div>

                  {(item.description || item.reason) && (
                    <p className="text-[12px] text-ink-2 leading-relaxed font-normal">
                      {item.description || item.reason}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 text-[11.5px] text-ink-3 flex-wrap pt-0.5 border-t border-line/40">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="tabular-nums">
                        {(translate('selfLearningAppliedCount') || 'Applied: {count} times').replace('{count}', String(item.appliedCount ?? 0))}
                      </span>
                      {(item.helped !== undefined || item.hurt !== undefined) && (
                        <span className="text-ink-2 font-mono text-[10.5px] tabular-nums">
                          {(translate('selfLearningHelpedHurt') || 'Helped: {helped} · Hurt: {hurt}')
                            .replace('{helped}', String(item.helped ?? 0))
                            .replace('{hurt}', String(item.hurt ?? 0))}
                        </span>
                      )}
                      {item.lastOutcome && (
                        <span className="flex items-center gap-1.5">
                          <span>{`${translate('selfLearningLastOutcome') || 'Last outcome'}:`}</span>
                          <Status tone={item.lastOutcome === 'success' ? 'success' : 'danger'}>
                            {item.lastOutcome}
                          </Status>
                        </span>
                      )}
                      {(item.recurredCorrections ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-ink-2 tabular-nums">
                          {(translate('selfLearningRecurringCorrections') || 'Recurring corrections: {count}').replace('{count}', String(item.recurredCorrections))}
                        </span>
                      )}
                    </div>
                    <span className="truncate max-w-[220px] font-mono text-[10.5px] text-ink-3/70 hover:text-ink-2 transition-colors cursor-default" title={item.filePath}>
                      {item.filePath.replace(/^\/Users\/[^/]+/, '~')}
                    </span>
                  </div>

                  {Array.isArray(item.pendingChecks) && item.pendingChecks.length > 0 && (
                    <div className="rounded-control bg-inset/40 dark:bg-inset/25 p-2.5 space-y-1.5 border border-line/60">
                      <div className="text-[11.5px] font-medium text-ink-2">
                        {`${translate('selfLearningPendingChecks') || 'Pending checks'}:`}
                      </div>
                      <div className="space-y-1">
                        {item.pendingChecks.map((checkId) => (
                          <div key={checkId} className="flex items-center justify-between text-[11.5px]">
                            <span className="font-mono text-ink-3 truncate mr-2">{checkId}</span>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={disabled || retiringCheckId === checkId}
                              onClick={() => void handleRetireCheck(checkId)}
                            >
                              {retiringCheckId === checkId ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                              <span>{translate('selfLearningRetireCheck') || 'Retire Check'}</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Section 4: Workspace & Server (Connection, Workspace, Trust)
  const server = (
    <div className="space-y-3">
        <Card>
          <Row label="Connection status" description={String(workspace.path || props.activeProject?.path || 'No workspace selected')}>
            <Status tone={props.isConnected ? 'success' : 'danger'}>
              <i className={`h-1.5 w-1.5 rounded-full ${props.isConnected ? 'bg-green' : 'bg-red'}`} />
              {props.isConnected ? 'Connected' : 'Disconnected'}
            </Status>
          </Row>
          <Row label="Server configuration" description="Configure address and optional authentication." stacked>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_110px_auto]">
              <input id="serverUrlInput" className={controlClass} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label="Server address" />
              <input className={controlClass} value={serverUsername} onChange={(e) => setServerUsername(e.target.value)} aria-label="Server username" />
              <input className={controlClass} value={serverPassword} onChange={(e) => { setServerPassword(e.target.value); setServerPasswordChanged(true); }} type="password" placeholder={serverHasPassword ? 'Password set; edit to replace or clear' : 'Password'} aria-label="Server password" />
              <Button type="button" id="connectServerButton" variant="secondary" size="sm" disabled={connectionDisabled || !serverUrl.trim()} onClick={() => void run(async () => { const connected = await props.onConnectServer({ baseUrl: serverUrl.trim(), username: serverUsername.trim() || 'metis', ...(serverPasswordChanged ? { password: serverPassword } : {}) }); if (!connected) throw new Error('Unable to connect to the Metis Server'); setServerPassword(''); setServerPasswordChanged(false); return true; }, 'Server connected.')}>
                <CloudCog className="h-3.5 w-3.5" />Connect
              </Button>
            </div>
          </Row>
        </Card>
        <Card>
          <Row label="Workspace" description={String(props.activeProject?.path || workspace.path || '—')}>
            <Button type="button" variant="secondary" size="sm" disabled={connectionDisabled} onClick={() => void run(props.onChangeWorkspace, 'Workspace changed.')}>
              <FolderCog className="h-3.5 w-3.5" />Change…
            </Button>
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
  );

  // Section 5: Data & About (Session data, Import/Export/Share, Version, Updates, Maintenance)
  const about = (
    <div className="space-y-3">
        <Card>
          <Row label="Session name" description="Shown in the conversation list." stacked>
            <div className="flex w-full gap-2">
              <input className={`${controlClass} min-w-0 flex-1`} value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="Session name" />
              <Button type="button" variant="secondary" size="sm" disabled={disabled || !sessionName.trim()} onClick={() => void run(() => props.request('/session/name', 'PUT', { name: sessionName.trim() }), 'Session name saved.')}>
                <Save className="h-3.5 w-3.5" />Save
              </Button>
            </div>
          </Row>
          <Row label="New session" description="Keep this session and begin a new empty task.">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(async () => { const created = await props.onNewSession(); if (!created) throw new Error('Unable to create a new session'); return true; }, 'New session created.')}>
              <Plus className="h-3.5 w-3.5" />Create
            </Button>
          </Row>
          <Row label="Export session" description="HTML is readable; JSONL can be resumed.">
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(() => exportSession('html'), 'Session exported as HTML.')}>
                <Download className="h-3.5 w-3.5" />HTML
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(() => exportSession('jsonl'), 'Session exported as JSONL.')}>
                <Download className="h-3.5 w-3.5" />JSONL
              </Button>
            </div>
          </Row>
          <Row label="Import session" description="Create and switch to a session from JSONL.">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(async () => { const file = await requireDesktop(desktop?.sessionFile?.open ? () => desktop.sessionFile.open() : undefined, 'Session import'); if (!file) return false; const result = await command(`/import ${file}`, 10 * 60_000); return result.cancelled !== true; }, 'Session imported.')}>
              <Upload className="h-3.5 w-3.5" />Choose file…
            </Button>
          </Row>
          <Row label="Share session" description="Create a private GitHub Gist link.">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(async () => { const result = await command('/share', 2 * 60_000); if (!result.url) throw new Error('Server did not return a share link'); await requireDesktop(desktop?.openExternal ? () => desktop.openExternal(result.url) : undefined, 'Open share link'); }, 'Share link created.')}>
              <ChevronRight className="h-3.5 w-3.5" />Create link
            </Button>
          </Row>
        </Card>
        <Card>
          <Row
            label={translate('Archived conversations')}
            description={translate('Hidden from the sidebar. Restore them here, or delete permanently.')}
            stacked
          >
            {(props.archivedSessions?.length ?? 0) === 0 ? (
              <p className="text-[12.5px] text-ink-3" data-archived-sessions-empty="">
                {translate('No archived conversations')}
              </p>
            ) : (
              <ul className="max-h-48 w-full space-y-1 overflow-y-auto scrollbar-none" data-archived-sessions-list="">
                {(props.archivedSessions ?? []).map((item) => {
                  const isDeleting = deletingArchivedId === item.id;
                  return (
                  <li
                    key={item.id}
                    data-archived-session-row={item.id}
                    className="flex min-h-[40px] items-center justify-between gap-3 rounded-control px-2 py-1.5 hover:bg-hover-2"
                  >
                    <p className="min-w-0 truncate text-[13px] font-medium text-ink">{item.name}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className={iconButtonClass}
                        disabled={Boolean(deletingArchivedId)}
                        title={translate('Restore conversation')}
                        aria-label={translate('Restore conversation')}
                        data-restore-archived-session=""
                        onClick={() => {
                          props.onRestoreArchivedSession?.(item.id);
                          setFeedback(translate('Conversation restored.'));
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={dangerIconButtonClass}
                        disabled={disabled || Boolean(deletingArchivedId)}
                        title={translate('Delete permanently')}
                        aria-label={translate('Delete permanently')}
                        data-delete-archived-session=""
                        onClick={() => void (async () => {
                          const confirmed = await requestApproval({
                            title: translate('Delete permanently'),
                            message: translate('This permanently deletes the conversation file. This cannot be undone.'),
                            confirmLabel: translate('Delete permanently'),
                            danger: true,
                          });
                          if (confirmed === null) return;
                          if (!props.onDeleteArchivedSession) {
                            setError('Delete handler unavailable');
                            return;
                          }
                          setDeletingArchivedId(item.id);
                          setError('');
                          try {
                            await props.onDeleteArchivedSession(item.id);
                            setFeedback(translate('Conversation deleted permanently.'));
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : String(cause));
                          } finally {
                            setDeletingArchivedId(null);
                          }
                        })()}
                      >
                        {isDeleting
                          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </Row>
        </Card>
        <Card>
          <Row label="Metis Desktop" description={`Version ${appInfo.version || '—'} · ${appInfo.platform || '—'}`}>
            <Status>{appInfo.name || 'Metis'}</Status>
          </Row>
          <Row label="Software update" description={updateDescription}>
            <div className="flex items-center gap-2">
              {updateStatus}
              <Button type="button" variant="secondary" size="sm" disabled={desktopDisabled || updateCheck.status === 'checking'} onClick={() => void props.onCheckForUpdates()}>
                <RefreshCw className={`h-3.5 w-3.5 ${updateCheck.status === 'checking' ? 'animate-spin' : ''}`} />Check for updates
              </Button>
              {updateCheck.status === 'available' && (
                <Button type="button" variant="secondary" size="sm" disabled={desktopDisabled} onClick={() => void run(() => requireDesktop(desktop?.openExternal ? () => desktop.openExternal(RELEASES_URL) : undefined, 'Open releases page'), 'Opened the GitHub Releases page.')}>
                  <Download className="h-3.5 w-3.5" />Download
                </Button>
              )}
            </div>
          </Row>
        </Card>
        <Card>
          <Row label="Reload Agent resources" description="Reload extensions, Skills, themes and models.">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void run(() => command('/reload'), 'Agent resources reloaded.')}>
              <RefreshCw className="h-3.5 w-3.5" />Reload
            </Button>
          </Row>
        </Card>
      </div>
  );

  const sections: Record<SettingsTab, React.ReactNode> = {
    general,
    model,
    agent,
    adaptations: adaptationsSection,
    server,
    about,
  };

  // Search index definition
  const searchItems = useMemo(() => [
    { id: 'language', tab: 'general' as SettingsTab, title: 'Language', desc: 'Applied to Desktop immediately and synchronized to Agent while connected.', keywords: 'interface language 语言 界面 简体中文 english' },
    { id: 'onboarding', tab: 'general' as SettingsTab, title: 'Onboarding', desc: 'Reopen the welcome and setup spotlight shown on first launch.', keywords: 'welcome guide onboarding 新手 引导 欢迎' },
    { id: 'shortcuts', tab: 'general' as SettingsTab, title: 'Keyboard shortcuts', desc: 'Common Desktop actions. Native text-editing shortcuts continue to work while typing.', keywords: 'hotkeys shortcuts 快捷键 键盘' },
    { id: 'custom-models', tab: 'model' as SettingsTab, title: 'Custom Models', desc: 'Manage local custom model configurations written to models.json.', keywords: 'custom model models.json openai token plan coding plan 自定义 模型 接口 服务商 本地配置' },
    { id: 'add-model', tab: 'model' as SettingsTab, title: 'Add Model', desc: 'Add OpenAI-compatible custom model providers and plans.', keywords: 'add model new provider preset token plan coding plan 添加模型' },
    { id: 'collaboration-mode', tab: 'agent' as SettingsTab, title: 'Collaboration mode', desc: 'Plan uses read-only tools. Build can make changes; neither mode is an OS sandbox.', keywords: 'collaboration mode plan build 协作模式 计划 构建' },
    { id: 'self-learning', tab: 'adaptations' as SettingsTab, title: 'Self-Learning', desc: 'Runtime architecture adapts from experience. Disabling reverts to default architecture.', keywords: 'self learning adaptation 自我学习 适配 架构 工作流 角色 技能' },
    { id: 'adaptations-list', tab: 'adaptations' as SettingsTab, title: 'Learned Adaptations', desc: 'Inspect, manage, and rollback learned profiles, skills, roles, tools, and hooks.', keywords: 'learned adaptations rollback 回滚 适配列表 检查项 淘汰' },
    { id: 'steering-messages', tab: 'agent' as SettingsTab, title: 'Steering messages', desc: 'How Agent receives instructions while working.', keywords: 'steering queue message 转向 指导 消息' },
    { id: 'follow-up-messages', tab: 'agent' as SettingsTab, title: 'Follow-up messages', desc: 'How Agent handles queued messages after it completes.', keywords: 'follow up queue message 排队 消息' },
    { id: 'auto-retry', tab: 'agent' as SettingsTab, title: 'Automatic retry', desc: 'Retry transient model and transport failures.', keywords: 'auto retry 自动重试 重试' },
    { id: 'auto-compact', tab: 'agent' as SettingsTab, title: 'Auto-compact context', desc: 'Consolidate the current session as it approaches its context limit.', keywords: 'auto compact context 上下文 自动压缩 压缩' },
    { id: 'compact-now', tab: 'agent' as SettingsTab, title: 'Compact now', desc: 'Consolidate the current session without changing auto-compact.', keywords: 'compact now 手动压缩 立即压缩' },
    { id: 'instruction-sources', tab: 'agent' as SettingsTab, title: 'Instruction sources', desc: 'The active session’s trusted context and instruction sources.', keywords: 'instruction prompt source 指令源' },
    { id: 'server-connection', tab: 'server' as SettingsTab, title: 'Server configuration', desc: 'Configure address and optional authentication.', keywords: 'server connection url username password 服务端 连接' },
    { id: 'workspace', tab: 'server' as SettingsTab, title: 'Workspace', desc: 'Manage Desktop connection and the workspace used by the active session.', keywords: 'workspace folder project 工作区 目录 项目' },
    { id: 'project-trust', tab: 'server' as SettingsTab, title: 'Current project trust', desc: 'Controls loading of project resources, not Server network access.', keywords: 'trust security permissions 信任 安全 权限' },
    { id: 'session-name', tab: 'about' as SettingsTab, title: 'Session name', desc: 'Shown in the conversation list.', keywords: 'session name rename 会话 名称 改名' },
    { id: 'export-session', tab: 'about' as SettingsTab, title: 'Export session', desc: 'HTML is readable; JSONL can be resumed.', keywords: 'export html jsonl 导出 会话' },
    { id: 'import-session', tab: 'about' as SettingsTab, title: 'Import session', desc: 'Create and switch to a session from JSONL.', keywords: 'import 导入 会话' },
    { id: 'share-session', tab: 'about' as SettingsTab, title: 'Share session', desc: 'Create a private GitHub Gist link.', keywords: 'share gist 分享 链接' },
    { id: 'archived-conversations', tab: 'about' as SettingsTab, title: 'Archived conversations', desc: 'Hidden from the sidebar. Restore them here, or delete permanently.', keywords: 'archive restore delete 归档 恢复 删除 隐藏' },
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

  const activeTabItem = tabs.find((t) => t.id === tab);
  const currentTabTitle = activeTabItem ? translate(activeTabItem.label) : translate('Settings');

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/30 p-5 backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex h-[min(680px,calc(100dvh-40px))] w-[min(920px,calc(100vw-40px))] overflow-hidden rounded-window bg-surface shadow-overlay">
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-line bg-canvas px-3 pb-3 pt-6 sm:pt-7 select-none">
          <div className="mb-3.5 px-1 flex items-center h-6">
            <h1 id="settings-title" className="text-balance text-[16px] font-semibold tracking-[-0.01em] text-ink leading-6">Settings</h1>
          </div>
          <div className="pb-2.5 flex-shrink-0">
            <div className="relative flex h-9 w-full items-center rounded-chip bg-field px-2.5 transition-all focus-within:bg-surface focus-within:shadow-btn focus-within:ring-2 focus-within:ring-[color:var(--focus)]">
              <Search className="w-4 h-4 text-ink-3 mr-2 flex-shrink-0" />
              <input
                type="text"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                placeholder={translate('Search settings…')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search settings…"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 text-ink-3 hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Settings sections">
            <GlideMenu highlightClassName="inset-x-0 rounded-[8px] bg-hover-2" className="flex flex-col gap-px">
              {tabs.map((item) => {
                const matchCount = searchResultsByTab.get(item.id) || 0;
                const isActive = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-menu-row=""
                    data-settings-panel={item.id}
                    onClick={() => handleTabChange(item.id)}
                    className={`relative z-10 flex w-full min-h-[38px] items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left transition-[color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                      isActive ? 'font-medium text-ink' : 'text-ink-2'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-ink' : 'text-ink-3'}`} />
                      <span className="truncate text-[13.5px]">{item.label}</span>
                    </span>
                    {searchQuery && matchCount > 0 ? (
                      <ValuePill className="h-4 min-w-4 justify-center px-1.5 text-[10.5px]">{matchCount}</ValuePill>
                    ) : null}
                  </button>
                );
              })}
            </GlideMenu>
          </nav>
          <p className="px-1 pt-2 text-[11px] text-ink-3 dark:text-ink-3">{appInfo.version ? `v${appInfo.version}` : 'Loading version…'}</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-inset/30 dark:bg-page">
          <header
            className={`flex shrink-0 items-center justify-between px-6 pt-6 pb-3.5 sm:px-7 sm:pt-7 sm:pb-3.5 transition-[border-color,box-shadow,background-color] duration-150 z-10 ${
              isScrolled
                ? 'border-b border-line bg-surface shadow-hairline'
                : 'border-b border-transparent bg-transparent'
            }`}
          >
            <div className="flex h-6 min-w-0 items-center">
              <h2 className="text-balance text-[16px] font-semibold tracking-[-0.01em] text-ink leading-6 truncate">
                {currentTabTitle}
              </h2>
            </div>
            <div className="flex h-6 items-center">
              <button
                type="button"
                className={`${iconButtonClass} -mr-1`}
                onClick={props.onClose}
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>
          <main
            ref={mainScrollRef}
            onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 0)}
            className="relative min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-2 sm:px-7 sm:pb-7 sm:pt-2"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-[14px] text-ink-3">
                <LoaderCircle className="h-4 w-4 animate-spin" />Loading settings…
              </div>
            ) : searchQuery && searchResults.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <CircleHelp className="h-8 w-8 text-ink-2 dark:text-ink-2" />
                <p className="mt-3 text-[14px] font-medium text-ink-2">No matching settings</p>
                <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => { setSearchQuery(''); if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0; setIsScrolled(false); }}>Clear search</Button>
              </div>
            ) : searchQuery ? (
              <div>
                <SectionHeading title="Search results" description={`${searchResults.length} ${translate('searchResults')}: “${searchQuery}”`} />
                <Card>
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => { handleTabChange(item.tab); setSearchQuery(''); }}
                      className="flex cursor-pointer items-center justify-between rounded-control px-3.5 py-2.5 transition-colors hover:bg-hover-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-medium text-ink">{item.title}</span>
                          <ValuePill className="text-[10.5px]">
                            {tabs.find((t) => t.id === item.tab)?.label}
                          </ValuePill>
                        </div>
                        <p className="mt-0.5 text-pretty text-[12px] leading-5 text-ink-3">{item.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
                    </div>
                  ))}
                </Card>
              </div>
            ) : (
              sections[tab]
            )}
            {(feedback || error) && (
              <div role={error ? 'alert' : 'status'} className={`sticky bottom-0 mt-5 rounded-control border px-3 py-2 text-[12px] ${error ? 'border-red/30 bg-red-tint text-red' : 'border-green/30 bg-green-tint text-green'}`}>
                {error || feedback}
              </div>
            )}
          </main>
        </div>
      </section>
      <ApprovalDialog
        open={Boolean(approval)}
        title={approval?.title || ''}
        message={approval?.message || ''}
        inputLabel={approval?.inputLabel}
        confirmLabel={approval?.confirmLabel || 'Continue'}
        cancelLabel={translate('Cancel')}
        danger={approval?.danger}
        onCancel={() => closeApproval(null)}
        onConfirm={(value) => closeApproval(value || 'approved')}
      />
    </div>
  );
}
