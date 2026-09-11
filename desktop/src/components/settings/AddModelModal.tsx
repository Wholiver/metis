import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import type { ProviderCatalogEntry } from '../../types';
import { Button } from '../atoms/Button';
import { ValuePill } from '../atoms/ValuePill';
import GlideMenu from '../primitives/GlideMenu';
import ProviderIcon, { hasProviderBrandIcon } from '../providers/ProviderIcon';

type AddModelModalProps = {
  open: boolean;
  providers: ProviderCatalogEntry[];
  onClose: () => void;
  onSave: (config: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    providerId?: string;
    modelIds?: string[];
    models?: Array<{ id: string; name?: string }>;
    discoveredModels?: Array<{ id: string; name?: string }>;
  }) => Promise<void>;
  onApiKeyLogin: (providerId: string, apiKey: string) => Promise<void>;
  onOAuthLogin: (providerId: string) => Promise<void>;
  onDiscoverModels?: (options: { baseUrl: string; apiKey?: string }) => Promise<Array<{ id: string; name?: string }> | any>;
  translate: (value: string, variables?: Record<string, string | number>) => string;
};

type AuthMethod = 'api_key' | 'oauth';
type WizardStep = 'pick' | 'connect' | 'custom-basics' | 'custom-models';
type ModelRow = { id: string; name: string };

const CUSTOM_PROVIDER_ID = '__custom__';
const POPULAR_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'google',
  'openrouter',
  'deepseek',
  'groq',
  'ollama',
] as const;

const controlClass =
  'h-9 w-full rounded-control border border-line-strong bg-field px-3 text-[13px] text-ink shadow-inset-field outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';
const iconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-[background-color,color] hover:bg-hover-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:opacity-50';

function emptyModelRow(): ModelRow {
  return { id: '', name: '' };
}

function normalizeProviderIdInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('custom-') ? trimmed : `custom-${trimmed}`;
}

