import type { ResolvedUiLanguage } from "../../../core/ui-language.ts";

export type TranslationValue = string | Partial<Record<Intl.LDMLPluralRule, string>>;

export const en = {
	"command.settings": "Open settings menu",
	"command.language": "Select interface language",
	"command.model": "Select model (opens selector UI)",
	"command.scoped-models": "Enable/disable models for Ctrl+P cycling",
	"command.export": "Export session (HTML default, or specify path: .html/.jsonl)",
	"command.import": "Import and resume a session from a JSONL file",
	"command.share": "Share session as a secret GitHub gist",
	"command.copy": "Copy last agent message to clipboard",
	"command.name": "Set session display name",
	"command.session": "Show session info and stats",
	"command.changelog": "Show changelog entries",
	"command.hotkeys": "Show all keyboard shortcuts",
	"command.fork": "Create a new fork from a previous user message",
	"command.clone": "Duplicate the current session at the current position",
	"command.tree": "Navigate session tree (switch branches)",
	"command.trust": "Save project trust decision for future sessions",
	"command.login": "Configure provider authentication",
	"command.logout": "Remove provider authentication",
	"command.new": "Start a new session",
	"command.compact": "Manually compact the session context",
	"command.resume": "Resume a different session",
	"command.reload": "Reload keybindings, extensions, skills, prompts, and themes",
	"command.quit": "Quit {appName}",
	"common.current": "current",
	"common.none": "none",
	"common.search": "Search",
	"common.itemCount": { one: "{count} item", other: "{count} items" },
	"language.title": "Interface Language",
	"language.automatic": "Automatic",
	"language.detected": "Detected: {language}",
	"language.selected": "Interface language: {language}",
	"language.hint": "Enter select · Esc cancel",
	"header.shortcuts": "Shortcuts",
	"header.more": "More     ",
	"header.startupHelp": "{key} startup help and loaded resources",
	"header.onboarding": "Ask Metis about docs, SDK, extensions, themes, skills, or commands.",
	"header.interrupt": "interrupt",
	"header.clearExit": "clear/exit",
	"header.commands": "commands",
	"header.bash": "bash",
	"header.toInterrupt": "to interrupt",
	"header.toClear": "to clear",
	"header.toExit": "to exit",
	"header.toExitEmpty": "to exit (empty)",
	"header.toSuspend": "to suspend",
	"header.toDeleteEnd": "to delete to end",
	"header.toCycleThinking": "to cycle thinking level",
	"header.toCycleModels": "to cycle models",
	"header.toSelectModel": "to select model",
	"header.toExpandTools": "to expand tools",
	"header.toExpandThinking": "to expand thinking",
	"header.externalEditor": "for external editor",
	"header.forCommands": "for commands",
	"header.runBash": "to run bash",
	"header.runBashNoContext": "to run bash (no context)",
	"header.queueFollowUp": "to queue follow-up",
	"header.editQueued": "to edit all queued messages",
	"header.pasteImage": "to paste image",
	"header.dropFiles": "drop files",
	"header.attach": "to attach",
	"resource.context": "Context",
	"resource.skills": "Skills",
	"resource.prompts": "Prompts",
	"resource.extensions": "Extensions",
	"resource.themes": "Themes",
	"selector.noMatchingModels": "No matching models",
	"selector.modelName": "Model Name: {name}",
	"selector.searchModels": "Search models...",
	"selector.configuredProviders": "Only showing models from configured providers. Use /login to add providers.",
	"selector.scope": "Scope: ",
	"selector.all": "all",
	"selector.scoped": "scoped",
	"selector.scopeHint": "scope",
	"selector.thinkingLevel": "Thinking level",
	"thinking.off": "No reasoning",
	"thinking.minimal": "Very brief reasoning (~1k tokens)",
	"thinking.low": "Light reasoning (~2k tokens)",
	"thinking.medium": "Moderate reasoning (~8k tokens)",
	"thinking.high": "Deep reasoning (~16k tokens)",
	"thinking.xhigh": "Maximum reasoning (~32k tokens)",
	"selector.theme": "Theme",
	"status.model": "Model: {model}",
} as const satisfies Record<string, TranslationValue>;

export type MessageKey = keyof typeof en;
export type TranslationCatalog = Record<MessageKey, TranslationValue>;

