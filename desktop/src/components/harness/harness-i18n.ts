/**
 * Internationalization & Localization mapping for Agent Harness built-in architecture.
 * Supports:
 * - zh-CN (Simplified Chinese - 简体中文)
 * - zh-TW (Traditional Chinese - 繁體中文)
 * - ja (Japanese - 日本語)
 * - en (English - Default)
 */

export type SupportedHarnessLanguage = 'zh-CN' | 'zh-TW' | 'ja' | 'en';

export function normalizeHarnessLanguage(lang?: string): SupportedHarnessLanguage {
  if (!lang) return 'en';
  const clean = lang.trim();
  if (/^zh-(HK|MO|TW)$/i.test(clean)) return 'zh-TW';
  if (/^zh/i.test(clean)) return 'zh-CN';
  if (/^ja/i.test(clean)) return 'ja';
  return 'en';
}

// ---------------------------------------------------------------------------
// 1. Tiers Localization
// ---------------------------------------------------------------------------
export interface TierLocalization {
  name: string;
  badge: string;
  description: string;
}

export const TIERS_I18N: Record<SupportedHarnessLanguage, Record<string, TierLocalization>> = {
  'zh-CN': {
    'tier-fast-path': {
      name: '日常对话 / 直接问答',
      badge: '普通',
      description: '问候、闲聊、概念解答或无代码修改诉求的常规咨询。',
    },
    'tier-t0': {
      name: '极简 / 机械应用',
      badge: 'T0 极简',
      description: '需求完全确定且无设计决策的机械式修改或单条命令执行。',
    },
    'tier-t1': {
      name: '标准功能 / 缺陷修复',
      badge: 'T1 标准',
      description: '针对单一模块的聚焦功能开发或缺陷修复，先编写复现测试。',
    },
    'tier-t2': {
      name: '复杂架构 / 多阶段演进',
      badge: 'T2 复杂',
      description: '跨模块架构设计、深层重构或多阶段渐进式增强实现。',
    },
    'tier-t3': {
      name: '跨界面 / 集群级协同',
      badge: 'T3 协同',
      description: '大型跨模块/跨系统任务，拆解为并行互斥通道协同推进。',
    },
  },
  'zh-TW': {
    'tier-fast-path': {
      name: '日常對話 / 直接問答',
      badge: '普通',
      description: '問候、閒聊、概念解答或無程式碼修改訴求的常規諮詢。',
    },
    'tier-t0': {
      name: '極簡 / 機械套用',
      badge: 'T0 極簡',
      description: '需求完全確定且無設計決策的機械式修改或單條命令執行。',
    },
    'tier-t1': {
      name: '標準功能 / 缺陷修復',
      badge: 'T1 標準',
      description: '針對單一模組的聚焦功能開發或缺陷修復，先編寫重現測試。',
    },
    'tier-t2': {
      name: '複雜架構 / 多階段演進',
      badge: 'T2 複雜',
      description: '跨模組架構設計、深層重構或多階段漸進式增強實現。',
    },
    'tier-t3': {
      name: '跨介面 / 叢集級協同',
      badge: 'T3 協同',
      description: '大型跨模組/跨系統任務，拆解為平行互斥通道協同推進。',
    },
  },
  ja: {
    'tier-fast-path': {
      name: '対話 / 直接Q&A',
      badge: '通常',
      description: '挨拶、雑談、概念的な質問、またはコード変更を伴わない問い合わせ。',
    },
    'tier-t0': {
      name: '最小限 / 機械的適用',
      badge: 'T0 最小',
      description: '仕様が100%確定しており設計判断が不要な機械的変更または単一コマンド実行。',
    },
    'tier-t1': {
      name: '標準機能 / バグ修正',
      badge: 'T1 標準',
      description: '単一コンポーネントに焦点を当てた機能追加またはバグ修正（再現テスト先行）。',
    },
    'tier-t2': {
      name: '複合アーキテクチャ / マルチフェーズ',
      badge: 'T2 複合',
      description: '複数ステップにわたるアーキテクチャ実装、リファクタリング、複数モジュールの強化。',
    },
    'tier-t3': {
      name: 'マルチサーフェス / フリート協調',
      badge: 'T3 協調',
      description: '複数の独立した領域にまたがる大規模タスクを並列調整レーンで実行。',
    },
  },
  en: {
    'tier-fast-path': {
      name: 'Conversational / Direct Q&A',
      badge: 'Fast Path',
      description: 'Greetings, chit-chat, conceptual questions, or inquiries with no code mutation requested.',
    },
    'tier-t0': {
      name: 'Minimal / Mechanical Apply',
      badge: 'T0 Minimal',
      description: 'Mechanical apply or single command where WHAT is 100% specified and zero design decisions remain.',
    },
    'tier-t1': {
      name: 'Standard Feature / Bugfix',
      badge: 'T1 Standard',
      description: 'Focused single-surface feature or bugfix with reproduction test first.',
    },
    'tier-t2': {
      name: 'Complex Architectural / Multi-Phase',
      badge: 'T2 Complex',
      description: 'Multi-step architectural implementation, refactoring, or multi-component enhancement.',
    },
    'tier-t3': {
      name: 'Multi-Surface / Fleet Scope',
      badge: 'T3 Multi-Surface',
      description: 'Large disjoint multi-surface mission dispatched across parallel coordinated lanes.',
    },
  },
};