export function AddModelModal({
  open,
  providers,
  onClose,
  onSave,
  onApiKeyLogin,
  onOAuthLogin,
  onDiscoverModels,
  translate,
}: AddModelModalProps) {
  const [step, setStep] = useState<WizardStep>('pick');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('api_key');
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [customProviderId, setCustomProviderId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelRows, setModelRows] = useState<ModelRow[]>([emptyModelRow()]);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState('');

  const currentProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCustom = selectedProviderId === CUSTOM_PROVIDER_ID;
  const supportsOAuth = Boolean(currentProvider?.authMethods.includes('oauth'));
  const supportsApiKey = Boolean(currentProvider?.authMethods.includes('api_key'));

  const resetForm = () => {
    setStep('pick');
    setSelectedProviderId('');
    setAuthMethod('api_key');
    setProviderSearchQuery('');
    setCustomProviderId('');
    setCustomName('');
    setCustomBaseUrl('');
    setApiKey('');
    setShowApiKey(false);
    setModelRows([emptyModelRow()]);
    setSaving(false);
    setDiscovering(false);
    setError('');
  };

  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open]);

  useEffect(() => {
    if (isCustom || !currentProvider) return;
    if (supportsOAuth && !supportsApiKey) setAuthMethod('oauth');
    else if (supportsApiKey && !supportsOAuth) setAuthMethod('api_key');
    else if (!currentProvider.authMethods.includes(authMethod)) setAuthMethod(supportsApiKey ? 'api_key' : 'oauth');
  }, [authMethod, currentProvider, isCustom, supportsApiKey, supportsOAuth]);

  const filteredProviders = useMemo(() => {
    const query = providerSearchQuery.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter(
      (provider) => provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query),
    );
  }, [providerSearchQuery, providers]);

  const popularProviders = useMemo(() => {
    const byId = new Map(filteredProviders.map((provider) => [provider.id, provider]));
    return POPULAR_PROVIDER_IDS.map((id) => byId.get(id)).filter(Boolean) as ProviderCatalogEntry[];
  }, [filteredProviders]);

  const otherProviders = useMemo(() => {
    const popular = new Set(popularProviders.map((provider) => provider.id));
    return filteredProviders.filter((provider) => !popular.has(provider.id));
  }, [filteredProviders, popularProviders]);

  const customMatchesSearch = useMemo(() => {
    const query = providerSearchQuery.trim().toLowerCase();
    if (!query) return true;
    const label = translate('Custom OpenAI-compatible provider').toLowerCase();
    return label.includes(query) || 'custom'.includes(query) || 'openai'.includes(query);
  }, [providerSearchQuery, translate]);

  const selectBuiltin = (providerId: string) => {
    setSelectedProviderId(providerId);
    setApiKey('');
    setError('');
    setStep('connect');
  };

  const selectCustom = () => {
    setSelectedProviderId(CUSTOM_PROVIDER_ID);
    setApiKey('');
    setError('');
    setStep('custom-basics');
  };

  const goBack = () => {
    setError('');
    if (step === 'connect' || step === 'custom-basics') setStep('pick');
    else if (step === 'custom-models') setStep('custom-basics');
  };

  const handleClose = () => {
    if (saving || discovering) return;
    onClose();
  };

  const continueCustomBasics = () => {
    setError('');
    const name = customName.trim();
    const baseUrl = customBaseUrl.trim();
    const providerId = normalizeProviderIdInput(customProviderId);
    if (!providerId || !/^custom-[a-z0-9][a-z0-9_-]*$/.test(providerId)) {
      setError(translate('Use lowercase letters, numbers, hyphens, or underscores'));
      return;
    }
    if (!name) {
      setError(translate('Provider name is required'));
      return;
    }
    if (!baseUrl) {
      setError(translate('Base URL is required'));
      return;
    }
    setCustomProviderId(providerId.replace(/^custom-/, ''));
    setStep('custom-models');
  };

  const updateModelRow = (index: number, patch: Partial<ModelRow>) => {
    setModelRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const removeModelRow = (index: number) => {
    setModelRows((rows) => (rows.length <= 1 ? [emptyModelRow()] : rows.filter((_, rowIndex) => rowIndex !== index)));
  };

  const handleDiscoverModels = async () => {
    if (!onDiscoverModels) return;
    setError('');
    setDiscovering(true);
    try {
      const results = await onDiscoverModels({
        baseUrl: customBaseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error(translate('No models were returned. Enter model IDs manually.'));
      }
      setModelRows(
        results.map((model) => ({
          id: String(model?.id || '').trim(),
          name: typeof model?.name === 'string' ? model.name : '',
        })).filter((model) => model.id),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiscovering(false);
    }
  };

  const handleConnect = async () => {
    if (!currentProvider) return;
    setError('');
    setSaving(true);
    try {
      if (authMethod === 'oauth') {
        await onOAuthLogin(currentProvider.id);
      } else {
        const key = apiKey.trim();
        if (!key) throw new Error(translate('API Key is required'));
        await onApiKeyLogin(currentProvider.id, key);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitCustom = async () => {
    setError('');
    setSaving(true);
    try {
      const name = customName.trim();
      const baseUrl = customBaseUrl.trim();
      const providerId = normalizeProviderIdInput(customProviderId);
      const models = modelRows
        .map((row) => ({ id: row.id.trim(), name: row.name.trim() || undefined }))
        .filter((row) => row.id);
      if (!providerId) throw new Error(translate('Use lowercase letters, numbers, hyphens, or underscores'));
      if (!name) throw new Error(translate('Provider name is required'));
      if (!baseUrl) throw new Error(translate('Base URL is required'));
      await onSave({
        name,
        baseUrl,
        apiKey: apiKey.trim() || undefined,
        providerId,
        modelIds: models.map((model) => model.id),
        models,
        discoveredModels: models,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title =
    step === 'pick'
      ? translate('Connect providers')
      : step === 'connect'
        ? translate(`Connect ${currentProvider?.name || 'Provider'}`)
        : step === 'custom-basics'
          ? translate('Custom provider')
          : translate('Custom provider');

  const description =
    step === 'connect'
      ? translate(`Enter your ${currentProvider?.name || 'Provider'} API key to connect your account and use its models in Metis.`)
      : step === 'custom-basics'
        ? translate('Configure an OpenAI-compatible provider.')
        : null;

  const renderProviderRow = (provider: ProviderCatalogEntry) => {
    const branded = hasProviderBrandIcon(provider.id);
    return (
      <button
        key={provider.id}
        type="button"
        data-menu-row=""
        data-provider-row={provider.id}
        onClick={() => selectBuiltin(provider.id)}
        className="relative z-10 flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left transition-[color,transform] duration-150 active:scale-[0.99]"
      >
        <ProviderIcon
          providerId={provider.id}
          authMethods={provider.authMethods}
          className={`h-3.5 w-3.5 shrink-0 ${branded ? 'text-ink-2' : ''}`.trim()}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{provider.name}</span>
        {provider.baseUrl ? (
          <span className="hidden max-w-[42%] truncate text-[12px] text-ink-3 sm:inline" title={provider.baseUrl}>
            {provider.baseUrl}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-ink/30 p-5 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-model-title"
        data-add-model-modal=""
        data-wizard-step={step}
        className="flex max-h-[min(720px,calc(100vh-40px))] w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden rounded-window bg-surface shadow-overlay"
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
          {step === 'pick' ? (
            <span className="h-7 w-7" aria-hidden="true" />
          ) : (
            <button type="button" className={iconButtonClass} onClick={goBack} disabled={saving || discovering} aria-label={translate('Back')}>
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <button type="button" className={iconButtonClass} onClick={handleClose} disabled={saving || discovering} aria-label={translate('Close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="mb-4 flex items-start gap-2.5">
            {step !== 'pick' ? (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-chip bg-hover-2 text-ink-2">
                <ProviderIcon
                  providerId={isCustom ? CUSTOM_PROVIDER_ID : selectedProviderId || CUSTOM_PROVIDER_ID}
                  authMethods={isCustom ? ['api_key'] : currentProvider?.authMethods}
                  className="h-3.5 w-3.5"
                />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 id="add-model-title" className="text-[16px] font-semibold tracking-[-0.015em] text-ink">
                {title}
              </h2>
              {description ? <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{description}</p> : null}
            </div>
          </div>

          {step === 'pick' ? (
            <div className="space-y-4">
              <div className="relative flex items-center rounded-chip bg-field px-2.5 h-[34px] transition-all focus-within:bg-surface focus-within:ring-2 focus-within:ring-[color:var(--focus)] focus-within:shadow-btn">
                <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <input
                  type="text"
                  autoFocus
                  value={providerSearchQuery}
                  onChange={(event) => setProviderSearchQuery(event.target.value)}
                  placeholder={translate('Search providers')}
                  className="h-full w-full bg-transparent pl-2 pr-1 text-[13px] text-ink outline-none placeholder:text-ink-3"
                />
              </div>

              {popularProviders.length === 0 && otherProviders.length === 0 && !customMatchesSearch ? (
                <p className="px-1 py-6 text-center text-[13px] text-ink-3">
                  {translate(`No matches for “${providerSearchQuery.trim()}”`)}
                </p>
              ) : (
                <div className="space-y-4">
                  {popularProviders.length > 0 ? (
                    <section className="space-y-1">
                      <h3 className="px-2 text-[12px] font-medium text-ink-3">{translate('Popular')}</h3>
                      <GlideMenu highlightClassName="inset-x-0 rounded-[8px] bg-hover-2" className="flex flex-col gap-px">
                        {popularProviders.map(renderProviderRow)}
                      </GlideMenu>
                    </section>
                  ) : null}

                  {otherProviders.length > 0 || customMatchesSearch ? (
                    <section className="space-y-1">
                      <h3 className="px-2 text-[12px] font-medium text-ink-3">{translate('Other')}</h3>
                      <GlideMenu highlightClassName="inset-x-0 rounded-[8px] bg-hover-2" className="flex flex-col gap-px">
                        {otherProviders.map(renderProviderRow)}
                        {customMatchesSearch ? (
                          <button
                            type="button"
                            data-menu-row=""
                            data-provider-row={CUSTOM_PROVIDER_ID}
                            onClick={selectCustom}
                            className="relative z-10 flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left transition-[color,transform] duration-150 active:scale-[0.99]"
                          >
                            <ProviderIcon providerId={CUSTOM_PROVIDER_ID} className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                              {translate('Custom OpenAI-compatible provider')}
                            </span>
                            <ValuePill className="shrink-0 px-1.5 py-0 text-[11px]">{translate('Custom')}</ValuePill>
                          </button>
                        ) : null}
                      </GlideMenu>
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {step === 'connect' && currentProvider ? (
            <div className="space-y-4">
              {supportsOAuth && supportsApiKey ? (
                <div className="space-y-1.5">
                  <label className="text-[12.5px] font-medium text-ink-2">{translate('Method')}</label>
                  <div className="grid grid-cols-2 gap-1 rounded-control bg-hover-2 p-1">
                    {(['api_key', 'oauth'] as const).map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setAuthMethod(method)}
                        className={`h-[30px] rounded-chip text-[12.5px] font-medium transition-colors ${
                          authMethod === method ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {method === 'oauth' ? translate('OAuth') : translate('API Key')}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {authMethod === 'api_key' ? (
                <div className="space-y-1.5">
                  <label className="text-[12.5px] font-medium text-ink-2">
                    {translate(`${currentProvider.name} API key`)}
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={translate('API key')}
                      autoComplete="off"
                      className={`${controlClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((value) => !value)}
                      className="absolute right-1 flex h-7 w-7 items-center justify-center text-ink-3 transition-colors hover:text-ink"
                      aria-label={showApiKey ? translate('Hide API key') : translate('Show API key')}
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-control border border-accent/30 bg-accent-tint px-3 py-2.5 text-[12.5px] leading-5 text-accent-ink">
                  {translate('Authorize a subscription account without an API key.')}
                </div>
              )}

              {error ? <div className="rounded-chip border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">{error}</div> : null}

              <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => void handleConnect()}>
                {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>{authMethod === 'oauth' ? translate('Sign in') : translate('Continue')}</span>
              </Button>
            </div>
          ) : null}

          {step === 'custom-basics' ? (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-ink-2">{translate('Provider ID')}</label>
                <input
                  value={customProviderId}
                  onChange={(event) => setCustomProviderId(event.target.value)}
                  placeholder={translate('myprovider')}
                  className={controlClass}
                />
                <p className="text-[12px] text-ink-3">{translate('Use lowercase letters, numbers, hyphens, or underscores')}</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-ink-2">{translate('Display name')}</label>
                <input
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder={translate('My AI provider')}
                  className={controlClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-ink-2">{translate('Base URL')}</label>
                <input
                  value={customBaseUrl}
                  onChange={(event) => setCustomBaseUrl(event.target.value)}
                  placeholder={translate('https://api.example.com/v1')}
                  className={controlClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-ink-2">{translate('API key')}</label>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={translate('API key')}
                    autoComplete="off"
                    className={`${controlClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="absolute right-1 flex h-7 w-7 items-center justify-center text-ink-3 transition-colors hover:text-ink"
                    aria-label={showApiKey ? translate('Hide API key') : translate('Show API key')}
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[12px] text-ink-3">{translate('Optional. Leave blank if you manage auth another way.')}</p>
              </div>

              {error ? <div className="rounded-chip border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">{error}</div> : null}

              <Button type="button" variant="primary" size="sm" onClick={continueCustomBasics}>
                {translate('Continue')}
              </Button>
            </div>
          ) : null}

          {step === 'custom-models' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-ink-2">{translate('API key')}</label>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={translate('API key')}
                    autoComplete="off"
                    className={`${controlClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="absolute right-1 flex h-7 w-7 items-center justify-center text-ink-3 transition-colors hover:text-ink"
                    aria-label={showApiKey ? translate('Hide API key') : translate('Show API key')}
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[12px] text-ink-3">{translate('Optional. Leave blank if you manage auth another way.')}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[12.5px] font-medium text-ink-2">{translate('Models')}</label>
                  {onDiscoverModels ? (
                    <Button type="button" variant="quiet" size="xs" disabled={discovering || saving} onClick={() => void handleDiscoverModels()}>
                      {discovering ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                      <span>{translate('Discover models')}</span>
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {modelRows.map((row, index) => (
                    <div key={`model-row-${index}`} className="flex items-center gap-2">
                      <input
                        value={row.id}
                        onChange={(event) => updateModelRow(index, { id: event.target.value })}
                        placeholder={translate('model-id')}
                        className={controlClass}
                      />
                      <input
                        value={row.name}
                        onChange={(event) => updateModelRow(index, { name: event.target.value })}
                        placeholder={translate('Display name')}
                        className={controlClass}
                      />
                      <button
                        type="button"
                        className={iconButtonClass}
                        onClick={() => removeModelRow(index)}
                        aria-label={translate('Delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setModelRows((rows) => [...rows, emptyModelRow()])}
                  className="inline-flex items-center gap-1.5 px-1 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{translate('Add model')}</span>
                </button>
              </div>

              {error ? <div className="rounded-chip border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">{error}</div> : null}

              <Button type="button" variant="primary" size="sm" disabled={saving || discovering} onClick={() => void handleSubmitCustom()}>
                {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>{translate('Submit')}</span>
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
