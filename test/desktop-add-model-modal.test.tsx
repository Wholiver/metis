import React from '../desktop/node_modules/react';
import { renderToStaticMarkup } from '../desktop/node_modules/react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddModelModal } from '../desktop/src/components/settings/AddModelModal';
import ProviderIcon, { hasProviderBrandIcon } from '../desktop/src/components/providers/ProviderIcon';

const providers = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', authMethods: ['api_key'] as const },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', authMethods: ['api_key'] as const },
  { id: 'openai-codex', name: 'OpenAI Codex', baseUrl: 'https://chatgpt.com/backend-api', authMethods: ['oauth'] as const },
  { id: 'groq', name: 'Groq', authMethods: ['api_key'] as const },
  { id: 'mystery-lab', name: 'Mystery Lab', authMethods: ['api_key'] as const },
  { id: 'mystery-oauth', name: 'Mystery OAuth', authMethods: ['oauth'] as const },
];

describe('Desktop add-model provider catalog', () => {
  it('renders a searchable popular/other provider picker from Server catalog', () => {
    const markup = renderToStaticMarkup(React.createElement(
      AddModelModal,
      {
        open: true,
        providers,
        onClose: vi.fn(),
        onSave: vi.fn(),
        onApiKeyLogin: vi.fn(),
        onOAuthLogin: vi.fn(),
        translate: (value: string) => value,
      }
    ));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-wizard-step="pick"');
    expect(markup).toContain('Connect providers');
    expect(markup).toContain('Popular');
    expect(markup).toContain('Other');
    expect(markup).toContain('OpenAI');
    expect(markup).toContain('Anthropic');
    expect(markup).toContain('OpenAI Codex');
    expect(markup).toContain('Custom OpenAI-compatible provider');
    expect(markup).toContain('https://api.openai.com/v1');
    expect(markup).not.toContain('腾讯云 Token Plan');
    expect(markup).not.toContain('PROVIDER_PRESETS');
  });

  it('renders brand icons for known providers and fallbacks for unknown/custom', () => {
    const markup = renderToStaticMarkup(React.createElement(
      AddModelModal,
      {
        open: true,
        providers,
        onClose: vi.fn(),
        onSave: vi.fn(),
        onApiKeyLogin: vi.fn(),
        onOAuthLogin: vi.fn(),
        translate: (value: string) => value,
      }
    ));

    expect(markup).toContain('data-provider-icon="openai"');
    expect(markup).toContain('data-provider-icon="anthropic"');
    expect(markup).toContain('data-provider-icon="groq"');
    expect(markup).toContain('data-provider-icon="openai-codex"');
    expect(markup).toContain('data-provider-icon="mystery-lab"');
    expect(markup).toContain('data-provider-icon="mystery-oauth"');
    expect(markup).toContain('data-provider-icon="__custom__"');
  });
});

describe('ProviderIcon', () => {
  it('maps known ids and aliases to brand marks', () => {
    expect(hasProviderBrandIcon('openai')).toBe(true);
    expect(hasProviderBrandIcon('openai-codex')).toBe(true);
    expect(hasProviderBrandIcon('google')).toBe(true);
    expect(hasProviderBrandIcon('gemini')).toBe(true);
    expect(hasProviderBrandIcon('amazon-bedrock')).toBe(true);
    expect(hasProviderBrandIcon('fireworks')).toBe(true);
    expect(hasProviderBrandIcon('huggingface')).toBe(true);
    expect(hasProviderBrandIcon('kimi-coding')).toBe(true);
    expect(hasProviderBrandIcon('minimax')).toBe(true);
    expect(hasProviderBrandIcon('minimax-cn')).toBe(true);
    expect(hasProviderBrandIcon('mistral')).toBe(true);
    expect(hasProviderBrandIcon('moonshotai')).toBe(true);
    expect(hasProviderBrandIcon('moonshotai-cn')).toBe(true);
    expect(hasProviderBrandIcon('github-copilot')).toBe(true);
    expect(hasProviderBrandIcon('google-vertex')).toBe(true);
    expect(hasProviderBrandIcon('mystery-lab')).toBe(false);
    expect(hasProviderBrandIcon('__custom__')).toBe(false);
    expect(hasProviderBrandIcon('custom-foo')).toBe(false);

    const openai = renderToStaticMarkup(React.createElement(ProviderIcon, { providerId: 'openai' }));
    expect(openai).toContain('data-provider-icon="openai"');
    expect(openai).toContain('<svg');
    expect(openai).toContain('currentColor');

    const fireworks = renderToStaticMarkup(React.createElement(ProviderIcon, { providerId: 'fireworks' }));
    expect(fireworks).toContain('data-provider-icon="fireworks"');
    expect(fireworks).toContain('<svg');

    const custom = renderToStaticMarkup(React.createElement(ProviderIcon, { providerId: '__custom__' }));
    expect(custom).toContain('data-provider-icon="__custom__"');

    const oauth = renderToStaticMarkup(
      React.createElement(ProviderIcon, { providerId: 'unknown', authMethods: ['oauth'] })
    );
    expect(oauth).toContain('data-provider-icon="unknown"');
  });
});