// ---------------------------------------------------------------------------
// 2. Framework Categories & Frameworks Localization
// ---------------------------------------------------------------------------
export const FRAMEWORK_CATEGORIES_I18N: Record<SupportedHarnessLanguage, Record<string, string>> = {
  'zh-CN': {
    any: '快速应用',
    frontend: '前端',
    backend: '后端',
    planning: '规划',
    architecture: '架构',
    docs: '文档',
    polish: '润色',
    refactoring: '重构',
    generation: '生成',
  },
  'zh-TW': {
    any: '快速套用',
    frontend: '前端',
    backend: '後端',
    planning: '規劃',
    architecture: '架構',
    docs: '文件',
    polish: '潤色',
    refactoring: '重構',
    generation: '生成',
  },
  ja: {
    any: 'クイック適用',
    frontend: 'フロントエンド',
    backend: 'バックエンド',
    planning: '計画',
    architecture: 'アーキテクチャ',
    docs: 'ドキュメント',
    polish: '調整',
    refactoring: 'リファクタ',
    generation: '生成',
  },
  en: {
    any: 'Quick Apply',
    frontend: 'Frontend',
    backend: 'Backend',
    planning: 'Planning',
    architecture: 'Architecture',
    docs: 'Docs',
    polish: 'Polish',
    refactoring: 'Refactor',
    generation: 'Generation',
  },
};

export interface FrameworkLocalization {
  name: string;
  description: string;
}

