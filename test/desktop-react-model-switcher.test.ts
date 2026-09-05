import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelLabel, resolveDisplayModel, thinkingOptionLabel } from '../desktop/src/components/chat/ModelSwitcher';

describe('desktop React model switcher', () => {
  it('uses model display names with an id fallback', () => {
    expect(modelLabel({ provider: 'openai', id: 'gpt-5.6', name: 'GPT 5.6' })).toBe('GPT 5.6');
    expect(modelLabel({ provider: 'openai', id: 'gpt-5.6' })).toBe('gpt-5.6');
    expect(modelLabel()).toBe('Model');
  });

  it('uses catalog metadata for the selected model label', () => {
    const catalogModel = { provider: 'custom-anti', id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash Medium' };
    const staleSessionModel = { ...catalogModel, name: '模型提取' };

    expect(resolveDisplayModel(staleSessionModel, [catalogModel])).toBe(catalogModel);
    expect(modelLabel(resolveDisplayModel(staleSessionModel, [catalogModel]))).toBe('Gemini 3.7 Flash Medium');
  });

  it('shows provider-native thinking labels instead of internal IDs', () => {
    expect(thinkingOptionLabel([
      { id: 'off', label: 'None', value: 'none' },
      { id: 'xhigh', label: 'Maximum', value: 'max' },
    ], 'xhigh')).toBe('Maximum');
  });

  it('loads models and persists session model changes through Server', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(source).toContain("request<ProviderModelsResponse>('/config/providers')");
    expect(source).toContain("request<ModelOption>('/session/model', 'PUT'");
    expect(source).toContain('provider: model.provider');
    expect(source).toContain('modelId: model.id');
    expect(source).toContain('setActiveModel(state.model)');
    expect(source).toContain('setActiveModel(selected)');
    expect(source).toContain("request<{ level: string }>('/session/thinking', 'PUT'");
    expect(source).toContain('setSupportsThinking(Boolean(state.supportsThinking))');
  });

  it('renders an accessible upward menu immediately left of send', () => {
    const switcher = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ModelSwitcher.tsx'), 'utf8');
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    const chatArea = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');

    expect(switcher).toContain('createPortal(');
    expect(switcher).toContain('triggerRect.top - menu.offsetHeight - 8');
    expect(switcher).toContain('role="listbox"');
    expect(switcher).toContain('role="option"');
    expect(switcher).toContain("event.key === 'Escape'");
    expect(switcher).toContain('data-model-switcher');
    expect(switcher).toContain('data-reasoning-menu');
    expect(switcher).toContain('Array.isArray(model.thinkingOptions)');
    expect(switcher).toContain('data-model-reasoning={showReasoning');
    expect(switcher).toContain('optionsForModel(reasoningMenu.model).map((option) =>');
    expect(switcher).not.toContain("thinkingLevels.slice(");
    expect(switcher).toContain('const [reasoningMenu, setReasoningMenu] = useState<ReasoningMenuState>()');
    expect(switcher).toContain('onMouseEnter={(event) => showReasoning ? showReasoningMenu(model, event.currentTarget)');
    expect(switcher).toContain('scheduleReasoningMenuClose');
    expect(switcher).toContain('reasoningMenuRef.current?.contains(target)');
    expect(switcher).toContain('if (!sameModel(reasoningMenu.model, activeModel)) await onSelectModel(reasoningMenu.model);');
    expect(switcher).toContain('min-h-8');
    expect(composer).toContain('col-start-3 row-start-2 self-end justify-self-end');
    expect(composer).toContain('col-start-4 row-start-2 self-end');
    expect(chatArea).toContain('onSelectModel={onSelectModel}');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_MODEL_SWITCHER');
    expect(main).toContain('[capture:model-switcher]');
    expect(main).toContain('hasReasoningControl');
    expect(main).toContain('reasoningModelCount');
    expect(main).toContain('reasoningSubmenuBesideModel');
  });

  it('lets wide side panels yield before the composer clips the model trigger', () => {
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    const chatArea = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'), 'utf8');
    const sidebar = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    const inspector = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/Inspector.tsx'), 'utf8');

    expect(app).toContain('const MIN_SIDEBAR_WIDTH = 240');
    expect(app).toContain('const MIN_INSPECTOR_WIDTH = 360');
    expect(chatArea).toContain('min-w-[360px]');
    expect(chatArea).not.toContain('flex flex-col min-w-0 overflow-hidden relative');
    expect(sidebar).toContain('min-w-[240px] shrink');
    expect(sidebar).not.toContain('select-none flex-shrink-0 relative');
    expect(inspector).toContain('min-w-[360px] shrink');
    expect(inspector).not.toContain('select-none flex-shrink-0 relative');
    expect(240 + 360 + 360).toBeLessThan(1040);
  });

  it('preserves the model indicator on the hovered model while its reasoning submenu is open', () => {
    const switcher = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ModelSwitcher.tsx'), 'utf8');
    expect(switcher).toContain('positionModelIndicator(reasoningMenuRefState.current.model, true)');
    expect(switcher).toContain('sameModel(reasoningMenu.model, activeModel)');
    expect(switcher).toContain('sameModel(reasoningMenuRefState.current.model, activeModel)');
    expect(switcher).toContain('title={showReasoning ? undefined : `${model.provider} · ${model.id}`}');
  });
});