const zhCN: TranslationCatalog = {
	"command.settings": "打开设置菜单", "command.language": "选择界面语言", "command.model": "选择模型（打开选择界面）",
	"command.scoped-models": "启用或禁用用于 Ctrl+P 切换的模型", "command.export": "导出会话（默认 HTML，也可指定 .html/.jsonl 路径）",
	"command.import": "导入 JSONL 会话并继续", "command.share": "将会话作为私密 GitHub gist 分享", "command.copy": "复制 Agent 上一条消息",
	"command.name": "设置会话显示名称", "command.session": "显示会话信息和统计", "command.changelog": "显示更新日志",
	"command.hotkeys": "显示全部键盘快捷键", "command.fork": "从之前的用户消息创建分支", "command.clone": "复制当前会话及当前位置",
	"command.tree": "浏览会话树（切换分支）", "command.trust": "保存项目信任决定供后续会话使用", "command.login": "配置提供商认证",
	"command.logout": "移除提供商认证", "command.new": "开始新会话", "command.compact": "手动压缩会话上下文",
	"command.resume": "继续其他会话", "command.reload": "重新加载快捷键、扩展、技能、提示和主题", "command.quit": "退出 {appName}",
	"common.current": "当前", "common.none": "无", "common.search": "搜索", "common.itemCount": { other: "{count} 项" }, "language.title": "界面语言", "language.automatic": "自动",
	"language.detected": "检测到：{language}", "language.selected": "界面语言：{language}", "language.hint": "Enter 选择 · Esc 取消",
	"header.shortcuts": "快捷键", "header.more": "更多     ", "header.startupHelp": "{key} 启动帮助和已加载资源",
	"header.onboarding": "可向 Metis 询问文档、SDK、扩展、主题、技能或命令。", "header.interrupt": "中断", "header.clearExit": "清空/退出",
	"header.commands": "命令", "header.bash": "终端", "header.toInterrupt": "中断", "header.toClear": "清空", "header.toExit": "退出",
	"header.toExitEmpty": "空输入时退出", "header.toSuspend": "挂起", "header.toDeleteEnd": "删除至行尾", "header.toCycleThinking": "切换思考级别",
	"header.toCycleModels": "切换模型", "header.toSelectModel": "选择模型", "header.toExpandTools": "展开工具", "header.toExpandThinking": "展开思考内容",
	"header.externalEditor": "使用外部编辑器", "header.forCommands": "打开命令", "header.runBash": "运行终端命令", "header.runBashNoContext": "运行终端命令（不加入上下文）",
	"header.queueFollowUp": "加入后续消息队列", "header.editQueued": "编辑全部排队消息", "header.pasteImage": "粘贴图片", "header.dropFiles": "拖入文件", "header.attach": "添加附件",
	"resource.context": "上下文", "resource.skills": "技能", "resource.prompts": "提示", "resource.extensions": "扩展", "resource.themes": "主题",
	"selector.noMatchingModels": "没有匹配的模型", "selector.modelName": "模型名称：{name}", "selector.searchModels": "搜索模型...",
	"selector.configuredProviders": "仅显示已配置提供商的模型。使用 /login 添加提供商。", "selector.scope": "范围：", "selector.all": "全部", "selector.scoped": "已限定", "selector.scopeHint": "范围",
	"selector.thinkingLevel": "思考级别", "thinking.off": "不思考", "thinking.minimal": "极简思考（约 1k token）", "thinking.low": "轻度思考（约 2k token）",
	"thinking.medium": "中度思考（约 8k token）", "thinking.high": "深度思考（约 16k token）", "thinking.xhigh": "最大思考（约 32k token）", "selector.theme": "主题", "status.model": "模型：{model}",
};