export const FRAMEWORKS_I18N: Record<SupportedHarnessLanguage, Record<string, FrameworkLocalization>> = {
  'zh-CN': {
    apply: {
      name: '定向应用框架',
      description: '机械式应用明确定义的代码变更，无需额外设计决策。',
    },
    'backend-fix': {
      name: '后端缺陷修复框架',
      description: '根因排查、测试复现与验证闭环的后端缺陷修复。',
    },
    'frontend-fix': {
      name: '前端缺陷修复框架',
      description: '排查并修复 UI/UX 异常、布局样式问题或客户端状态错误。',
    },
    docs: {
      name: '文档编写框架',
      description: '编写、更新与审查技术文档、操作指南与接口规范。',
    },
    polish: {
      name: '代码润色框架',
      description: '代码美化、注释完善、命名规范统一与代码格式优化。',
    },
    'backend-build': {
      name: '后端模块构建框架',
      description: '设计并构建全新的后端独立模块或服务层。',
    },
    'backend-implement': {
      name: '后端功能实现框架',
      description: '在已有后端架构中扩展业务逻辑、接口或数据流。',
    },
    'frontend-build': {
      name: '前端组件构建框架',
      description: '构建高复用性、可访问的前端 UI 组件体系。',
    },
    'frontend-implement': {
      name: '前端业务实现框架',
      description: '在前端应用中组装组件、连接状态与联调数据接口。',
    },
    'frontend-review': {
      name: '前端设计评审框架',
      description: '针对视觉一致性、设计系统规范和交互体验做深度审查。',
    },
    'plan-design': {
      name: '架构规划与设计框架',
      description: '深度分析系统设计，产出可验证的分步演进技术方案。',
    },
    'plan-research': {
      name: '调研与技术探索框架',
      description: '探索未知技术方案、评估可行性并消除实施不确定性。',
    },
    'plan-scope': {
      name: '边界锁定与任务拆解框架',
      description: '精准界定任务范围与影响文件，防止改动蔓延失控。',
    },
    refactor: {
      name: '结构化重构框架',
      description: '在确保既有测试行为 100% 保持的前提下优化系统内部结构。',
    },
    composition: {
      name: '跨端协同组合框架',
      description: '组合多层前后端能力，编排端到端一体化任务。',
    },
    generation: {
      name: '全新项目生成框架',
      description: '从零脚手架构建全新项目、原型或整套工程结构。',
    },
  },
  'zh-TW': {
    apply: {
      name: '定向套用框架',
      description: '機械式套用明確定義的程式碼變更，無需額外設計決策。',
    },
    'backend-fix': {
      name: '後端缺陷修復框架',
      description: '根因排查、測試重現與驗證閉環的後端缺陷修復。',
    },
    'frontend-fix': {
      name: '前端缺陷修復框架',
      description: '排查並修復 UI/UX 異常、版面樣式問題或客戶端狀態錯誤。',
    },
    docs: {
      name: '文件編寫框架',
      description: '編寫、更新與審查技術文件、操作指南與介面規範。',
    },
    polish: {
      name: '程式碼潤色框架',
      description: '程式碼美化、註解完善、命名規範統一與程式碼格式優化。',
    },
    'backend-build': {
      name: '後端模組建置框架',
      description: '設計並建置全新的後端獨立模組或服務層。',
    },
    'backend-implement': {
      name: '後端功能實現框架',
      description: '在現有後端架構中擴充業務邏輯、介面或資料流。',
    },
    'frontend-build': {
      name: '前端元件建置框架',
      description: '建置高複用性、無障礙的前端 UI 元件體系。',
    },
    'frontend-implement': {
      name: '前端業務實現框架',
      description: '在前端應用中組裝元件、連接狀態與聯調資料介面。',
    },
    'frontend-review': {
      name: '前端設計審查框架',
      description: '針對視覺一致性、設計系統規範和互動體驗做深度審查。',
    },
    'plan-design': {
      name: '架構規劃與設計框架',
      description: '深度分析系統設計，產出可驗證的分步演進技術方案。',
    },
    'plan-research': {
      name: '調研與技術探索框架',
      description: '探索未知技術方案、評估可行性並消除實施不確定性。',
    },
    'plan-scope': {
      name: '邊界鎖定與任務拆解框架',
      description: '精準界定任務範圍與影響檔案，防止改動蔓延失控。',
    },
    refactor: {
      name: '結構化重構框架',
      description: '在確保既有測試行為 100% 保持的前提下優化系統內部結構。',
    },
    composition: {
      name: '跨端協同組合框架',
      description: '組合多層前後端能力，編排端到端一體化任務。',
    },
    generation: {
      name: '全新專案生成框架',
      description: '從零鷹架建置全新專案、原型或整套工程結構。',
    },
  },
  ja: {
    apply: {
      name: 'ターゲット適用フレームワーク',
      description: '設計判断を伴わない、明確に定義された変更を機械的に適用。',
    },
    'backend-fix': {
      name: 'バックエンド不具合修正フレームワーク',
      description: '根本原因の特定、テスト再現、検証済み修正を実施。',
    },
    'frontend-fix': {
      name: 'フロントエンド不具合修正フレームワーク',
      description: 'UI/UXバグ、レイアウトの崩れ、クライアント状態エラーの診断と修正。',
    },
    docs: {
      name: 'ドキュメントフレームワーク',
      description: '技術ドキュメント、ガイド、または仕様の作成、更新、監査。',
    },
    polish: {
      name: '品質ブラッシュアップフレームワーク',
      description: 'コードの可読性、コメント、命名の一貫性、フォーマットの最適化。',
    },
    'backend-build': {
      name: 'バックエンドモジュール構築フレームワーク',
      description: '新しいバックエンドモジュールまたはサービス層を設計・構築。',
    },
    'backend-implement': {
      name: 'バックエンド機能実装フレームワーク',
      description: '既存のバックエンドシステムにビジネスロジックやAPIを実装・拡張。',
    },
    'frontend-build': {
      name: 'フロントエンドコンポーネント構築フレームワーク',
      description: 'アクセシビリティ対応の再利用可能なUIコンポーネントを新規構築。',
    },
    'frontend-implement': {
      name: 'フロントエンド機能実装フレームワーク',
      description: 'UIコンポーネントを統合し、状態管理とデータAPIを接続。',
    },
    'frontend-review': {
      name: 'フロントエンドデザインレビューフレームワーク',
      description: 'デザインシステム仕様、視覚的一貫性、操作体験を詳細にレビュー。',
    },
    'plan-design': {
      name: 'アーキテクチャ計画・設計フレームワーク',
      description: 'システム設計を詳細に調査し、検証可能な段階的計画を作成。',
    },
    'plan-research': {
      name: '調査・技術探索フレームワーク',
      description: '技術選定の検証、プロトタイプ作成、実装リスクの解消。',
    },
    'plan-scope': {
      name: 'スコープ定義・タスク分割フレームワーク',
      description: '影響範囲と対象ファイルを明確化し、不要な変更の拡大を防止。',
    },
    refactor: {
      name: '構造リファクタリングフレームワーク',
      description: '既存のテストを100%維持しながら内部設計と構造を最適化。',
    },
    composition: {
      name: 'クロスサーフェス統合フレームワーク',
      description: 'フロントエンドとバックエンドを統合し、エンドツーエンドのタスクを編成。',
    },
    generation: {
      name: '新規プロジェクト生成フレームワーク',
      description: 'プロジェクトの雛形、プロトタイプ、または完全なシステムを新規生成。',
    },
  },
  en: {
    apply: {
      name: 'Targeted Apply Framework',
      description: 'Mechanically apply a fully specified change without design decisions.',
    },
    'backend-fix': {
      name: 'Backend Defect Repair Framework',
      description: 'Root-cause diagnosis, test reproduction, and verified defect repair.',
    },
    'frontend-fix': {
      name: 'Frontend Defect Repair Framework',
      description: 'Diagnose and fix UI/UX bugs, layout inconsistencies, or client state errors.',
    },
    docs: {
      name: 'Documentation Framework',
      description: 'Author, update, and audit technical documentation, guides, or specifications.',
    },
    polish: {
      name: 'Quality Polish Framework',
      description: 'Code aesthetics, comments, naming consistency, and formatting cleanup.',
    },
    'backend-build': {
      name: 'Backend Module Build Framework',
      description: 'Design and implement a brand new backend module or independent service layer.',
    },
    'backend-implement': {
      name: 'Backend Feature Implementation Framework',
      description: 'Extend existing backend services with focused business logic, APIs, or data flows.',
    },
    'frontend-build': {
      name: 'Frontend Component Build Framework',
      description: 'Build fresh accessible UI components and design systems.',
    },
    'frontend-implement': {
      name: 'Frontend Implementation Framework',
      description: 'Assemble UI components, integrate client state, and bind backend APIs.',
    },
    'frontend-review': {
      name: 'Frontend Design Review Framework',
      description: 'Audit visual consistency, design system tokens, and interaction polish.',
    },
    'plan-design': {
      name: 'Architectural Plan & Design Framework',
      description: 'Decompose complex architecture, audit system dependencies, and author verifiable plan.',
    },
    'plan-research': {
      name: 'Research & Exploration Framework',
      description: 'Spike feasibility, de-risk unknown APIs, and clarify architecture choices.',
    },
    'plan-scope': {
      name: 'Scope Boundary & Breakdown Framework',
      description: 'Define explicit boundaries, isolate affected components, and split safe work units.',
    },
    refactor: {
      name: 'Structural Refactoring Framework',
      description: 'Improve code structure, eliminate technical debt, and preserve 100% test behavior.',
    },
    composition: {
      name: 'Cross-Surface Composition Framework',
      description: 'Coordinate multi-layer implementation across frontend, backend, and documentation.',
    },
    generation: {
      name: 'Greenfield Generation Framework',
      description: 'Bootstrap new projects, scaffolds, or comprehensive prototypes from zero.',
    },
  },
};

// ---------------------------------------------------------------------------
// 3. Quality Gates Localization
// ---------------------------------------------------------------------------
export interface GateLocalization {
  name: string;
  invariant: string;
  badge?: string;
}

