import React from '../desktop/node_modules/react';
import { renderToStaticMarkup } from '../desktop/node_modules/react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddModelModal } from '../desktop/src/components/settings/AddModelModal';

describe('Desktop add-model provider catalog', () => {
  it('renders provider data received from the Server instead of demo presets', () => {
    const markup = renderToStaticMarkup(React.createElement(
      AddModelModal,
      {
        open: true,
        providers: [
          { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', authMethods: ['api_key'] },
          { id: 'openai-codex', name: 'OpenAI Codex', baseUrl: 'https://chatgpt.com/backend-api', authMethods: ['oauth'] },
        ],
        onClose: vi.fn(),
        onSave: vi.fn(),
        onApiKeyLogin: vi.fn(),
        onOAuthLogin: vi.fn(),
        translate: (value: string) => value,
      }
    ));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('OpenAI');
    expect(markup).toContain('https://api.openai.com/v1');
    expect(markup).not.toContain('腾讯云 Token Plan');
  });
});