const zhTW: TranslationCatalog = {
	...zhCN,
	"command.settings": "開啟設定選單", "command.language": "選擇介面語言", "command.model": "選擇模型（開啟選擇介面）",
	"command.scoped-models": "啟用或停用用於 Ctrl+P 切換的模型", "command.export": "匯出工作階段（預設 HTML，也可指定 .html/.jsonl 路徑）",
	"command.import": "匯入 JSONL 工作階段並繼續", "command.copy": "複製 Agent 上一則訊息", "command.name": "設定工作階段顯示名稱",
	"command.session": "顯示工作階段資訊和統計", "command.changelog": "顯示更新紀錄", "command.hotkeys": "顯示全部鍵盤快速鍵",
	"command.new": "開始新工作階段", "command.resume": "繼續其他工作階段", "command.reload": "重新載入快速鍵、擴充套件、技能、提示和主題",
	"common.current": "目前", "language.title": "介面語言", "language.automatic": "自動", "language.detected": "偵測到：{language}", "language.selected": "介面語言：{language}",
	"header.shortcuts": "快速鍵", "header.more": "更多     ", "header.startupHelp": "{key} 啟動說明和已載入資源",
	"header.onboarding": "可向 Metis 詢問文件、SDK、擴充套件、主題、技能或命令。", "selector.noMatchingModels": "沒有相符的模型",
	"selector.modelName": "模型名稱：{name}", "selector.searchModels": "搜尋模型...", "selector.thinkingLevel": "思考等級", "thinking.off": "不思考", "thinking.minimal": "極簡思考（約 1k token）", "thinking.low": "輕度思考（約 2k token）", "thinking.medium": "中度思考（約 8k token）", "thinking.high": "深度思考（約 16k token）", "thinking.xhigh": "最大思考（約 32k token）", "selector.theme": "主題", "status.model": "模型：{model}",
	"selector.configuredProviders": "僅顯示已設定提供商的模型。使用 /login 新增提供商。", "selector.scope": "範圍：", "selector.all": "全部", "selector.scoped": "已限定", "selector.scopeHint": "範圍",
};

const ja: TranslationCatalog = {
	...en,
	"command.settings":"設定メニューを開く","command.language":"表示言語を選択","command.model":"モデルを選択（選択画面を開く）","command.scoped-models":"Ctrl+P で切り替えるモデルを有効化/無効化",
	"command.export":"セッションをエクスポート（既定は HTML、.html/.jsonl パスも指定可能）","command.import":"JSONL セッションをインポートして再開","command.share":"セッションを非公開 GitHub gist として共有","command.copy":"Agent の最後のメッセージをコピー",
	"command.name":"セッション表示名を設定","command.session":"セッション情報と統計を表示","command.changelog":"変更履歴を表示","command.hotkeys":"すべてのキーボードショートカットを表示","command.fork":"以前のユーザーメッセージからフォークを作成",
	"command.clone":"現在位置でセッションを複製","command.tree":"セッションツリーを移動（ブランチ切替）","command.trust":"今後のセッション用にプロジェクト信頼設定を保存","command.login":"プロバイダー認証を設定","command.logout":"プロバイダー認証を削除",
	"command.new":"新しいセッションを開始","command.compact":"セッションコンテキストを手動圧縮","command.resume":"別のセッションを再開","command.reload":"キーバインド、拡張、スキル、プロンプト、テーマを再読み込み","command.quit":"{appName} を終了",
	"common.current":"現在","common.none":"なし","common.search":"検索","language.title":"表示言語","language.automatic":"自動","language.detected":"検出：{language}","language.selected":"表示言語：{language}","language.hint":"Enter 選択 · Esc キャンセル",
	"header.shortcuts":"ショートカット","header.more":"その他   ","header.startupHelp":"{key} 起動ヘルプと読み込み済みリソース","header.onboarding":"ドキュメント、SDK、拡張、テーマ、スキル、コマンドについて Metis に質問できます。",
	"selector.noMatchingModels":"一致するモデルがありません","selector.modelName":"モデル名：{name}","selector.searchModels":"モデルを検索...","selector.thinkingLevel":"思考レベル","selector.theme":"テーマ","status.model":"モデル：{model}",
};