export const GATES_I18N: Record<SupportedHarnessLanguage, Record<string, GateLocalization>> = {
  'zh-CN': {
    G0: {
      name: '现状基线验证',
      invariant: '验证既有代码基线在未修改状态下正常运行',
    },
    G1: {
      name: '架构规划与设计',
      invariant: '审查代码库，追踪模块依赖，产出可验证的执行方案',
    },
    G2: {
      name: '范围锁定与风险边界',
      invariant: '明确界定改动边界与受影响文件，严格隔离范围外文件',
    },
    'G3.5': {
      name: '缺陷深度锁定',
      invariant: '在修改任何代码前独立推导根因函数与最小复现条件',
    },
    G4: {
      name: '测试驱动实现 (TDD)',
      invariant: '在批准的范围内以最小且聚焦的改动驱动测试变绿',
    },
    G5: {
      name: '独立代码审查',
      invariant: '进入验证前必须由独立代理审查 diff 与需求一致性',
    },
    G6: {
      name: '双向真值验证',
      invariant: '执行真实红绿反转测试确认修复有效，且全部既有测试无回归',
    },
    G7: {
      name: '证据综合与交付',
      invariant: '整理结构化产物，附带严格验证的代码证据完成交付',
    },
    sweep: {
      name: '邻域收敛巡检',
      invariant: '深度巡检关联模块与依赖项，确保全局一致收敛',
      badge: '巡检',
    },
    'goal-check': {
      name: '目标完备核对',
      invariant: '依据已打开的证据逐项确认用户原始需求全部达成',
      badge: '目标核对',
    },
    complete: {
      name: '任务圆满完成',
      invariant: '全链路验证通过，任务正式圆满结束',
      badge: '已完成',
    },
  },
  'zh-TW': {
    G0: {
      name: '現狀基線驗證',
      invariant: '驗證既有程式碼基線在未修改狀態下正常運行',
    },
    G1: {
      name: '架構規劃與設計',
      invariant: '審查程式碼庫，追蹤模組依賴，產出可驗證的執行方案',
    },
    G2: {
      name: '範圍鎖定與風險邊界',
      invariant: '明確界定改動邊界與受影響檔案，嚴格隔離範圍外檔案',
    },
    'G3.5': {
      name: '缺陷深度鎖定',
      invariant: '在修改任何程式碼前獨立推導根因函式與最小重現條件',
    },
    G4: {
      name: '測試驅動實現 (TDD)',
      invariant: '在批准的範圍內以最小且聚焦的改動驅動測試變綠',
    },
    G5: {
      name: '獨立程式碼審查',
      invariant: '進入驗證前必須由獨立代理審查 diff 與需求一致性',
    },
    G6: {
      name: '雙向真值驗證',
      invariant: '執行真實紅白反轉測試確認修復有效，且全部既有測試無回歸',
    },
    G7: {
      name: '證據綜合與交付',
      invariant: '整理結構化產出，附帶嚴格驗證的程式碼證據完成交付',
    },
    sweep: {
      name: '鄰域收斂巡檢',
      invariant: '深度巡檢關聯模組與依賴項，確保全域一致收斂',
      badge: '巡檢',
    },
    'goal-check': {
      name: '目標完備核對',
      invariant: '依據已開啟的證據逐項確認使用者原始需求全部達成',
      badge: '目標核對',
    },
    complete: {
      name: '任務圓滿完成',
      invariant: '全鏈路驗證通過，任務正式圓滿結束',
      badge: '已完成',
    },
  },
  ja: {
    G0: {
      name: '現状ベースライン検証',
      invariant: '変更前のベースラインが正常に動作することを確認',
    },
    G1: {
      name: 'アーキテクチャ計画・設計',
      invariant: 'コードベースと依存関係を調査し、検証可能な計画を作成',
    },
    G2: {
      name: 'スコープ確定とリスク境界',
      invariant: '変更対象ファイルと対象外ファイルを厳密に定義・隔離',
    },
    'G3.5': {
      name: '不具合深度特定',
      invariant: 'コード変更前に根本原因関数と最小再現条件を独立して導出',
    },
    G4: {
      name: 'テスト駆動実装 (TDD)',
      invariant: '承認されたスコープ内で最小限の変更を加えテストをパスさせる',
    },
    G5: {
      name: '独立コードレビュー',
      invariant: '検証前に独立したエージェントによる差分と整合性の監査が必須',
    },
    G6: {
      name: '真値双方向検証',
      invariant: '実際のfail-to-passテストで修正を確認し既存テストの回帰ゼロを実証',
    },
    G7: {
      name: 'エビデンス統合・成果物納品',
      invariant: '検証済みエビデンスを引用した構造化成果物を取りまとめ納品',
    },
    sweep: {
      name: '周辺モジュール・収束巡回',
      invariant: '関連モジュールと依存関係を監査し、全体の一貫性と収束を確認',
      badge: '巡回',
    },
    'goal-check': {
      name: '目標達成チェック',
      invariant: '提示されたエビデンスに基づきユーザーの全要件達成を確認',
      badge: '目標確認',
    },
    complete: {
      name: 'タスク完了',
      invariant: 'すべての検証が完了し、ミッションが正常に終了',
      badge: '完了',
    },
  },
  en: {
    G0: {
      name: 'Characterization & Baseline',
      invariant: 'Prove the untouched baseline runs',
    },
    G1: {
      name: 'Architectural Planning & Design',
      invariant: 'Inspect codebase, trace dependencies, and produce verifiable plan',
    },
    G2: {
      name: 'Scope Lock & Risk Boundary',
      invariant: 'Define exact boundary, affected files, and explicitly out-of-scope files',
    },
    'G3.5': {
      name: 'Defect Depth-Lock',
      invariant: 'Independently derive root cause function and minimal failure conditions before touching code',
    },
    G4: {
      name: 'Test-Driven Implementation',
      invariant: 'Write minimal focused changes within approved scope',
    },
    G5: {
      name: 'Independent Code Review',
      invariant: 'Mandatory author-independent review before verification',
    },
    G6: {
      name: 'Two-Sided Oracle Verification',
      invariant: 'Execute real fail-to-pass tests (confirming baseline failure and subsequent fix) or fresh isolated dual-check',
    },
    G7: {
      name: 'Evidence Synthesis & Delivery',
      invariant: 'Deliver structured final outcome citing verified evidence',
    },
    sweep: {
      name: 'Neighborhood / Convergence Sweep',
      invariant: 'Audit sibling modules and verify convergence',
      badge: 'Sweep',
    },
    'goal-check': {
      name: 'Goal Check',
      invariant: 'Confirm every mission ask on opened evidence',
      badge: 'Goal Check',
    },
    complete: {
      name: 'Completion',
      invariant: 'Mission verified and run completed',
      badge: 'Complete',
    },
  },
};

