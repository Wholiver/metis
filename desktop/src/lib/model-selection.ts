export function resolveCustomProviderModel(
  previousModel: { provider?: string; id?: string; api?: string } | undefined,
  models: Array<{ provider: string; id: string }>,
  preferredProviderId?: string,
): { provider: string; id: string } | undefined {
  if (preferredProviderId) {
    const match = models.find((m) => m.provider === preferredProviderId);
    if (match) return match;
  }
  if (!previousModel || previousModel.provider === 'unknown' || previousModel.id === 'unknown') {
    const custom = models.find((m) => m.provider === 'other' || m.provider.startsWith('custom-'));
    if (custom) return custom;
  }
  return models[0];
}

export const HIDDEN_MODELS_STORAGE_KEY = 'metis:hidden-models';

export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function loadHiddenModelKeys(
  storage: Pick<Storage, 'getItem'> = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null },
): Set<string> {
  try {
    const raw = storage.getItem(HIDDEN_MODELS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === 'string'));
    }
  } catch {}
  return new Set();
}

export function saveHiddenModelKeys(
  keys: Set<string> | string[],
  storage: Pick<Storage, 'setItem'> = typeof localStorage !== 'undefined' ? localStorage : { setItem: () => {} },
): void {
  try {
    const array = Array.isArray(keys) ? keys : Array.from(keys);
    storage.setItem(HIDDEN_MODELS_STORAGE_KEY, JSON.stringify(array));
  } catch {}
}

export function hideModel(provider: string, id: string, storage?: Storage): void {
  const current = loadHiddenModelKeys(storage);
  current.add(modelKey(provider, id));
  saveHiddenModelKeys(current, storage);
}

export function unhideModel(provider: string, id: string, storage?: Storage): void {
  const current = loadHiddenModelKeys(storage);
  current.delete(modelKey(provider, id));
  saveHiddenModelKeys(current, storage);
}

export function restoreAllHiddenModels(
  storage: Pick<Storage, 'removeItem'> = typeof localStorage !== 'undefined' ? localStorage : { removeItem: () => {} },
): void {
  try {
    storage.removeItem(HIDDEN_MODELS_STORAGE_KEY);
  } catch {}
}

export function filterVisibleModels<T extends { provider: string; id: string }>(
  models: T[],
  hiddenKeys: Set<string> = loadHiddenModelKeys(),
): T[] {
  if (!hiddenKeys || hiddenKeys.size === 0) return models;
  return models.filter((model) => !hiddenKeys.has(modelKey(model.provider, model.id)));
}

