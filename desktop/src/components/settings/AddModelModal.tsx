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
  const controlClass = 'h-10 w-full rounded-[6px] border border-slate-200 dark:border-[#2b303c] bg-white dark:bg-[#1c2027] px-3 text-[13px] text-slate-800 dark:text-slate-200 outline-none transition-[border-color,box-shadow] focus:border-slate-400 dark:focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50 dark:focus:ring-slate-700/50 disabled:cursor-not-allowed disabled:opacity-50';
  const submitLabel = isCustom ? translate('Save') : authMethod === 'oauth' ? translate('Sign in') : translate('Save API Key');

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 dark:bg-black/60 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-model-title" className="w-[min(540px,calc(100vw-32px))] rounded-[12px] border border-slate-200/90 dark:border-[#272b36] bg-white dark:bg-[#1a1d24] shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#272b36] px-6 py-4 rounded-t-[12px]">
          <h2 id="add-model-title" className="text-[16px] font-bold text-slate-900 dark:text-slate-100">{translate('Add Model')}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="flex h-10 w-10 items-center justify-center rounded-[6px] text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-200" aria-label={translate('Close')}><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-6 rounded-b-[12px]">
          <div className="space-y-1.5" ref={dropdownRef}>
            <label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('Provider')}</label>
            <div className="relative">
              <button type="button" onClick={() => setProviderDropdownOpen((value) => !value)} className={`flex h-10 w-full items-center justify-between rounded-[6px] border bg-white dark:bg-[#16171a] px-3 text-left text-[13px] text-slate-800 dark:text-slate-200 transition-all hover:bg-slate-50 dark:hover:bg-[#1e222b] focus:ring-2 focus:ring-slate-300/50 dark:focus:ring-slate-700/50 ${providerDropdownOpen ? 'border-slate-400 dark:border-slate-500 ring-2 ring-slate-300/50 dark:ring-slate-700/50' : 'border-slate-200 dark:border-[#272b36]'}`} aria-expanded={providerDropdownOpen}>
                <span className="flex min-w-0 items-center gap-2">
                  {isCustom ? <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" /> : supportsOAuth ? <LogIn className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" /> : <KeyRound className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
                  <span className="truncate">{currentName}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
              </button>

              {providerDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-[8px] border border-slate-200 dark:border-[#272b36] bg-white dark:bg-[#1a1d24] shadow-xl">
                  <div className="border-b border-slate-100 dark:border-[#272b36] bg-slate-50/70 dark:bg-[#16171a]/70 p-2">
                    <div className="relative flex items-center">
                      <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                      <input type="text" autoFocus value={providerSearchQuery} onChange={(event) => setProviderSearchQuery(event.target.value)} placeholder={translate('Search provider…')} className="h-10 w-full rounded-[6px] border border-slate-200 dark:border-[#2b303c] bg-white dark:bg-[#1c2027] pl-8 pr-3 text-[12.5px] text-slate-800 dark:text-slate-200 outline-none focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto py-1">
                    {Object.entries(providerGroups).map(([group, items]) => items.length > 0 && (
                      <div key={group} className="space-y-0.5">
                        <div className="px-3 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{translate(group)}</div>
                        {items.map((provider) => (
                          <button key={provider.id} type="button" onClick={() => selectProvider(provider.id)} className={`flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors ${provider.id === selectedProviderId ? 'bg-blue-50/70 dark:bg-blue-950/40 font-medium text-blue-900 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                            <span className="flex min-w-0 items-center gap-2">
                              {provider.authMethods.includes('oauth') ? <LogIn className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" /> : <KeyRound className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
                              <span className="truncate">{provider.name}</span>
                            </span>
                            {provider.id === selectedProviderId && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="space-y-0.5">
                      <div className="px-3 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{translate('Custom')}</div>
                      <button type="button" onClick={() => selectProvider(CUSTOM_PROVIDER_ID)} className={`flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors ${isCustom ? 'bg-blue-50/70 dark:bg-blue-950/40 font-medium text-blue-900 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                        <span className="flex min-w-0 items-center gap-2"><Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" /><span className="truncate">{translate('Custom OpenAI-compatible provider')}</span></span>
                        {isCustom && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {!isCustom && currentProvider?.baseUrl && <p className="truncate text-[11.5px] text-slate-400 dark:text-slate-500" title={currentProvider.baseUrl}>{currentProvider.baseUrl}</p>}
          </div>

          {!isCustom && supportsOAuth && supportsApiKey && (
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('Method')}</label>
              <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-slate-100 dark:bg-slate-800 p-1">
                {(['oauth', 'api_key'] as const).map((method) => (
                  <button key={method} type="button" onClick={() => setAuthMethod(method)} className={`h-10 rounded-[6px] text-[12.5px] font-medium transition-colors ${authMethod === method ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                    {method === 'oauth' ? translate('OAuth') : translate('API Key')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCustom && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('Provider name')}</label><input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder={translate('e.g. My Custom API')} className={controlClass} /></div>
              <div className="space-y-1.5"><label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('Base URL')}</label><input value={customBaseUrl} onChange={(event) => setCustomBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className={controlClass} /></div>
            </div>
          )}

          {(isCustom || authMethod === 'api_key') && (
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('API Key')}</label>
              <div className="relative flex items-center">
                <input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={translate('Enter your API Key')} autoComplete="off" className={`${controlClass} pr-11`} />
                <button type="button" onClick={() => setShowApiKey((value) => !value)} className="absolute right-1 flex h-10 w-10 items-center justify-center text-slate-400 dark:text-slate-500 transition-colors hover:text-slate-600 dark:hover:text-slate-300" aria-label={showApiKey ? translate('Hide API key') : translate('Show API key')}>{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
          )}

          {isCustom && <div className="space-y-1.5"><label className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{translate('Model IDs, separated by commas')}</label><input value={customModelInput} onChange={(event) => setCustomModelInput(event.target.value)} placeholder={translate('Model IDs, separated by commas')} className={controlClass} /></div>}

          {!isCustom && authMethod === 'oauth' && <div className="rounded-[8px] border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 px-3 py-2.5 text-[12.5px] leading-5 text-blue-800 dark:text-blue-200">{translate('Authorize a subscription account without an API key.')}</div>}
          {error && <div className="rounded-[6px] border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">{error}</div>}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-[6px] border border-slate-200 dark:border-[#2b303c] bg-white dark:bg-[#1c2027] px-4 text-[13px] font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-[#252a34] disabled:opacity-50">{translate('Cancel')}</button>
            <button type="submit" disabled={saving || (!isCustom && !currentProvider)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] bg-slate-950 dark:bg-blue-600 px-5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50">{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}<span>{submitLabel}</span></button>
          </div>
        </form>
      </div>
    </div>
  );
}