// ---------------------------------------------------------------------------
// 4. Roles Localization
// ---------------------------------------------------------------------------
export const ROLE_CATEGORIES_I18N: Record<SupportedHarnessLanguage, Record<string, string>> = {
  'zh-CN': {
    Orchestrator: '编排',
    Builder: '构建',
    Assurance: '保障',
    Strategic: '战略',
    Specialist: '专家',
  },
  'zh-TW': {
    Orchestrator: '編排',
    Builder: '構建',
    Assurance: '保障',
    Strategic: '戰略',
    Specialist: '專家',
  },
  ja: {
    Orchestrator: 'オーケストレーター',
    Builder: 'ビルダー',
    Assurance: 'アシュアランス',
    Strategic: 'ストラテジック',
    Specialist: 'スペシャリスト',
  },
  en: {
    Orchestrator: 'Orchestrator',
    Builder: 'Builder',
    Assurance: 'Assurance',
    Strategic: 'Strategic',
    Specialist: 'Specialist',
  },
};

export interface RoleLocalization {
  title: string;
  description: string;
}

export const ROLES_I18N: Record<SupportedHarnessLanguage, Record<string, RoleLocalization>> = {
  'zh-CN': {
    coordinator: {
      title: '主协调器',
      description: '负责分析目标并分解复杂工作，调度专用子代理协同推进。',
    },
    manager: {
      title: '任务主管',
      description: '统筹全局任务生命周期与资源分配。',
    },
    'scope-coordinator': {
      title: '边界协调员',
      description: '明确任务工作集边界并隔离非目标区域变更。',
    },
    'feature-coordinator': {
      title: '功能协调员',
      description: '协调并行功能分支的设计与实现推进。',
    },
    'sweep-coordinator': {
      title: '巡检协调员',
      description: '协调全局跨模块一致性巡检与收敛工作。',
    },
    planner: {
      title: '架构规划师',
      description: '分析代码库结构与依赖，制定详尽可验证的执行方案。',
    },
    'depth-prober': {
      title: '深度探针',
      description: '独立推导最深层故障根因与精准复现条件。',
    },
    implementer: {
      title: '开发实现员',
      description: '遵循严谨 TDD 规范编写最小、聚焦的改动驱动测试变绿。',
    },
    reviewer: {
      title: '代码审查员',
      description: '独立核对代码变更与需求一致性，严防回归与偷工减料。',
    },
    verifier: {
      title: '验证员',
      description: '运行真实测试验证套件，确保缺陷修复且无回归。',
    },
    'fresh-verifier': {
      title: '独立复核员',
      description: '在干净隔离环境中进行双向独立复核。',
    },
    synthesizer: {
      title: '证据综合员',
      description: '归纳总结执行证据，生成高质量交付报告。',
    },
    juror: {
      title: '仲裁评审员',
      description: '对交付质量与完成度进行最终仲裁签字。',
    },
    'goal-checker': {
      title: '目标核对员',
      description: '依据打开的真实证据逐条核对用户原始诉求达成情况。',
    },
    sweeper: {
      title: '巡检清道夫',
      description: '排查周边模块与残留文件，确保系统整洁收敛。',
    },
    architect: {
      title: '系统架构师',
      description: '评估复杂系统架构与跨模块演进路径。',
    },
    researcher: {
      title: '技术调研员',
      description: '开展方案可行性调研与原型探针验证。',
    },
    scoper: {
      title: '范围定界员',
      description: '明确界定变更文件集合与依赖影响边界。',
    },
    arbiter: {
      title: '仲裁裁决员',
      description: '在架构设计分歧中进行权威技术决策裁定。',
    },
    janitor: {
      title: '清理管理员',
      description: '清理临时测试夹具与开发调试残留项。',
    },
    scribe: {
      title: '记录整理员',
      description: '整理任务路线图与工程决策演进日志。',
    },
    'preflight-probe': {
      title: '预检探针',
      description: '执行前置环境健康度与运行时基线探查。',
    },
    're-anchor': {
      title: '基准重新锚定员',
      description: '在大幅重构后重新校准测试与运行基准。',
    },
    intake: {
      title: '输入接收入口',
      description: '解析初次用户诉求并转换为结构化任务准入。',
    },
    'framework-generator': {
      title: '框架生成器',
      description: '动态合成并注册专用的任务架构框架。',
    },
    'framework-validator': {
      title: '框架验证器',
      description: '静态校验架构图拓扑合法性与质量门约束。',
    },
    'execharness-resolver': {
      title: '执行架构解析器',
      description: '在运行时动态解析并加载项目架构快照。',
    },
  },
  'zh-TW': {
    coordinator: {
      title: '主協調器',
      description: '負責分析目標並分解複雜工作，調度專用子代理協同推進。',
    },
    manager: {
      title: '任務主管',
      description: '統籌全域任務生命週期與資源分配。',
    },
    'scope-coordinator': {
      title: '邊界協調員',
      description: '明確任務工作集邊界並隔離非目標區域變更。',
    },
    'feature-coordinator': {
      title: '功能協調員',
      description: '協調平行功能分支的設計與實現推進。',
    },
    'sweep-coordinator': {
      title: '巡檢協調員',
      description: '協調全域跨模組一致性巡檢與收斂工作。',
    },
    planner: {
      title: '架構規劃師',
      description: '分析程式碼庫結構與依賴，制定詳盡可驗證的執行方案。',
    },
    'depth-prober': {
      title: '深度探針',
      description: '獨立推導最深層故障根因與精準重現條件。',
    },
    implementer: {
      title: '開發實現員',
      description: '遵循嚴謹 TDD 規範編寫最小、聚焦的改動驅動測試變綠。',
    },
    reviewer: {
      title: '程式碼審查員',
      description: '獨立核對程式碼變更與需求一致性，嚴防回歸與偷工減料。',
    },
    verifier: {
      title: '驗證員',
      description: '運行真實測試驗證套件，確保缺陷修復且無回歸。',
    },
    'fresh-verifier': {
      title: '獨立複核員',
      description: '在乾淨隔離環境中進行雙向獨立複核。',
    },
    synthesizer: {
      title: '證據綜合員',
      description: '歸納總結執行證據，生成高品質交付報告。',
    },
    juror: {
      title: '仲裁評審員',
      description: '對交付品質與完成度進行最終仲裁簽字。',
    },
    'goal-checker': {
      title: '目標核對員',
      description: '依據開啟的真實證據逐條核對使用者原始訴求達成情況。',
    },
    sweeper: {
      title: '巡檢清道夫',
      description: '排查周邊模組與殘留檔案，確保系統整潔收斂。',
    },
    architect: {
      title: '系統架構師',
      description: '評估複雜系統架構與跨模組演進路徑。',
    },
    researcher: {
      title: '技術調研員',
      description: '開展方案可行性調研與原型探針驗證。',
    },
    scoper: {
      title: '範圍定界員',
      description: '明確界定變更檔案集合與依賴影響邊界。',
    },
    arbiter: {
      title: '仲裁裁決員',
      description: '在架構設計分歧中進行權威技術決策裁定。',
    },
    janitor: {
      title: '清理管理員',
      description: '清理臨時測試夾具與開發調試殘留項。',
    },
    scribe: {
      title: '記錄整理員',
      description: '整理任務路線圖與工程決策演進日誌。',
    },
    'preflight-probe': {
      title: '預檢探針',
      description: '執行前置環境健康度與運行時基線探查。',
    },
    're-anchor': {
      title: '基準重新錨定員',
      description: '在大幅重構後重新校準測試與運行基準。',
    },
    intake: {
      title: '輸入接收入口',
      description: '解析初次使用者訴求並轉換為結構化任務准入。',
    },
    'framework-generator': {
      title: '框架生成器',
      description: '動態合成並註冊專用的任務架構框架。',
    },
    'framework-validator': {
      title: '框架驗證器',
      description: '靜態校驗架構圖拓撲合法性與質量門約束。',
    },
    'execharness-resolver': {
      title: '執行架構解析器',
      description: '在運行時動態解析並載入專案架構快照。',
    },
  },
  ja: {
    coordinator: {
      title: 'メインコーディネーター',
      description: '目標の分析と複雑なタスクの分解、専門エージェントの統括を担当。',
    },
    manager: {
      title: 'タスクマネージャー',
      description: 'グローバルなタスクライフサイクルとリソース配分を統括。',
    },
    'scope-coordinator': {
      title: 'スコープ調整員',
      description: 'タスクの作業範囲を確定し、不要な変更から保護。',
    },
    'feature-coordinator': {
      title: '機能コーディネーター',
      description: '並列機能ブランチの設計と実装の推進を調整。',
    },
    'sweep-coordinator': {
      title: '巡回コーディネーター',
      description: 'モジュール間の一貫性巡回と収束プロセスを調整。',
    },
    planner: {
      title: 'アーキテクチャプランナー',
      description: 'コードベースと依存関係を分析し、検証可能な計画を策定。',
    },
    'depth-prober': {
      title: '根本原因プローブ',
      description: '根本原因と最小再現条件を独立して検証・導出。',
    },
    implementer: {
      title: '実装デベロッパー',
      description: 'TDDに従い最小限かつ集中した変更でテストをクリア。',
    },
    reviewer: {
      title: 'コードレビュアー',
      description: '変更差分と仕様の一致を独立検証し、デグレードを防止。',
    },
    verifier: {
      title: 'ベリファイア',
      description: '実際のテストスイートを実行し、修正完了と回帰ゼロを検証。',
    },
    'fresh-verifier': {
      title: '独立検証員',
      description: 'クリーンな隔離環境で双方向の独立再検証を実行。',
    },
    synthesizer: {
      title: '成果物シンセサイザー',
      description: '検証エビデンスを取りまとめ、高品質な納品レポートを作成。',
    },
    juror: {
      title: '評価審査員',
      description: '納品成果物の品質と要件充足度を最終審査。',
    },
    'goal-checker': {
      title: '目標チェッカー',
      description: '提示された確証に基づきユーザー要件の充足を全件照合。',
    },
    sweeper: {
      title: 'クリーンアップ巡回員',
      description: '周辺モジュールや一時ファイルを点検し整合性を維持。',
    },
    architect: {
      title: 'システムアーキテクト',
      description: '複雑なシステム設計とアーキテクチャ進化を評価。',
    },
    researcher: {
      title: 'リサーチエンジニア',
      description: '技術選定の検証とプロトタイプ探針テストを実施。',
    },
    scoper: {
      title: 'スコープアナリスト',
      description: '変更対象ファイル群と依存関係の影響範囲を定義。',
    },
    arbiter: {
      title: '裁定アービター',
      description: '設計方針の対立時に最終的な技術判断を下す。',
    },
    janitor: {
      title: 'ジャニター',
      description: '一時的なテスト資産やデバッグ残存ファイルを消去。',
    },
    scribe: {
      title: 'スクライブ',
      description: 'ロードマップとエンジニアリング決定ログを記録・整理。',
    },
    'preflight-probe': {
      title: '事前検証プローブ',
      description: '事前環境ヘルスチェックとランタイム基盤を検査。',
    },
    're-anchor': {
      title: 'リ・アンカー',
      description: '大規模リファクタリング後に基準テストを再調整。',
    },
    intake: {
      title: 'インテーク',
      description: '初期ユーザー要求を構造化ミッションへ変換。',
    },
    'framework-generator': {
      title: 'フレームワーク生成',
      description: 'タスク固有の実行フレームワークを動的に構築・登録。',
    },
    'framework-validator': {
      title: 'フレームワーク検証',
      description: 'アーキテクチャグラフのトポロジーとゲート規約を検証。',
    },
    'execharness-resolver': {
      title: '実行ハーネスリゾルバ',
      description: 'プロジェクトのハーネス構成を動的に読み込み展開。',
    },
  },
  en: {
    coordinator: {
      title: 'coordinator',
      description: 'Orchestrates complex multi-step tasks by breaking them down into disjoint lanes and delegating to specialist subagents.',
    },
    manager: {
      title: 'manager',
      description: 'Coordinates high-level task governance and multi-agent lifecycle.',
    },
    'scope-coordinator': {
      title: 'scope-coordinator',
      description: 'Governs boundary definitions and isolates out-of-scope files.',
    },
    'feature-coordinator': {
      title: 'feature-coordinator',
      description: 'Coordinates parallel implementation lanes across features.',
    },
    'sweep-coordinator': {
      title: 'sweep-coordinator',
      description: 'Coordinates convergence sweep and consistency checks.',
    },
    planner: {
      title: 'planner',
      description: 'Inspects codebase, traces dependencies, and produces verifiable implementation plans.',
    },
    'depth-prober': {
      title: 'depth-prober',
      description: 'Derives deepest root-cause function and proves adversarial reproduction test.',
    },
    implementer: {
      title: 'implementer',
      description: 'Writes minimal focused contract-correct changes strictly under test-driven rules.',
    },
    reviewer: {
      title: 'reviewer',
      description: 'Independent claim-vs-diff auditor preventing regressions and scope creep.',
    },
    verifier: {
      title: 'verifier',
      description: 'Executes real fail-to-pass test suites and verifies zero regressions.',
    },
    'fresh-verifier': {
      title: 'fresh-verifier',
      description: 'Performs independent verification in an isolated environment.',
    },
    synthesizer: {
      title: 'synthesizer',
      description: 'Synthesizes final reports citing verified evidence and artifacts.',
    },
    juror: {
      title: 'juror',
      description: 'Evaluates gate convergence and delivers final delivery sign-off.',
    },
    'goal-checker': {
      title: 'goal-checker',
      description: 'Confirms every mission ask against opened and verified evidence.',
    },
    sweeper: {
      title: 'sweeper',
      description: 'Audits sibling modules and cleans up residual artifacts.',
    },
    architect: {
      title: 'architect',
      description: 'Analyzes architectural trade-offs and structural blueprints.',
    },
    researcher: {
      title: 'researcher',
      description: 'Explores unknown APIs and conducts feasibility spikes.',
    },
    scoper: {
      title: 'scoper',
      description: 'Defines precise boundaries and out-of-scope invariants.',
    },
    arbiter: {
      title: 'arbiter',
      description: 'Decides architectural forks and resolves conflicting approaches.',
    },
    janitor: {
      title: 'janitor',
      description: 'Cleans up test files, temporary artifacts, and debug residue.',
    },
    scribe: {
      title: 'scribe',
      description: 'Maintains roadmap and technical decision journals.',
    },
    'preflight-probe': {
      title: 'preflight-probe',
      description: 'Checks baseline environment health before execution.',
    },
    're-anchor': {
      title: 're-anchor',
      description: 'Re-aligns execution anchors after large refactorings.',
    },
    intake: {
      title: 'intake',
      description: 'Parses raw user requests into structured admission intents.',
    },
    'framework-generator': {
      title: 'framework-generator',
      description: 'Synthesizes task-specific frameworks dynamically.',
    },
    'framework-validator': {
      title: 'framework-validator',
      description: 'Validates topology and gate invariants of custom graphs.',
    },
    'execharness-resolver': {
      title: 'execharness-resolver',
      description: 'Resolves and freezes harness configuration at runtime.',
    },
  },
};