const ko: TranslationCatalog = {
	...en,
	"command.settings":"설정 메뉴 열기","command.language":"인터페이스 언어 선택","command.model":"모델 선택(선택 화면 열기)","command.scoped-models":"Ctrl+P 순환 모델 활성화/비활성화","command.export":"세션 내보내기(기본 HTML 또는 .html/.jsonl 경로)","command.import":"JSONL 세션 가져오기 및 재개","command.share":"세션을 비공개 GitHub gist로 공유","command.copy":"Agent의 마지막 메시지 복사","command.name":"세션 표시 이름 설정","command.session":"세션 정보와 통계 표시","command.changelog":"변경 기록 표시","command.hotkeys":"모든 키보드 단축키 표시","command.fork":"이전 사용자 메시지에서 포크 생성","command.clone":"현재 위치에서 세션 복제","command.tree":"세션 트리 탐색(브랜치 전환)","command.trust":"향후 세션을 위한 프로젝트 신뢰 결정 저장","command.login":"공급자 인증 구성","command.logout":"공급자 인증 제거","command.new":"새 세션 시작","command.compact":"세션 컨텍스트 수동 압축","command.resume":"다른 세션 재개","command.reload":"키 바인딩, 확장, 스킬, 프롬프트 및 테마 다시 로드","command.quit":"{appName} 종료",
	"common.current":"현재","common.none":"없음","common.search":"검색","language.title":"인터페이스 언어","language.automatic":"자동","language.detected":"감지됨: {language}","language.selected":"인터페이스 언어: {language}","language.hint":"Enter 선택 · Esc 취소","header.shortcuts":"단축키","header.more":"더 보기  ","header.startupHelp":"{key} 시작 도움말 및 로드된 리소스","header.onboarding":"문서, SDK, 확장, 테마, 스킬 또는 명령에 대해 Metis에 질문하세요.","selector.noMatchingModels":"일치하는 모델 없음","selector.modelName":"모델 이름: {name}","selector.searchModels":"모델 검색...","selector.thinkingLevel":"사고 수준","selector.theme":"테마","status.model":"모델: {model}",
};

const es: TranslationCatalog = {
	...en,
	"command.settings":"Abrir ajustes","command.language":"Seleccionar idioma de la interfaz","command.model":"Seleccionar modelo (abre el selector)","command.scoped-models":"Activar/desactivar modelos para alternar con Ctrl+P","command.export":"Exportar sesión (HTML por defecto o ruta .html/.jsonl)","command.import":"Importar y reanudar una sesión JSONL","command.share":"Compartir sesión como gist privado de GitHub","command.copy":"Copiar el último mensaje del Agent","command.name":"Definir nombre de la sesión","command.session":"Mostrar información y estadísticas de la sesión","command.changelog":"Mostrar registro de cambios","command.hotkeys":"Mostrar todos los atajos de teclado","command.fork":"Crear una bifurcación desde un mensaje anterior","command.clone":"Duplicar la sesión en la posición actual","command.tree":"Navegar por el árbol de la sesión","command.trust":"Guardar la decisión de confianza del proyecto","command.login":"Configurar autenticación del proveedor","command.logout":"Eliminar autenticación del proveedor","command.new":"Iniciar nueva sesión","command.compact":"Compactar manualmente el contexto","command.resume":"Reanudar otra sesión","command.reload":"Recargar teclas, extensiones, habilidades, prompts y temas","command.quit":"Salir de {appName}",
	"common.current":"actual","common.none":"ninguno","common.search":"Buscar","language.title":"Idioma de la interfaz","language.automatic":"Automático","language.detected":"Detectado: {language}","language.selected":"Idioma de la interfaz: {language}","language.hint":"Enter seleccionar · Esc cancelar","header.shortcuts":"Atajos","header.more":"Más      ","header.startupHelp":"{key} ayuda inicial y recursos cargados","header.onboarding":"Pregunta a Metis sobre documentación, SDK, extensiones, temas, habilidades o comandos.","selector.noMatchingModels":"No hay modelos coincidentes","selector.modelName":"Nombre del modelo: {name}","selector.searchModels":"Buscar modelos...","selector.thinkingLevel":"Nivel de razonamiento","selector.theme":"Tema","status.model":"Modelo: {model}",
};

const fr: TranslationCatalog = {
	...en,
	"command.settings":"Ouvrir les paramètres","command.language":"Choisir la langue de l’interface","command.model":"Choisir un modèle (ouvre le sélecteur)","command.scoped-models":"Activer/désactiver les modèles pour Ctrl+P","command.export":"Exporter la session (HTML par défaut ou chemin .html/.jsonl)","command.import":"Importer et reprendre une session JSONL","command.share":"Partager la session comme gist GitHub secret","command.copy":"Copier le dernier message de l’Agent","command.name":"Définir le nom de la session","command.session":"Afficher les informations et statistiques","command.changelog":"Afficher le journal des modifications","command.hotkeys":"Afficher tous les raccourcis clavier","command.fork":"Créer une branche depuis un ancien message","command.clone":"Dupliquer la session à la position actuelle","command.tree":"Parcourir l’arbre de session","command.trust":"Enregistrer la décision de confiance du projet","command.login":"Configurer l’authentification du fournisseur","command.logout":"Supprimer l’authentification du fournisseur","command.new":"Démarrer une nouvelle session","command.compact":"Compacter manuellement le contexte","command.resume":"Reprendre une autre session","command.reload":"Recharger raccourcis, extensions, compétences, prompts et thèmes","command.quit":"Quitter {appName}",
	"common.current":"actuel","common.none":"aucun","common.search":"Rechercher","language.title":"Langue de l’interface","language.automatic":"Automatique","language.detected":"Détectée : {language}","language.selected":"Langue de l’interface : {language}","language.hint":"Entrée sélectionner · Échap annuler","header.shortcuts":"Raccourcis","header.more":"Plus     ","header.startupHelp":"{key} aide au démarrage et ressources chargées","header.onboarding":"Interrogez Metis sur la documentation, le SDK, les extensions, thèmes, compétences ou commandes.","selector.noMatchingModels":"Aucun modèle correspondant","selector.modelName":"Nom du modèle : {name}","selector.searchModels":"Rechercher des modèles...","selector.thinkingLevel":"Niveau de réflexion","selector.theme":"Thème","status.model":"Modèle : {model}",
};

