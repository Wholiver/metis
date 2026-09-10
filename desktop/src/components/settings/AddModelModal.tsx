import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, ChevronDown, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, Search, X } from 'lucide-react';
import type { ProviderCatalogEntry } from '../../types';

type AddModelModalProps = {
  open: boolean;
  providers: ProviderCatalogEntry[];
  onClose: () => void;
  onSave: (config: { name: string; baseUrl: string; apiKey?: string; modelIds?: string[] }) => Promise<void>;
  onApiKeyLogin: (providerId: string, apiKey: string) => Promise<void>;
  onOAuthLogin: (providerId: string) => Promise<void>;
  onDiscoverModels?: (options: { baseUrl: string; apiKey?: string }) => Promise<any>;
  translate: (value: string, variables?: Record<string, string | number>) => string;
};

type AuthMethod = 'api_key' | 'oauth';
const CUSTOM_PROVIDER_ID = '__custom__';

export function AddModelModal({ open, providers, onClose, onSave, onApiKeyLogin, onOAuthLogin, translate }: AddModelModalProps) {
  const [selectedProviderId, setSelectedProviderId] = useState('openai');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('api_key');
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId]
  );
  const isCustom = selectedProviderId === CUSTOM_PROVIDER_ID;
  const supportsOAuth = Boolean(currentProvider?.authMethods.includes('oauth'));
  const supportsApiKey = Boolean(currentProvider?.authMethods.includes('api_key'));

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
    setShowApiKey(false);
    setProviderDropdownOpen(false);
    setProviderSearchQuery('');
  }, [open]);

  useEffect(() => {
    if (isCustom || currentProvider) return;
    setSelectedProviderId(providers.find((provider) => provider.id === 'openai')?.id ?? providers[0]?.id ?? CUSTOM_PROVIDER_ID);
  }, [currentProvider, isCustom, providers]);

  useEffect(() => {
    if (isCustom) {
      setAuthMethod('api_key');
      return;
    }
    if (supportsOAuth && !supportsApiKey) setAuthMethod('oauth');
    else if (supportsApiKey && !supportsOAuth) setAuthMethod('api_key');
    else if (!currentProvider?.authMethods.includes(authMethod)) setAuthMethod('oauth');
  }, [authMethod, currentProvider, isCustom, supportsApiKey, supportsOAuth]);

  useEffect(() => {
    if (!providerDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setProviderDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [providerDropdownOpen]);

  const filteredProviders = useMemo(() => {
    const query = providerSearchQuery.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((provider) => provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query));
  }, [providerSearchQuery, providers]);

  const providerGroups = useMemo(() => ({
    OAuth: filteredProviders.filter((provider) => provider.authMethods.includes('oauth')),
    'API Key': filteredProviders.filter((provider) => !provider.authMethods.includes('oauth')),
  }), [filteredProviders]);

  const selectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setProviderDropdownOpen(false);
    setProviderSearchQuery('');
    setApiKey('');
    setError('');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isCustom) {
        const name = customName.trim();
        const baseUrl = customBaseUrl.trim();
        if (!name) throw new Error(translate('Provider name is required'));
        if (!baseUrl) throw new Error(translate('Base URL is required'));
        await onSave({
          name,
          baseUrl,
          apiKey: apiKey.trim() || undefined,
          modelIds: customModelInput.split(',').map((value) => value.trim()).filter(Boolean),
        });
      } else if (currentProvider && authMethod === 'oauth') {
        await onOAuthLogin(currentProvider.id);
      } else if (currentProvider) {
        const key = apiKey.trim();
        if (!key) throw new Error(translate('API Key is required'));
        await onApiKeyLogin(currentProvider.id, key);
      } else {
        throw new Error(translate('Provider is required'));
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const currentName = isCustom ? translate('Custom OpenAI-compatible provider') : currentProvider?.name ?? translate('Select Provider');
  const controlClass = 'h-10 w-full rounded-chip border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';
  const submitLabel = isCustom ? translate('Save') : authMethod === 'oauth' ? translate('Sign in') : translate('Save API Key');

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-model-title" className="w-[min(540px,calc(100vw-32px))] rounded-[12px] border border-line bg-surface shadow-overlay">
        <div className="flex items-center justify-between border-b border-line px-6 py-4 rounded-t-[12px]">
          <h2 id="add-model-title" className="text-[16px] font-bold text-ink">{translate('Add Model')}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="flex h-10 w-10 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover-2 dark:hover:bg-hover hover:text-ink" aria-label={translate('Close')}><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-6 rounded-b-[12px]">
          <div className="space-y-1.5" ref={dropdownRef}>
            <label className="text-[14px] font-medium text-ink-2">{translate('Provider')}</label>
            <div className="relative">
              <button type="button" onClick={() => setProviderDropdownOpen((value) => !value)} className={`flex h-10 w-full items-center justify-between rounded-chip border bg-surface px-3 text-left text-[14px] text-ink transition-all hover:bg-hover dark:hover:bg-hover focus:ring-2 focus:ring-[color:var(--focus)] ${providerDropdownOpen ? 'border-line-strong ring-2 ring-[color:var(--focus)]' : 'border-line'}`} aria-expanded={providerDropdownOpen}>
                <span className="flex min-w-0 items-center gap-2">
                  {isCustom ? <Box className="h-4 w-4 shrink-0 text-ink-3" /> : supportsOAuth ? <LogIn className="h-4 w-4 shrink-0 text-accent" /> : <KeyRound className="h-4 w-4 shrink-0 text-orange" />}
                  <span className="truncate">{currentName}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
              </button>

              {providerDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-control border border-line bg-surface shadow-overlay">
                  <div className="border-b border-line bg-inset p-2">
                    <div className="relative flex items-center">
                      <Search className="absolute left-2.5 h-3.5 w-3.5 text-ink-3" />
                      <input type="text" autoFocus value={providerSearchQuery} onChange={(event) => setProviderSearchQuery(event.target.value)} placeholder={translate('Search provider…')} className="h-10 w-full rounded-chip border border-line bg-surface pl-8 pr-3 text-[12.5px] text-ink outline-none focus:border-line-strong dark:focus:border-line-strong focus:ring-1 focus:ring-[color:var(--focus)]" />
                    </div>
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto py-1">
                    {Object.entries(providerGroups).map(([group, items]) => items.length > 0 && (
                      <div key={group} className="space-y-0.5">
                        <div className="px-3 py-1 text-[11px] font-semibold text-ink-3">{translate(group)}</div>
                        {items.map((provider) => (
                          <button key={provider.id} type="button" onClick={() => selectProvider(provider.id)} className={`flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors ${provider.id === selectedProviderId ? 'bg-accent-tint font-medium text-accent-ink' : 'text-ink-2 hover:bg-hover'}`}>
                            <span className="flex min-w-0 items-center gap-2">
                              {provider.authMethods.includes('oauth') ? <LogIn className="h-4 w-4 shrink-0 text-accent" /> : <KeyRound className="h-4 w-4 shrink-0 text-orange" />}
                              <span className="truncate">{provider.name}</span>
                            </span>
                            {provider.id === selectedProviderId && <Check className="h-3.5 w-3.5 shrink-0 text-green" />}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="space-y-0.5">
                      <div className="px-3 py-1 text-[11px] font-semibold text-ink-3">{translate('Custom')}</div>
                      <button type="button" onClick={() => selectProvider(CUSTOM_PROVIDER_ID)} className={`flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors ${isCustom ? 'bg-accent-tint font-medium text-accent-ink' : 'text-ink-2 hover:bg-hover'}`}>
                        <span className="flex min-w-0 items-center gap-2"><Box className="h-4 w-4 shrink-0 text-ink-3" /><span className="truncate">{translate('Custom OpenAI-compatible provider')}</span></span>
                        {isCustom && <Check className="h-3.5 w-3.5 shrink-0 text-green" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {!isCustom && currentProvider?.baseUrl && <p className="truncate text-[11.5px] text-ink-3" title={currentProvider.baseUrl}>{currentProvider.baseUrl}</p>}
          </div>

          {!isCustom && supportsOAuth && supportsApiKey && (
            <div className="space-y-1.5">
              <label className="text-[14px] font-medium text-ink-2">{translate('Method')}</label>
              <div className="grid grid-cols-2 gap-2 rounded-control bg-hover-2 p-1">
                {(['oauth', 'api_key'] as const).map((method) => (
                  <button key={method} type="button" onClick={() => setAuthMethod(method)} className={`h-10 rounded-chip text-[12.5px] font-medium transition-colors ${authMethod === method ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink'}`}>
                    {method === 'oauth' ? translate('OAuth') : translate('API Key')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCustom && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><label className="text-[14px] font-medium text-ink-2">{translate('Provider name')}</label><input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder={translate('e.g. My Custom API')} className={controlClass} /></div>
              <div className="space-y-1.5"><label className="text-[14px] font-medium text-ink-2">{translate('Base URL')}</label><input value={customBaseUrl} onChange={(event) => setCustomBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className={controlClass} /></div>
            </div>
          )}

          {(isCustom || authMethod === 'api_key') && (
            <div className="space-y-1.5">
              <label className="text-[14px] font-medium text-ink-2">{translate('API Key')}</label>
              <div className="relative flex items-center">
                <input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={translate('Enter your API Key')} autoComplete="off" className={`${controlClass} pr-11`} />
                <button type="button" onClick={() => setShowApiKey((value) => !value)} className="absolute right-1 flex h-10 w-10 items-center justify-center text-ink-3 transition-colors hover:text-ink" aria-label={showApiKey ? translate('Hide API key') : translate('Show API key')}>{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
          )}

          {isCustom && <div className="space-y-1.5"><label className="text-[14px] font-medium text-ink-2">{translate('Model IDs, separated by commas')}</label><input value={customModelInput} onChange={(event) => setCustomModelInput(event.target.value)} placeholder={translate('Model IDs, separated by commas')} className={controlClass} /></div>}

          {!isCustom && authMethod === 'oauth' && <div className="rounded-control border border-accent/30 bg-accent-tint px-3 py-2.5 text-[12.5px] leading-5 text-accent-ink">{translate('Authorize a subscription account without an API key.')}</div>}
          {error && <div className="rounded-chip border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">{error}</div>}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-chip border border-line bg-surface px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-hover disabled:opacity-50">{translate('Cancel')}</button>
            <button type="submit" disabled={saving || (!isCustom && !currentProvider)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-chip bg-ink dark:bg-accent px-5 text-[14px] font-medium text-white shadow-btn transition-colors hover:opacity-90 dark:hover:bg-accent-ink disabled:opacity-50">{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}<span>{submitLabel}</span></button>
          </div>
        </form>
      </div>
    </div>
  );
}
