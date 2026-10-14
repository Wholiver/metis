import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  getTierLocalization,
  getFrameworkLocalization,
  getGateLocalization,
  getRoleLocalization,
  formatHarnessToolsCount,
  formatHarnessChecksCount,
  normalizeHarnessLanguage,
} from '../desktop/src/components/harness/harness-i18n';
import { TierNode } from '../desktop/src/components/harness/nodes/TierNode';
import { FrameworkNode } from '../desktop/src/components/harness/nodes/FrameworkNode';
import { GateNode } from '../desktop/src/components/harness/nodes/GateNode';
import { RoleNode } from '../desktop/src/components/harness/nodes/RoleNode';
const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');
const { ReactFlowProvider } = await import(
  '../desktop/node_modules/@xyflow/react/dist/esm/index.mjs'
);

function renderWithFlow(element: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(ReactFlowProvider, null, element));
}

describe('Agent Harness Multi-Language Localization (zh-CN, zh-TW, ja, en)', () => {
  it('correctly normalizes language strings', () => {
    expect(normalizeHarnessLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeHarnessLanguage('zh-Hans')).toBe('zh-CN');
    expect(normalizeHarnessLanguage('zh-TW')).toBe('zh-TW');
    expect(normalizeHarnessLanguage('zh-HK')).toBe('zh-TW');
    expect(normalizeHarnessLanguage('ja')).toBe('ja');
    expect(normalizeHarnessLanguage('ja-JP')).toBe('ja');
    expect(normalizeHarnessLanguage('en-US')).toBe('en');
    expect(normalizeHarnessLanguage('fr')).toBe('en');
  });

  describe('Tier localization', () => {
    it('localizes T1 tier node across all 4 languages', () => {
      const data = {
        name: 'Standard Feature / Bugfix',
        description: 'Focused single-surface feature or bugfix with reproduction test first.',
      };

      const zhCN = getTierLocalization('tier-t1', data, 'zh-CN');
      expect(zhCN.name).toBe('标准功能 / 缺陷修复');
      expect(zhCN.badge).toBe('T1 标准');
      expect(zhCN.description).toContain('针对单一模块');

      const zhTW = getTierLocalization('tier-t1', data, 'zh-TW');
      expect(zhTW.name).toBe('標準功能 / 缺陷修復');
      expect(zhTW.badge).toBe('T1 標準');
      expect(zhTW.description).toContain('針對單一模組');

      const ja = getTierLocalization('tier-t1', data, 'ja');
      expect(ja.name).toBe('標準機能 / バグ修正');
      expect(ja.badge).toBe('T1 標準');
      expect(ja.description).toContain('単一コンポーネント');

      const en = getTierLocalization('tier-t1', data, 'en');
      expect(en.name).toBe('Standard Feature / Bugfix');
      expect(en.badge).toBe('T1 Standard');
    });

    it('preserves user custom tier names', () => {
      const customData = {
        name: 'My Custom Tier',
        description: 'Custom description',
      };
      const res = getTierLocalization('tier-t1', customData, 'zh-CN');
      expect(res.name).toBe('My Custom Tier');
      expect(res.description).toBe('Custom description');
    });
  });

  describe('Framework localization', () => {
    it('localizes frameworks and categories across all 4 languages', () => {
      const fwData = {
        name: 'Backend Defect Repair Framework',
        category: 'backend',
        description: 'Root-cause diagnosis, test reproduction, and verified defect repair.',
      };

      const zhCN = getFrameworkLocalization('backend-fix', fwData, 'zh-CN');
      expect(zhCN.name).toBe('后端缺陷修复框架');
      expect(zhCN.categoryBadge).toBe('后端');
      expect(zhCN.description).toContain('根因排查');

      const zhTW = getFrameworkLocalization('backend-fix', fwData, 'zh-TW');
      expect(zhTW.name).toBe('後端缺陷修復框架');
      expect(zhTW.categoryBadge).toBe('後端');

      const ja = getFrameworkLocalization('backend-fix', fwData, 'ja');
      expect(ja.name).toBe('バックエンド不具合修正フレームワーク');
      expect(ja.categoryBadge).toBe('バックエンド');

      const en = getFrameworkLocalization('backend-fix', fwData, 'en');
      expect(en.name).toBe('Backend Defect Repair Framework');
      expect(en.categoryBadge).toBe('Backend');
    });
  });

  describe('Gate localization', () => {
    it('localizes quality gates and invariants across all 4 languages', () => {
      const g6Data = {
        name: 'Two-Sided Oracle Verification',
        invariant: 'Execute real fail-to-pass tests (confirming baseline failure and subsequent fix) or fresh isolated dual-check',
        checks: [{ command: 'npm test', expectExit: 0 }],
      };

      const zhCN = getGateLocalization('G6', g6Data, 'zh-CN');
      expect(zhCN.name).toBe('双向真值验证');
      expect(zhCN.invariant).toContain('红绿反转测试');
      expect(zhCN.checksLabel).toBe('1 项检查');

      const zhTW = getGateLocalization('G6', g6Data, 'zh-TW');
      expect(zhTW.name).toBe('雙向真值驗證');
      expect(zhTW.checksLabel).toBe('1 項檢查');

      const ja = getGateLocalization('G6', g6Data, 'ja');
      expect(ja.name).toBe('真値双方向検証');
      expect(ja.checksLabel).toBe('1 項目のチェック');

      const en = getGateLocalization('G6', g6Data, 'en');
      expect(en.name).toBe('Two-Sided Oracle Verification');
      expect(en.checksLabel).toBe('1 checks');
    });

    it('localizes completion and goal-check badges', () => {
      const completeData = { id: 'complete', gateId: 'complete' };
      expect(getGateLocalization('complete', completeData, 'zh-CN').badgeLabel).toBe('已完成');
      expect(getGateLocalization('complete', completeData, 'zh-TW').badgeLabel).toBe('已完成');
      expect(getGateLocalization('complete', completeData, 'ja').badgeLabel).toBe('完了');
      expect(getGateLocalization('complete', completeData, 'en').badgeLabel).toBe('Complete');
    });
  });

  describe('Role localization', () => {
    it('localizes role titles, categories, and tool counts', () => {
      const coordinatorData = {
        name: 'coordinator',
        tools: ['read', 'grep', 'find', 'spawn_agent', 'performance_gate'],
      };

      const zhCN = getRoleLocalization('coordinator', coordinatorData, 'zh-CN');
      expect(zhCN.displayName).toBe('主协调器');
      expect(zhCN.roleIdTag).toBe('coordinator');
      expect(zhCN.categoryLabel).toBe('编排');
      expect(zhCN.toolsCountLabel).toBe('5 项工具');

      const zhTW = getRoleLocalization('coordinator', coordinatorData, 'zh-TW');
      expect(zhTW.displayName).toBe('主協調器');
      expect(zhTW.categoryLabel).toBe('編排');
      expect(zhTW.toolsCountLabel).toBe('5 項工具');

      const ja = getRoleLocalization('coordinator', coordinatorData, 'ja');
      expect(ja.displayName).toBe('メインコーディネーター');
      expect(ja.categoryLabel).toBe('オーケストレーター');
      expect(ja.toolsCountLabel).toBe('5 個のツール');

      const en = getRoleLocalization('coordinator', coordinatorData, 'en');
      expect(en.displayName).toBe('coordinator');
      expect(en.categoryLabel).toBe('Orchestrator');
      expect(en.toolsCountLabel).toBe('5 tools');
    });

    it('formats tool and check counts correctly', () => {
      expect(formatHarnessToolsCount(6, 'zh-CN')).toBe('6 项工具');
      expect(formatHarnessToolsCount(6, 'zh-TW')).toBe('6 項工具');
      expect(formatHarnessToolsCount(6, 'ja')).toBe('6 個のツール');
      expect(formatHarnessToolsCount(6, 'en')).toBe('6 tools');

      expect(formatHarnessChecksCount(2, 'zh-CN')).toBe('2 项检查');
      expect(formatHarnessChecksCount(2, 'zh-TW')).toBe('2 項檢查');
      expect(formatHarnessChecksCount(2, 'ja')).toBe('2 項目のチェック');
      expect(formatHarnessChecksCount(2, 'en')).toBe('2 checks');
    });
  });

  describe('React component markup rendering', () => {
    it('renders localized RoleNode with Chinese title and English ID pill', () => {
      const markup = renderWithFlow(
        React.createElement(RoleNode, {
          id: 'planner',
          data: {
            name: 'planner',
            tools: ['read', 'grep', 'find', 'edit', 'write', 'ls'],
            _language: 'zh-CN',
          },
          selected: false,
        })
      );

      expect(markup).toContain('data-harness-node-role=""');
      expect(markup).toContain('架构规划师');
      expect(markup).toContain('planner');
      expect(markup).toContain('战略');
      expect(markup).toContain('6 项工具');
    });

    it('renders RoleNode in Japanese (ja)', () => {
      const markup = renderWithFlow(
        React.createElement(RoleNode, {
          id: 'coordinator',
          data: {
            name: 'coordinator',
            tools: ['read', 'grep', 'find', 'spawn_agent'],
            _language: 'ja',
          },
          selected: false,
        })
      );

      expect(markup).toContain('メインコーディネーター');
      expect(markup).toContain('オーケストレーター');
      expect(markup).toContain('4 個のツール');
    });

    it('renders localized GateNode with Chinese title, invariant, and check count', () => {
      const markup = renderWithFlow(
        React.createElement(GateNode, {
          id: 'G4',
          data: {
            gateId: 'G4',
            name: 'Test-Driven Implementation',
            invariant: 'Write minimal focused changes within approved scope',
            checks: [{ command: 'npm test', expectExit: 0 }],
            _language: 'zh-CN',
          },
          selected: false,
        })
      );

      expect(markup).toContain('data-harness-node-gate=""');
      expect(markup).toContain('测试驱动实现 (TDD)');
      expect(markup).toContain('在批准的范围内');
      expect(markup).toContain('1 项检查');
    });

    it('renders localized FrameworkNode with Chinese title and category', () => {
      const markup = renderWithFlow(
        React.createElement(FrameworkNode, {
          id: 'frontend-fix',
          data: {
            id: 'frontend-fix',
            name: 'Frontend Defect Repair Framework',
            category: 'frontend',
            description: 'Diagnose and fix UI/UX bugs, layout inconsistencies, or client state errors.',
            _language: 'zh-CN',
          },
          selected: false,
        })
      );

      expect(markup).toContain('data-harness-node-framework=""');
      expect(markup).toContain('前端缺陷修复框架');
      expect(markup).toContain('前端');
      expect(markup).toContain('排查并修复 UI/UX 异常');
    });

    it('renders localized TierNode with Chinese title and badge', () => {
      const markup = renderWithFlow(
        React.createElement(TierNode, {
          id: 'tier-t1',
          data: {
            id: 'tier-t1',
            name: 'Standard Feature / Bugfix',
            description: 'Focused single-surface feature or bugfix with reproduction test first.',
            _language: 'zh-CN',
          },
          selected: false,
        })
      );

      expect(markup).toContain('data-harness-node-tier=""');
      expect(markup).toContain('标准功能 / 缺陷修复');
      expect(markup).toContain('T1 标准');
    });
  });
});
