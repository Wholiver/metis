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