const de: TranslationCatalog = {
	...en,
	"command.settings":"Einstellungen öffnen","command.language":"Oberflächensprache wählen","command.model":"Modell auswählen (öffnet Auswahl)","command.scoped-models":"Modelle für Ctrl+P aktivieren/deaktivieren","command.export":"Sitzung exportieren (Standard HTML oder .html/.jsonl-Pfad)","command.import":"JSONL-Sitzung importieren und fortsetzen","command.share":"Sitzung als geheimen GitHub-Gist teilen","command.copy":"Letzte Agent-Nachricht kopieren","command.name":"Sitzungsnamen festlegen","command.session":"Sitzungsinformationen und Statistiken anzeigen","command.changelog":"Änderungsprotokoll anzeigen","command.hotkeys":"Alle Tastenkürzel anzeigen","command.fork":"Fork aus früherer Benutzernachricht erstellen","command.clone":"Sitzung an aktueller Position duplizieren","command.tree":"Sitzungsbaum navigieren","command.trust":"Projektvertrauen für künftige Sitzungen speichern","command.login":"Anbieter-Authentifizierung konfigurieren","command.logout":"Anbieter-Authentifizierung entfernen","command.new":"Neue Sitzung starten","command.compact":"Sitzungskontext manuell komprimieren","command.resume":"Andere Sitzung fortsetzen","command.reload":"Tasten, Erweiterungen, Skills, Prompts und Themes neu laden","command.quit":"{appName} beenden",
	"common.current":"aktuell","common.none":"keine","common.search":"Suchen","language.title":"Oberflächensprache","language.automatic":"Automatisch","language.detected":"Erkannt: {language}","language.selected":"Oberflächensprache: {language}","language.hint":"Enter auswählen · Esc abbrechen","header.shortcuts":"Kürzel","header.more":"Mehr     ","header.startupHelp":"{key} Starthilfe und geladene Ressourcen","header.onboarding":"Fragen Sie Metis nach Doku, SDK, Erweiterungen, Themes, Skills oder Befehlen.","selector.noMatchingModels":"Keine passenden Modelle","selector.modelName":"Modellname: {name}","selector.searchModels":"Modelle suchen...","selector.thinkingLevel":"Denkstufe","selector.theme":"Theme","status.model":"Modell: {model}",
};

const pt: TranslationCatalog = {
	...en,
	"command.settings":"Abrir configurações","command.language":"Selecionar idioma da interface","command.model":"Selecionar modelo (abre o seletor)","command.scoped-models":"Ativar/desativar modelos para Ctrl+P","command.export":"Exportar sessão (HTML padrão ou caminho .html/.jsonl)","command.import":"Importar e retomar uma sessão JSONL","command.share":"Compartilhar sessão como gist secreto do GitHub","command.copy":"Copiar última mensagem do Agent","command.name":"Definir nome da sessão","command.session":"Mostrar informações e estatísticas","command.changelog":"Mostrar histórico de alterações","command.hotkeys":"Mostrar todos os atalhos","command.fork":"Criar ramificação de uma mensagem anterior","command.clone":"Duplicar sessão na posição atual","command.tree":"Navegar na árvore da sessão","command.trust":"Salvar decisão de confiança do projeto","command.login":"Configurar autenticação do provedor","command.logout":"Remover autenticação do provedor","command.new":"Iniciar nova sessão","command.compact":"Compactar manualmente o contexto","command.resume":"Retomar outra sessão","command.reload":"Recarregar teclas, extensões, habilidades, prompts e temas","command.quit":"Sair do {appName}",
	"common.current":"atual","common.none":"nenhum","common.search":"Pesquisar","language.title":"Idioma da interface","language.automatic":"Automático","language.detected":"Detectado: {language}","language.selected":"Idioma da interface: {language}","language.hint":"Enter selecionar · Esc cancelar","header.shortcuts":"Atalhos","header.more":"Mais     ","header.startupHelp":"{key} ajuda inicial e recursos carregados","header.onboarding":"Pergunte ao Metis sobre documentação, SDK, extensões, temas, habilidades ou comandos.","selector.noMatchingModels":"Nenhum modelo correspondente","selector.modelName":"Nome do modelo: {name}","selector.searchModels":"Pesquisar modelos...","selector.thinkingLevel":"Nível de raciocínio","selector.theme":"Tema","status.model":"Modelo: {model}",
};