// ---------------------------------------------------------------------------
// 5. Tool & Check Counter Formatting
// ---------------------------------------------------------------------------
export function formatHarnessToolsCount(count: number, language?: string): string {
  const lang = normalizeHarnessLanguage(language);
  switch (lang) {
    case 'zh-CN':
      return `${count} 项工具`;
    case 'zh-TW':
      return `${count} 項工具`;
    case 'ja':
      return `${count} 個のツール`;
    default:
      return `${count} tools`;
  }
}

export function formatHarnessChecksCount(count: number, language?: string): string {
  const lang = normalizeHarnessLanguage(language);
  switch (lang) {
    case 'zh-CN':
      return `${count} 项检查`;
    case 'zh-TW':
      return `${count} 項檢查`;
    case 'ja':
      return `${count} 項目のチェック`;
    default:
      return `${count} checks`;
  }
}

// ---------------------------------------------------------------------------
// 6. Resolution Helpers
// ---------------------------------------------------------------------------

export function getTierLocalization(id: string, rawData: Record<string, any>, language?: string) {
  const lang = normalizeHarnessLanguage(language);
  const localized = TIERS_I18N[lang]?.[id] || TIERS_I18N.en[id];
  const isDefaultName = !rawData.name || rawData.name === TIERS_I18N.en[id]?.name;
  const isDefaultDesc = !rawData.description || rawData.description === TIERS_I18N.en[id]?.description;

  return {
    name: isDefaultName && localized ? localized.name : rawData.name || rawData.label || 'Execution Tier',
    badge: localized?.badge || TIERS_I18N.en[id]?.badge || 'Tier',
    description: isDefaultDesc && localized ? localized.description : rawData.description || '',
  };
}