const ru: TranslationCatalog = {
	...en,
	"common.itemCount": { one: "{count} элемент", few: "{count} элемента", many: "{count} элементов", other: "{count} элемента" },
	"command.settings":"Открыть настройки","command.language":"Выбрать язык интерфейса","command.model":"Выбрать модель (открывает список)","command.scoped-models":"Включить/отключить модели для Ctrl+P","command.export":"Экспортировать сессию (HTML или путь .html/.jsonl)","command.import":"Импортировать и продолжить JSONL-сессию","command.share":"Поделиться сессией как секретным GitHub gist","command.copy":"Скопировать последнее сообщение Agent","command.name":"Задать имя сессии","command.session":"Показать сведения и статистику","command.changelog":"Показать журнал изменений","command.hotkeys":"Показать все сочетания клавиш","command.fork":"Создать ветку из предыдущего сообщения","command.clone":"Дублировать сессию в текущей позиции","command.tree":"Навигация по дереву сессии","command.trust":"Сохранить доверие к проекту","command.login":"Настроить аутентификацию провайдера","command.logout":"Удалить аутентификацию провайдера","command.new":"Начать новую сессию","command.compact":"Вручную сжать контекст сессии","command.resume":"Продолжить другую сессию","command.reload":"Перезагрузить клавиши, расширения, навыки, промпты и темы","command.quit":"Выйти из {appName}",
	"common.current":"текущий","common.none":"нет","common.search":"Поиск","language.title":"Язык интерфейса","language.automatic":"Автоматически","language.detected":"Определён: {language}","language.selected":"Язык интерфейса: {language}","language.hint":"Enter выбрать · Esc отменить","header.shortcuts":"Клавиши","header.more":"Ещё      ","header.startupHelp":"{key} справка и загруженные ресурсы","header.onboarding":"Спросите Metis о документации, SDK, расширениях, темах, навыках или командах.","selector.noMatchingModels":"Подходящих моделей нет","selector.modelName":"Имя модели: {name}","selector.searchModels":"Поиск моделей...","selector.thinkingLevel":"Уровень рассуждения","selector.theme":"Тема","status.model":"Модель: {model}",
};

const it: TranslationCatalog = {
	...en,
	"command.settings":"Apri impostazioni","command.language":"Seleziona lingua dell’interfaccia","command.model":"Seleziona modello (apre il selettore)","command.scoped-models":"Abilita/disabilita modelli per Ctrl+P","command.export":"Esporta sessione (HTML predefinito o percorso .html/.jsonl)","command.import":"Importa e riprendi una sessione JSONL","command.share":"Condividi la sessione come gist GitHub segreto","command.copy":"Copia l’ultimo messaggio dell’Agent","command.name":"Imposta nome della sessione","command.session":"Mostra informazioni e statistiche","command.changelog":"Mostra registro modifiche","command.hotkeys":"Mostra tutte le scorciatoie","command.fork":"Crea un fork da un messaggio precedente","command.clone":"Duplica la sessione nella posizione attuale","command.tree":"Naviga nell’albero della sessione","command.trust":"Salva la decisione di attendibilità del progetto","command.login":"Configura autenticazione del provider","command.logout":"Rimuovi autenticazione del provider","command.new":"Avvia nuova sessione","command.compact":"Compatta manualmente il contesto","command.resume":"Riprendi un’altra sessione","command.reload":"Ricarica tasti, estensioni, skill, prompt e temi","command.quit":"Esci da {appName}",
	"common.current":"corrente","common.none":"nessuno","common.search":"Cerca","language.title":"Lingua dell’interfaccia","language.automatic":"Automatico","language.detected":"Rilevata: {language}","language.selected":"Lingua dell’interfaccia: {language}","language.hint":"Invio seleziona · Esc annulla","header.shortcuts":"Scorciatoie","header.more":"Altro    ","header.startupHelp":"{key} guida iniziale e risorse caricate","header.onboarding":"Chiedi a Metis informazioni su documentazione, SDK, estensioni, temi, skill o comandi.","selector.noMatchingModels":"Nessun modello corrispondente","selector.modelName":"Nome modello: {name}","selector.searchModels":"Cerca modelli...","selector.thinkingLevel":"Livello di ragionamento","selector.theme":"Tema","status.model":"Modello: {model}",
};

const selectorOverrides: Record<ResolvedUiLanguage, Partial<TranslationCatalog>> = {
	en: {}, "zh-CN": {}, "zh-TW": {},
	ja: {
		"selector.configuredProviders":"設定済みプロバイダーのモデルのみ表示しています。/login で追加できます。","selector.scope":"範囲：","selector.all":"すべて","selector.scoped":"限定","selector.scopeHint":"範囲",
		"thinking.off":"推論なし","thinking.minimal":"ごく短い推論（約1kトークン）","thinking.low":"軽い推論（約2kトークン）","thinking.medium":"中程度の推論（約8kトークン）","thinking.high":"深い推論（約16kトークン）","thinking.xhigh":"最大の推論（約32kトークン）",
	},
	ko: {
		"selector.configuredProviders":"구성된 공급자의 모델만 표시합니다. /login으로 공급자를 추가하세요.","selector.scope":"범위: ","selector.all":"전체","selector.scoped":"제한됨","selector.scopeHint":"범위",
		"thinking.off":"추론 없음","thinking.minimal":"매우 짧은 추론(약 1k 토큰)","thinking.low":"가벼운 추론(약 2k 토큰)","thinking.medium":"보통 추론(약 8k 토큰)","thinking.high":"깊은 추론(약 16k 토큰)","thinking.xhigh":"최대 추론(약 32k 토큰)",
	},
	es: {
		"selector.configuredProviders":"Solo se muestran modelos de proveedores configurados. Usa /login para añadirlos.","selector.scope":"Ámbito: ","selector.all":"todos","selector.scoped":"limitados","selector.scopeHint":"ámbito",
		"thinking.off":"Sin razonamiento","thinking.minimal":"Razonamiento muy breve (~1k tokens)","thinking.low":"Razonamiento ligero (~2k tokens)","thinking.medium":"Razonamiento moderado (~8k tokens)","thinking.high":"Razonamiento profundo (~16k tokens)","thinking.xhigh":"Razonamiento máximo (~32k tokens)",
	},
	fr: {
		"selector.configuredProviders":"Seuls les modèles des fournisseurs configurés sont affichés. Utilisez /login pour en ajouter.","selector.scope":"Portée : ","selector.all":"tous","selector.scoped":"limités","selector.scopeHint":"portée",
		"thinking.off":"Aucun raisonnement","thinking.minimal":"Raisonnement très bref (~1k jetons)","thinking.low":"Raisonnement léger (~2k jetons)","thinking.medium":"Raisonnement modéré (~8k jetons)","thinking.high":"Raisonnement approfondi (~16k jetons)","thinking.xhigh":"Raisonnement maximal (~32k jetons)",
	},
	de: {
		"selector.configuredProviders":"Nur Modelle konfigurierter Anbieter werden angezeigt. Mit /login Anbieter hinzufügen.","selector.scope":"Bereich: ","selector.all":"alle","selector.scoped":"begrenzt","selector.scopeHint":"Bereich",
		"thinking.off":"Kein Schlussfolgern","thinking.minimal":"Sehr kurzes Schlussfolgern (~1k Token)","thinking.low":"Leichtes Schlussfolgern (~2k Token)","thinking.medium":"Mittleres Schlussfolgern (~8k Token)","thinking.high":"Tiefes Schlussfolgern (~16k Token)","thinking.xhigh":"Maximales Schlussfolgern (~32k Token)",
	},
	pt: {
		"selector.configuredProviders":"Mostrando apenas modelos de provedores configurados. Use /login para adicionar provedores.","selector.scope":"Escopo: ","selector.all":"todos","selector.scoped":"limitados","selector.scopeHint":"escopo",
		"thinking.off":"Sem raciocínio","thinking.minimal":"Raciocínio muito breve (~1k tokens)","thinking.low":"Raciocínio leve (~2k tokens)","thinking.medium":"Raciocínio moderado (~8k tokens)","thinking.high":"Raciocínio profundo (~16k tokens)","thinking.xhigh":"Raciocínio máximo (~32k tokens)",
	},
	ru: {
		"selector.configuredProviders":"Показаны только модели настроенных провайдеров. Добавьте провайдера через /login.","selector.scope":"Область: ","selector.all":"все","selector.scoped":"ограниченные","selector.scopeHint":"область",
		"thinking.off":"Без рассуждения","thinking.minimal":"Очень краткое рассуждение (~1k токенов)","thinking.low":"Лёгкое рассуждение (~2k токенов)","thinking.medium":"Умеренное рассуждение (~8k токенов)","thinking.high":"Глубокое рассуждение (~16k токенов)","thinking.xhigh":"Максимальное рассуждение (~32k токенов)",
	},
	it: {
		"selector.configuredProviders":"Sono mostrati solo i modelli dei provider configurati. Usa /login per aggiungerne.","selector.scope":"Ambito: ","selector.all":"tutti","selector.scoped":"limitati","selector.scopeHint":"ambito",
		"thinking.off":"Nessun ragionamento","thinking.minimal":"Ragionamento molto breve (~1k token)","thinking.low":"Ragionamento leggero (~2k token)","thinking.medium":"Ragionamento moderato (~8k token)","thinking.high":"Ragionamento profondo (~16k token)","thinking.xhigh":"Ragionamento massimo (~32k token)",
	},
};