export function getFrameworkLocalization(id: string, rawData: Record<string, any>, language?: string) {
  const lang = normalizeHarnessLanguage(language);
  const catKey = (rawData.category || 'any').toLowerCase();
  const categoryBadge =
    FRAMEWORK_CATEGORIES_I18N[lang]?.[catKey] ||
    FRAMEWORK_CATEGORIES_I18N.en[catKey] ||
    FRAMEWORK_CATEGORIES_I18N.en.any;

  const localized = FRAMEWORKS_I18N[lang]?.[id] || FRAMEWORKS_I18N.en[id];
  const isDefaultName = !rawData.name || rawData.name === FRAMEWORKS_I18N.en[id]?.name;
  const isDefaultDesc = !rawData.description || rawData.description === FRAMEWORKS_I18N.en[id]?.description;

  return {
    name: isDefaultName && localized ? localized.name : rawData.name || rawData.label || id,
    categoryBadge,
    description: isDefaultDesc && localized ? localized.description : rawData.description || 'Execution framework',
  };
}

export function getGateLocalization(id: string, rawData: Record<string, any>, language?: string) {
  const lang = normalizeHarnessLanguage(language);
  const rawGateId = rawData.gateId || rawData.id || id || 'Gate';
  const localized = GATES_I18N[lang]?.[rawGateId] || GATES_I18N.en[rawGateId];

  const isDefaultName = !rawData.name || rawData.name === GATES_I18N.en[rawGateId]?.name;
  const isDefaultInvariant = !rawData.invariant || rawData.invariant === GATES_I18N.en[rawGateId]?.invariant;

  let badgeLabel = rawGateId;
  if (localized?.badge) {
    badgeLabel = localized.badge;
  } else if (rawGateId === 'complete') {
    badgeLabel = lang === 'zh-CN' || lang === 'zh-TW' ? '已完成' : lang === 'ja' ? '完了' : 'Complete';
  } else if (rawGateId === 'goal-check') {
    badgeLabel = lang === 'zh-CN' ? '目标核对' : lang === 'zh-TW' ? '目標核對' : lang === 'ja' ? '目標確認' : 'Goal Check';
  } else if (rawGateId === 'sweep') {
    badgeLabel = lang === 'zh-CN' ? '巡检' : lang === 'zh-TW' ? '巡檢' : lang === 'ja' ? '巡回' : 'Sweep';
  }

  return {
    name: isDefaultName && localized ? localized.name : rawData.name || rawData.label || rawGateId,
    badgeLabel,
    invariant: isDefaultInvariant && localized ? localized.invariant : rawData.invariant || 'Quality Invariant',
    checksLabel: formatHarnessChecksCount(rawData.checks?.length ?? 0, language),
  };
}

export function getRoleLocalization(id: string, rawData: Record<string, any>, language?: string) {
  const lang = normalizeHarnessLanguage(language);
  const roleId = (rawData.name || rawData.id || id || '').toLowerCase();
  const localized = ROLES_I18N[lang]?.[roleId] || ROLES_I18N.en[roleId];

  // Category classification
  let categoryKey = 'Specialist';
  if (roleId.includes('coordinator') || roleId === 'manager') {
    categoryKey = 'Orchestrator';
  } else if (roleId === 'implementer' || roleId.includes('developer') || roleId === 'scoper') {
    categoryKey = 'Builder';
  } else if (roleId.includes('review') || roleId.includes('verif') || roleId === 'juror' || roleId === 'arbiter') {
    categoryKey = 'Assurance';
  } else if (roleId === 'planner' || roleId === 'architect' || roleId === 'researcher' || roleId === 'depth-prober') {
    categoryKey = 'Strategic';
  }

  const categoryLabel =
    ROLE_CATEGORIES_I18N[lang]?.[categoryKey] ||
    ROLE_CATEGORIES_I18N.en[categoryKey] ||
    categoryKey;

  const isDefaultName = !rawData.name || rawData.name === roleId || rawData.name === ROLES_I18N.en[roleId]?.title;
  const isDefaultDesc = !rawData.description || rawData.description === ROLES_I18N.en[roleId]?.description;

  const displayName =
    lang === 'en'
      ? rawData.name || roleId || 'Agent'
      : isDefaultName && localized
      ? localized.title
      : rawData.name || roleId || 'Agent';

  // Subtitle / ID tag for role card
  const roleIdTag = roleId !== displayName.toLowerCase() ? roleId : undefined;

  const description =
    isDefaultDesc && localized ? localized.description : rawData.description || 'Specialist';

  const toolsCountLabel = formatHarnessToolsCount(
    Array.isArray(rawData.tools) ? rawData.tools.length : 0,
    language
  );

  return {
    displayName,
    roleIdTag,
    categoryLabel,
    categoryKey,
    description,
    toolsCountLabel,
  };
}