const resourceOverrides: Record<ResolvedUiLanguage, Partial<TranslationCatalog>> = {
	en: {}, "zh-CN": {},
	"zh-TW": { "resource.context":"上下文", "resource.skills":"技能", "resource.prompts":"提示", "resource.extensions":"擴充套件", "resource.themes":"主題" },
	ja: { "resource.context":"コンテキスト", "resource.skills":"スキル", "resource.prompts":"プロンプト", "resource.extensions":"拡張", "resource.themes":"テーマ" },
	ko: { "resource.context":"컨텍스트", "resource.skills":"스킬", "resource.prompts":"프롬프트", "resource.extensions":"확장", "resource.themes":"테마" },
	es: { "resource.context":"Contexto", "resource.skills":"Habilidades", "resource.prompts":"Prompts", "resource.extensions":"Extensiones", "resource.themes":"Temas" },
	fr: { "resource.context":"Contexte", "resource.skills":"Compétences", "resource.prompts":"Prompts", "resource.extensions":"Extensions", "resource.themes":"Thèmes" },
	de: { "resource.context":"Kontext", "resource.skills":"Skills", "resource.prompts":"Prompts", "resource.extensions":"Erweiterungen", "resource.themes":"Themes" },
	pt: { "resource.context":"Contexto", "resource.skills":"Habilidades", "resource.prompts":"Prompts", "resource.extensions":"Extensões", "resource.themes":"Temas" },
	ru: { "resource.context":"Контекст", "resource.skills":"Навыки", "resource.prompts":"Промпты", "resource.extensions":"Расширения", "resource.themes":"Темы" },
	it: { "resource.context":"Contesto", "resource.skills":"Skill", "resource.prompts":"Prompt", "resource.extensions":"Estensioni", "resource.themes":"Temi" },
};

export const CATALOGS: Record<ResolvedUiLanguage, TranslationCatalog> = {
	en,
	"zh-CN": zhCN,
	"zh-TW": { ...zhTW, ...resourceOverrides["zh-TW"] },
	ja: { ...ja, ...selectorOverrides.ja, ...resourceOverrides.ja },
	ko: { ...ko, ...selectorOverrides.ko, ...resourceOverrides.ko },
	es: { ...es, ...selectorOverrides.es, ...resourceOverrides.es },
	fr: { ...fr, ...selectorOverrides.fr, ...resourceOverrides.fr },
	de: { ...de, ...selectorOverrides.de, ...resourceOverrides.de },
	pt: { ...pt, ...selectorOverrides.pt, ...resourceOverrides.pt },
	ru: { ...ru, ...selectorOverrides.ru, ...resourceOverrides.ru },
	it: { ...it, ...selectorOverrides.it, ...resourceOverrides.it },
};
