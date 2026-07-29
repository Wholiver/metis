(() => {
	const languages = ["auto", "en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "it"];
	const copy = {
			en: {
			dreamOff: "Dream: Off", dreamDone: "Dream: Done", dreaming: "Dreaming...", dreamRetry: "Dream: Retry scheduled", dreamFailed: "Dream: Failed", dreamPending: "Dream: Pending", namingTitle: "Generating title...", untitledTask: "Untitled task",
			thinkingOff: "Off", thinkingMinimal: "Minimal", thinkingLow: "Low", thinkingMedium: "Medium", thinkingHigh: "High", thinkingXhigh: "Extra high",
			noModels: "No models available", loadAfterConnect: "Connect to Server to load", loadModelsAfterConnect: "Connect to Server to load models", modelUnsupported: "Not supported by current model",
			agentFeedbackConnected: "Model, reasoning, and context settings apply immediately and are saved. Reload resources to apply the Agent / TUI language.",
			agentFeedbackDisconnected: "Connect to Server to modify Agent settings.",
			behaviorFeedbackConnected: "Queue modes apply immediately and are saved. Compact now runs once and does not change automatic compaction.",
			behaviorFeedbackDisconnected: "Connect to Server to modify interaction settings.",
			connected: "Connected", disconnected: "Disconnected", currentWorkspace: "Current workspace", noWorkspace: "No workspace selected", workspaceReadFailed: "Unable to read workspace information", version: "Version {version}", serverConnectFailed: "Unable to connect to local Server", languageSaved: "Desktop language changed to {language}. Agent / TUI will apply it after resources reload.", newTaskReady: "New task ready", newTaskReadyDescription: "Agent replies and run status will appear here after you send a message.", agentWorking: "Agent is working", compactingContext: "Compacting context", messageQueued: "Message queued", stopping: "Stopping", stopGeneration: "Stop generating", contextUsage: "Context: {tokens} / {limit} ({percent}%)", subagentNone: "None", subagentRunningCount: "{count} running",
		},
		"zh-CN": {
			dreamOff: "梦境：已关闭", dreamDone: "梦境：已完成", dreaming: "梦境进行中…", dreamRetry: "梦境：已安排重试", dreamFailed: "梦境：失败", dreamPending: "梦境：等待中", namingTitle: "正在生成标题…", untitledTask: "未命名任务",
			thinkingOff: "关闭", thinkingMinimal: "最低", thinkingLow: "低", thinkingMedium: "中", thinkingHigh: "高", thinkingXhigh: "极高",
			noModels: "没有可用模型", loadAfterConnect: "连接 Server 后载入", loadModelsAfterConnect: "连接 Server 后载入模型", modelUnsupported: "当前模型不支持",
			agentFeedbackConnected: "模型、推理和上下文策略会立即应用并保存；Agent / TUI 语言需重载资源后生效。",
			agentFeedbackDisconnected: "连接 Server 后可修改 Agent 设置。",
			behaviorFeedbackConnected: "队列模式会立即应用并保存；“立即压缩”只执行一次，不会更改自动压缩策略。",
			behaviorFeedbackDisconnected: "连接 Server 后可修改交互设置。",
			connected: "已连接", disconnected: "未连接", currentWorkspace: "当前工作区", noWorkspace: "未选择工作区", workspaceReadFailed: "无法读取工作区信息", version: "版本 {version}", serverConnectFailed: "未能连接本地 Server", languageSaved: "Desktop 语言已切换为 {language}；Agent / TUI 将在重载资源后应用。", newTaskReady: "新任务已就绪", newTaskReadyDescription: "输入消息后，Agent 回复和运行状态会实时同步到这里。", agentWorking: "Agent 正在处理", compactingContext: "正在压缩上下文", messageQueued: "消息已加入队列", stopping: "正在停止", stopGeneration: "停止生成", contextUsage: "上下文: {tokens} / {limit} ({percent}%)", subagentNone: "无", subagentRunningCount: "{count} 个运行中",
		},
		"zh-TW": {
			dreamOff: "夢境：已關閉", dreamDone: "夢境：已完成", dreaming: "夢境進行中…", dreamRetry: "夢境：已安排重試", dreamFailed: "夢境：失敗", dreamPending: "夢境：等待中", namingTitle: "正在產生標題…", untitledTask: "未命名任務",
			thinkingOff: "關閉", thinkingMinimal: "最低", thinkingLow: "低", thinkingMedium: "中", thinkingHigh: "高", thinkingXhigh: "極高", languageSaved: "Desktop 語言已切換為 {language}；Agent / TUI 將在重新載入資源後套用。", newTaskReady: "新任務已就緒", newTaskReadyDescription: "傳送訊息後，Agent 回覆和執行狀態會即時顯示在這裡。", agentWorking: "Agent 正在處理", compactingContext: "正在壓縮上下文", messageQueued: "訊息已加入佇列", stopping: "正在停止", stopGeneration: "停止產生", contextUsage: "上下文：{tokens} / {limit} ({percent}%)", subagentNone: "無", subagentRunningCount: "{count} 個執行中",
		},
		ja: { dreamOff: "Dream：オフ", dreamDone: "Dream：完了", dreaming: "Dream 実行中…", dreamRetry: "Dream：再試行予定", dreamFailed: "Dream：失敗", dreamPending: "Dream：待機中", namingTitle: "タイトルを生成中…", untitledTask: "無題のタスク", thinkingOff: "オフ", thinkingMinimal: "最小", thinkingLow: "低", thinkingMedium: "中", thinkingHigh: "高", thinkingXhigh: "最高" },
		ko: { dreamOff: "Dream: 꺼짐", dreamDone: "Dream: 완료", dreaming: "Dream 실행 중…", dreamRetry: "Dream: 재시도 예정", dreamFailed: "Dream: 실패", dreamPending: "Dream: 대기 중", namingTitle: "제목 생성 중…", untitledTask: "제목 없는 작업", thinkingOff: "끔", thinkingMinimal: "최소", thinkingLow: "낮음", thinkingMedium: "중간", thinkingHigh: "높음", thinkingXhigh: "매우 높음" },
		es: { dreamOff: "Dream: desactivado", dreamDone: "Dream: completado", dreaming: "Dream en curso…", dreamRetry: "Dream: reintento programado", dreamFailed: "Dream: falló", dreamPending: "Dream: pendiente", namingTitle: "Generando título…", untitledTask: "Tarea sin título", thinkingOff: "Desactivado", thinkingMinimal: "Mínimo", thinkingLow: "Bajo", thinkingMedium: "Medio", thinkingHigh: "Alto", thinkingXhigh: "Muy alto" },
		fr: { dreamOff: "Dream : désactivé", dreamDone: "Dream : terminé", dreaming: "Dream en cours…", dreamRetry: "Dream : nouvel essai planifié", dreamFailed: "Dream : échec", dreamPending: "Dream : en attente", namingTitle: "Génération du titre…", untitledTask: "Tâche sans titre", thinkingOff: "Désactivé", thinkingMinimal: "Minimal", thinkingLow: "Faible", thinkingMedium: "Moyen", thinkingHigh: "Élevé", thinkingXhigh: "Très élevé" },
		de: { dreamOff: "Dream: Aus", dreamDone: "Dream: Fertig", dreaming: "Dream läuft…", dreamRetry: "Dream: Wiederholung geplant", dreamFailed: "Dream: Fehlgeschlagen", dreamPending: "Dream: Ausstehend", namingTitle: "Titel wird erstellt…", untitledTask: "Unbenannte Aufgabe", thinkingOff: "Aus", thinkingMinimal: "Minimal", thinkingLow: "Niedrig", thinkingMedium: "Mittel", thinkingHigh: "Hoch", thinkingXhigh: "Sehr hoch" },
		pt: { dreamOff: "Dream: desativado", dreamDone: "Dream: concluído", dreaming: "Dream em andamento…", dreamRetry: "Dream: nova tentativa agendada", dreamFailed: "Dream: falhou", dreamPending: "Dream: pendente", namingTitle: "Gerando título…", untitledTask: "Tarefa sem título", thinkingOff: "Desativado", thinkingMinimal: "Mínimo", thinkingLow: "Baixo", thinkingMedium: "Médio", thinkingHigh: "Alto", thinkingXhigh: "Muito alto" },
		ru: { dreamOff: "Dream: выключен", dreamDone: "Dream: готово", dreaming: "Dream выполняется…", dreamRetry: "Dream: повтор запланирован", dreamFailed: "Dream: ошибка", dreamPending: "Dream: ожидает", namingTitle: "Создание заголовка…", untitledTask: "Задача без названия", thinkingOff: "Выкл.", thinkingMinimal: "Минимум", thinkingLow: "Низкий", thinkingMedium: "Средний", thinkingHigh: "Высокий", thinkingXhigh: "Очень высокий" },
		it: { dreamOff: "Dream: disattivato", dreamDone: "Dream: completato", dreaming: "Dream in corso…", dreamRetry: "Dream: nuovo tentativo pianificato", dreamFailed: "Dream: non riuscito", dreamPending: "Dream: in attesa", namingTitle: "Generazione titolo…", untitledTask: "Attività senza titolo", thinkingOff: "Disattivato", thinkingMinimal: "Minimo", thinkingLow: "Basso", thinkingMedium: "Medio", thinkingHigh: "Alto", thinkingXhigh: "Molto alto" },
	};

	const phrases = [
		["startingMetis", "正在启动 Metis", "Starting Metis"],
		["connectingLocalServer", "正在连接本地 Server…", "Connecting to local Server…"],
		["connectionSettings", "连接设置", "Connection settings"],
		["mainNavigation", "主导航", "Main navigation"],
		["newTask", "新建任务", "New task"],
		["projects", "项目", "Projects"],
		["noProjects", "暂无项目", "No projects"],
		["addProject", "添加项目", "Add project"],
		["removeProject", "移除项目", "Remove project"],
		["switchProject", "切换工作项目", "Switch project"],
		["showMoreConversations", "展开显示", "Show more"],
		["showLessConversations", "收起显示", "Show less"],
		["projectConversations", "按项目分组的对话", "Conversations grouped by project"],
		["settings", "设置", "Settings"],
		["serverDisconnected", "未连接 Server", "Server disconnected"],
		["collapseSidebar", "收起侧栏", "Collapse sidebar"],
		["expandSidebar", "展开侧栏", "Expand sidebar"],
		["startTask", "连接 Metis Server 开始任务", "Connect to Metis Server to start a task"],
		["serverSyncDescription", "会话消息、模型和运行状态会从本地 Server 同步。", "Messages, models, and run status sync from the local Server."],
		["connectServer", "连接 Server", "Connect Server"],
		["agentWorking", "Agent 正在处理", "Agent is working"],
		["subagentTask", "Subagent 任务", "Subagent task"],
		["subagentRunning", "运行中", "Running"],
		["subagentCompleted", "已完成", "Completed"],
		["subagentFailed", "运行失败", "Failed"],
		["subagentWorking", "正在后台处理任务", "Working in background"],
		["subagentTaskDetail", "任务详情", "Task details"],
		["queuedMessages", "排队消息", "Queued messages"],
		["queueAfterAgent", "Agent 完成后自动发送", "Sends after Agent finishes"],
		["composerPlaceholder", "随心输入", "Ask anything"],
		["uploadFile", "上传文件或图片", "Upload file or image"],
		["selectModel", "选择模型", "Select model"],
		["model", "模型", "Model"],
		["advanced", "高级", "Advanced"],
		["thinkingLevel", "思考等级", "Thinking level"],
		["send", "发送", "Send"],
		["newTab", "新建标签页", "New tab"],
		["review", "审阅", "Review"],
		["browser", "浏览器", "Browser"],
		["files", "文件", "Files"],
		["back", "后退", "Back"],
		["forward", "前进", "Forward"],
		["refresh", "刷新", "Refresh"],
		["address", "网址", "Address"],
		["openSystemBrowser", "在系统浏览器打开", "Open in system browser"],
		["ready", "就绪", "Ready"],
		["isolatedSession", "隔离会话", "Isolated session"],
		["noFileSelected", "未选择文件", "No file selected"],
		["waitingForFile", "等待选择文件", "Waiting for file selection"],
		["revealInFinder", "在 Finder 中显示", "Show in Finder"],
		["revealInExplorer", "在资源管理器中显示", "Show in File Explorer"],
		["chooseFileForDiff", "选择一个文件查看变更", "Select a file to review changes"],
		["openFromFileTree", "从文件树中点击文件打开", "Open a file from the file tree"],
		["workspace", "工作区", "Workspace"],
		["filterFiles", "筛选文件", "Filter files"],
		["readingWorkspace", "正在读取工作区…", "Reading workspace…"],
		["backToMetis", "返回 Metis", "Back to Metis"],
		["searchSettings", "搜索设置…", "Search settings…"],
		["settingsCategories", "设置分类", "Settings categories"],
		["agent", "Agent", "Agent"],
		["interaction", "交互", "Interaction"],
		["session", "会话", "Session"],
		["accountSecurity", "账户与安全", "Account & security"],
		["connection", "连接", "Connection"],
		["about", "关于", "About"],
		["noMatchingSettings", "没有匹配的设置", "No matching settings"],
		["agentPageDescription", "管理当前 Agent 会话及后续新会话使用的模型、推理和上下文默认值。", "Manage model, reasoning, and context defaults for the current Agent session and future sessions."],
		["modelSection", "模型", "Model"],
		["currentModel", "当前模型", "Current model"],
		["currentModelDescription", "立即切换当前会话，并保存为后续新会话的默认模型。", "Switch the current session immediately and save it as the default for future sessions."],
		["thinkingDescription", "控制推理深度并保存为默认值。可选等级由当前模型决定；切换模型时会自动调整到新模型支持的最近等级。", "Control reasoning depth and save it as the default. Available levels depend on the current model."],
		["unavailable", "不可用", "Unavailable"],
		["context", "上下文", "Context"],
		["autoCompact", "自动压缩（持续策略）", "Automatic compaction (persistent)"],
		["autoCompactDescription", "上下文接近模型上限时自动生成摘要。它是持续生效的默认策略，不会立即压缩；立即执行请用“交互 → 手动压缩”。", "Automatically summarize when context approaches the model limit. This persistent policy does not compact immediately."],
		["general", "常规", "General"],
		["interfaceLanguage", "界面语言", "Interface language"],
		["interfaceLanguageDescription", "统一设置 Desktop 动态状态与 Agent / TUI 语言；Desktop 状态立即生效，Agent / TUI 重载后生效。", "Set the Desktop and Agent / TUI language together. Desktop changes immediately; Agent / TUI changes after resources reload."],
		["loadModelsAfterConnect", "连接 Server 后载入模型", "Connect to Server to load models"],
		["thinkingHigh", "高", "High"],
		["agentFeedbackDisconnected", "连接 Server 后可修改 Agent 设置。", "Connect to Server to modify Agent settings."],
		["loadAfterConnect", "连接 Server 后载入", "Connect to Server to load"],
		["behaviorPageDescription", "控制 Agent 忙碌期间消息如何进入当前运行，以及上下文何时压缩。", "Control how messages enter the current run while Agent is busy and when context is compacted."],
		["behaviorFeedbackDisconnected", "连接 Server 后可修改交互设置。", "Connect to Server to modify interaction settings."],
		["messageQueue", "消息队列", "Message queue"],
		["steeringMode", "Steering 模式", "Steering mode"],
		["steeringDescription", "仅处理 Agent 正在生成时发送的“立即指导”。逐条：每次交付一条并等待响应；全部：把已排队指导一次性交付。", "Controls immediate guidance sent while Agent is generating. One at a time waits for each response; All delivers the entire queued guidance."],
		["followUpMode", "Follow-up 模式", "Follow-up mode"],
		["followUpDescription", "仅处理等待 Agent 本轮结束后再发送的消息。逐条：一问一答；全部：本轮结束后一次性交付全部排队消息。", "Controls messages sent after the current run. One at a time alternates messages and responses; All delivers the full queue after the run."],
		["oneAtATime", "逐条", "One at a time"],
		["all", "全部", "All"],
		["contextMaintenance", "上下文维护", "Context maintenance"],
		["compactNowAction", "立即压缩（一次性操作）", "Compact now (one-time action)"],
		["compactNowDescription", "马上为当前会话生成一次上下文摘要，不会改变上方“自动压缩”开关。说明文字只影响这一次摘要。", "Generate a context summary for the current session now without changing automatic compaction. Instructions apply only to this summary."],
		["compactNow", "立即压缩", "Compact now"],
		["compactInstructions", "压缩说明（可选）", "Compaction instructions (optional)"],
		["sessionPageDescription", "管理当前会话、历史会话、分支和导入导出。", "Manage the current session, history, branches, imports, and exports."],
		["sessionFeedbackDisconnected", "连接 Server 后载入会话信息。", "Connect to Server to load session information."],
		["currentSession", "当前会话", "Current session"],
		["sessionName", "会话名称", "Session name"],
		["loadingStats", "正在载入统计…", "Loading statistics…"],
		["save", "保存", "Save"],
		["copyLastReply", "复制最后回复", "Copy last reply"],
		["copyLastReplyDescription", "只复制最近一条已完成的 Agent 文本消息；不会复制思考过程、工具输出或仍在生成的内容。", "Copy only the latest completed Agent text message, excluding reasoning, tool output, and incomplete content."],
		["copy", "复制", "Copy"],
		["cloneSession", "克隆会话", "Clone session"],
		["cloneSessionDescription", "复制当前分支截至当前位置的完整历史，创建新会话；原会话保持不变。", "Create a new session by copying the current branch history up to this point. The original session is unchanged."],
		["clone", "克隆", "Clone"],
		["newSession", "新建会话", "New session"],
		["newSessionDescription", "创建完全空白的会话。当前会话不会删除，仍可从“恢复其他会话”返回。", "Create a completely blank session. The current session is preserved and can be resumed later."],
		["create", "新建", "Create"],
		["historyBranches", "历史与分支", "History & branches"],
		["resumeOtherSession", "恢复其他会话", "Resume another session"],
		["resumeDescription", "切换到另一个已保存的会话文件；列表排除当前会话，不创建副本。", "Switch to another saved session file. The current session is excluded and no copy is created."],
		["loading", "正在载入…", "Loading…"],
		["resume", "恢复", "Resume"],
		["forkFromMessage", "从消息分叉", "Fork from message"],
		["forkDescription", "复制所选消息之前的历史并创建新会话，再把该消息放回输入框供修改；原会话保持不变。", "Create a new session from history before the selected message, then return that message to the composer for editing."],
		["fork", "分叉", "Fork"],
		["sessionTree", "会话树", "Session tree"],
		["sessionTreeDescription", "在同一会话文件内移动到其他历史节点，不创建新会话；列表排除当前节点。", "Move to another history node in the same session file without creating a new session."],
		["switch", "切换", "Switch"],
		["transferShare", "传输与分享", "Transfer & sharing"],
		["exportSession", "导出会话", "Export session"],
		["exportDescription", "HTML 适合阅读、不能恢复；JSONL 保留完整会话结构，可通过“导入会话”恢复。", "HTML is readable but cannot be resumed. JSONL preserves the full session structure and can be imported."],
		["importSession", "导入会话", "Import session"],
		["importDescription", "复制 JSONL 为新的本地会话并立即切换。当前会话不会被删除，HTML 文件不能导入。", "Copy JSONL into a new local session and switch immediately. The current session is preserved; HTML cannot be imported."],
		["shareSession", "分享会话", "Share session"],
		["shareDescriptionStart", "把会话 HTML 上传为私密 GitHub Gist。需要已安装并登录", "Upload the session HTML as a secret GitHub Gist. Requires an installed and authenticated"],
		["shareDescriptionEnd", "；“私密”仅表示不公开列出，持有链接者仍可访问。", ". “Secret” means unlisted; anyone with the link can access it."],
		["chooseFile", "选择文件…", "Choose file…"],
		["createLink", "创建链接", "Create link"],
		["securityPageDescription", "管理项目代码资源是否允许载入，以及 Agent 调用模型时使用的 Provider 凭据；二者互不替代。", "Manage whether project code resources may load and the Provider credentials Agent uses for models. These controls are independent."],
		["securityFeedbackDisconnected", "连接 Server 后载入账户状态。", "Connect to Server to load account status."],
		["projectPermissions", "项目权限", "Project permissions"],
		["projectTrust", "当前项目可信状态", "Current project trust"],
		["projectTrustDescription", "只控制项目级扩展、Skills、Prompts、主题等代码资源是否载入；不控制 Server 网络连接。保存后需重启 Agent 才完全生效。", "Controls loading project extensions, Skills, Prompts, themes, and other code resources; it does not control Server networking. Restart Agent after saving."],
		["followDefault", "跟随默认设置", "Use default"],
		["trusted", "可信", "Trusted"],
		["untrusted", "不可信", "Untrusted"],
		["providerLogin", "Provider 登录", "Provider login"],
		["oauthDescription", "使用 Provider 订阅账户授权。无需填写 API Key；登录流程会打开浏览器或显示设备验证码。", "Authorize with a Provider subscription. No API Key is needed; the flow opens a browser or shows a device code."],
		["oauthLogin", "OAuth 登录", "OAuth login"],
		["apiKeyDescription", "为内置或已注册 Provider 保存独立 API Key，不修改 Provider Base URL。", "Save a separate API Key for a built-in or registered Provider without changing its Base URL."],
		["saveApiKey", "保存 API Key", "Save API Key"],
		["customBaseUrl", "自定义 Base URL", "Custom Base URL"],
		["customBaseUrlDescription", "添加一个 OpenAI-compatible Provider。名称、Base URL 与 API Key 作为一组独立配置保存。若代理模型支持推理但未自动识别，可手动开启思考。", "Add an OpenAI-compatible Provider. Its name, Base URL, and API Key are saved as one separate configuration. If a proxied model supports reasoning but is not detected, enable thinking manually."],
		["providerName", "Provider 名称", "Provider name"],
		["enableCustomProviderReasoning", "支持思考（为该 Provider 下模型启用思考等级）", "Enable thinking (turn on thinking levels for this Provider's models)"],
		["saveCustomProvider", "保存自定义 Provider", "Save custom Provider"],
		["removeCredentials", "移除已保存凭据", "Remove saved credentials"],
		["removeCredentialsDescription", "只删除 Metis 本地凭据；环境变量、云端登录状态和 models.json 不会改变，因此 Provider 仍可能继续可用。", "Remove only local Metis credentials. Environment variables, cloud login, and models.json remain unchanged."],
		["noSavedCredentials", "没有已保存凭据", "No saved credentials"],
		["login", "登录", "Log in"],
		["logout", "退出", "Log out"],
		["connectionPageDescription", "管理 Desktop 与 Metis Server 的连接；Agent 设置通过此连接同步。", "Manage the connection between Desktop and Metis Server. Agent settings sync through this connection."],
		["usuallyNoChange", "通常不需要修改", "Usually no changes needed"],
		["localServerDescriptionStart", "Desktop 默认启动并连接本地", "Desktop starts and connects to the local"],
		["localServerDescriptionEnd", "。仅在连接远程 Server 或使用自定义端口时更改。", ". Change this only for a remote Server or custom port."],
		["connectionStatus", "连接状态", "Connection status"],
		["disconnected", "未连接", "Disconnected"],
		["serverConfiguration", "Server 配置", "Server configuration"],
		["serverConfigurationDescription", "设置地址与认证信息，并测试连接", "Set the address and authentication, then test the connection"],
		["configure", "配置…", "Configure…"],
		["currentWorkspace", "当前工作区", "Current workspace"],
		["reading", "正在读取…", "Reading…"],
		["change", "更改", "Change"],
		["aboutDescription", "Metis Desktop 应用信息。", "Metis Desktop application information."],
		["application", "应用", "Application"],
		["nativeWorkspace", "面向 Metis Agent 的原生桌面工作区", "A native desktop workspace for Metis Agent"],
		["runtimePlatform", "运行平台", "Runtime platform"],
		["electronEnvironment", "当前 Electron 运行环境", "Current Electron runtime environment"],
		["helpMaintenance", "帮助与维护", "Help & maintenance"],
		["changelog", "更新记录", "Changelog"],
		["changelogDescription", "只读查看当前安装版本携带的 Changelog，不会联网检查或安装更新。", "View the changelog bundled with this version. This does not check for or install updates."],
		["desktopHotkeys", "Desktop 快捷键", "Desktop shortcuts"],
		["desktopHotkeysDescription", "查看此 Desktop 界面的快捷键；终端 TUI 的自定义快捷键请在 TUI 中查看。", "View shortcuts for Desktop. Check the terminal TUI for its custom shortcuts."],
		["reloadAgentResources", "重载 Agent 资源", "Reload Agent resources"],
		["reloadAgentResourcesDescription", "重新载入扩展、Skills、Prompts、主题和模型注册表；不会重启 Desktop，也不会重载 Desktop 快捷键。", "Reload extensions, Skills, Prompts, themes, and the model registry without restarting Desktop."],
		["quitDescription", "关闭 Desktop 和自动启动的本地 Server", "Close Desktop and its auto-started local Server"],
		["view", "查看", "View"],
		["reload", "重载", "Reload"],
		["quitMetis", "退出 Metis", "Quit Metis"],
		["windowNavigation", "窗口导航", "Window navigation"],
		["serverAddress", "Server 地址", "Server address"],
		["connectMetisServer", "连接 Metis Server", "Connect to Metis Server"],
		["serverDialogDescription", "Desktop 通过本地 HTTP + SSE 与 Agent 通信", "Desktop communicates with Agent over local HTTP + SSE"],
		["username", "用户名", "Username"],
		["password", "密码", "Password"],
		["optional", "可选", "Optional"],
		["localAuthHint", "本地回环地址可不设密码；连接远程地址时 Server 会强制认证。", "A loopback address may omit a password. Remote Server connections require authentication."],
		["apiKeyOptional", "API Key（OAuth 可留空）", "API Key (optional for OAuth)"],
		["cancel", "取消", "Cancel"],
		["fileContent", "文件内容", "File content"],
		["close", "关闭", "Close"],
	];

	const phraseKeys = new Map();
	for (const [key, chinese, english] of phrases) {
		phraseKeys.set(chinese, key);
		copy.en[key] = english;
		copy["zh-CN"][key] = chinese;
	}

	const commonOverrides = {
		"zh-TW": { newTask: "新增任務", projects: "專案", addProject: "新增專案", settings: "設定", interaction: "互動", session: "工作階段", accountSecurity: "帳戶與安全", connection: "連線", about: "關於", searchSettings: "搜尋設定…", currentModel: "目前模型", thinkingLevel: "思考等級", context: "上下文", general: "一般", interfaceLanguage: "介面語言", review: "檢閱", browser: "瀏覽器", files: "檔案", send: "傳送" },
		ja: { newTask: "新しいタスク", projects: "プロジェクト", addProject: "プロジェクトを追加", settings: "設定", interaction: "操作", session: "セッション", accountSecurity: "アカウントとセキュリティ", connection: "接続", about: "情報", searchSettings: "設定を検索…", currentModel: "現在のモデル", thinkingLevel: "思考レベル", context: "コンテキスト", general: "一般", interfaceLanguage: "表示言語", review: "レビュー", browser: "ブラウザ", files: "ファイル", send: "送信" },
		ko: { newTask: "새 작업", projects: "프로젝트", addProject: "프로젝트 추가", settings: "설정", interaction: "상호작용", session: "세션", accountSecurity: "계정 및 보안", connection: "연결", about: "정보", searchSettings: "설정 검색…", currentModel: "현재 모델", thinkingLevel: "사고 수준", context: "컨텍스트", general: "일반", interfaceLanguage: "인터페이스 언어", review: "검토", browser: "브라우저", files: "파일", send: "보내기" },
		es: { newTask: "Nueva tarea", projects: "Proyectos", addProject: "Añadir proyecto", settings: "Configuración", interaction: "Interacción", session: "Sesión", accountSecurity: "Cuenta y seguridad", connection: "Conexión", about: "Acerca de", searchSettings: "Buscar configuración…", currentModel: "Modelo actual", thinkingLevel: "Nivel de razonamiento", context: "Contexto", general: "General", interfaceLanguage: "Idioma de la interfaz", review: "Revisar", browser: "Navegador", files: "Archivos", send: "Enviar" },
		fr: { newTask: "Nouvelle tâche", projects: "Projets", addProject: "Ajouter un projet", settings: "Paramètres", interaction: "Interaction", session: "Session", accountSecurity: "Compte et sécurité", connection: "Connexion", about: "À propos", searchSettings: "Rechercher dans les paramètres…", currentModel: "Modèle actuel", thinkingLevel: "Niveau de raisonnement", context: "Contexte", general: "Général", interfaceLanguage: "Langue de l’interface", review: "Révision", browser: "Navigateur", files: "Fichiers", send: "Envoyer" },
		de: { newTask: "Neue Aufgabe", projects: "Projekte", addProject: "Projekt hinzufügen", settings: "Einstellungen", interaction: "Interaktion", session: "Sitzung", accountSecurity: "Konto und Sicherheit", connection: "Verbindung", about: "Info", searchSettings: "Einstellungen durchsuchen…", currentModel: "Aktuelles Modell", thinkingLevel: "Denkstufe", context: "Kontext", general: "Allgemein", interfaceLanguage: "Oberflächensprache", review: "Überprüfen", browser: "Browser", files: "Dateien", send: "Senden" },
		pt: { newTask: "Nova tarefa", projects: "Projetos", addProject: "Adicionar projeto", settings: "Configurações", interaction: "Interação", session: "Sessão", accountSecurity: "Conta e segurança", connection: "Conexão", about: "Sobre", searchSettings: "Pesquisar configurações…", currentModel: "Modelo atual", thinkingLevel: "Nível de raciocínio", context: "Contexto", general: "Geral", interfaceLanguage: "Idioma da interface", review: "Revisar", browser: "Navegador", files: "Arquivos", send: "Enviar" },
		ru: { newTask: "Новая задача", projects: "Проекты", addProject: "Добавить проект", settings: "Настройки", interaction: "Взаимодействие", session: "Сессия", accountSecurity: "Аккаунт и безопасность", connection: "Подключение", about: "О программе", searchSettings: "Поиск настроек…", currentModel: "Текущая модель", thinkingLevel: "Уровень рассуждения", context: "Контекст", general: "Общие", interfaceLanguage: "Язык интерфейса", review: "Проверка", browser: "Браузер", files: "Файлы", send: "Отправить" },
		it: { newTask: "Nuova attività", projects: "Progetti", addProject: "Aggiungi progetto", settings: "Impostazioni", interaction: "Interazione", session: "Sessione", accountSecurity: "Account e sicurezza", connection: "Connessione", about: "Informazioni", searchSettings: "Cerca impostazioni…", currentModel: "Modello attuale", thinkingLevel: "Livello di ragionamento", context: "Contesto", general: "Generale", interfaceLanguage: "Lingua dell’interfaccia", review: "Revisione", browser: "Browser", files: "File", send: "Invia" },
	};
	for (const [language, values] of Object.entries(commonOverrides)) Object.assign(copy[language], values);

	const originalText = new WeakMap();
	const originalAttributes = new WeakMap();

	function resolve(language = "auto") {
		if (language !== "auto" && copy[language]) return language;
		for (const locale of navigator.languages || [navigator.language]) {
			if (copy[locale]) return locale;
			const normalized = locale.toLowerCase();
			const base = normalized.split("-")[0];
			if (base === "zh") return normalized.includes("tw") || normalized.includes("hk") ? "zh-TW" : "zh-CN";
			const match = Object.keys(copy).find((code) => code.toLowerCase() === base);
			if (match) return match;
		}
		return "en";
	}

	function t(key, language = "auto", variables = {}) {
		const resolved = resolve(language);
		const value = copy[resolved]?.[key] || copy.en[key] || key;
		return value.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? `{${name}}`));
	}

	function translateDocument(language) {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			let source = originalText.get(node);
			if (!source) {
				const raw = node.nodeValue || "";
				const trimmed = raw.trim();
				if (!phraseKeys.has(trimmed)) continue;
				source = { key: phraseKeys.get(trimmed), prefix: raw.slice(0, raw.indexOf(trimmed)), suffix: raw.slice(raw.indexOf(trimmed) + trimmed.length) };
				originalText.set(node, source);
			}
			node.nodeValue = `${source.prefix}${t(source.key, language)}${source.suffix}`;
		}

		for (const element of document.querySelectorAll("[aria-label], [title], [placeholder]")) {
			let sources = originalAttributes.get(element);
			if (!sources) {
				sources = {};
				originalAttributes.set(element, sources);
			}
			for (const attribute of ["aria-label", "title", "placeholder"]) {
				if (!(attribute in sources)) {
					const value = element.getAttribute(attribute);
					if (value && phraseKeys.has(value)) sources[attribute] = phraseKeys.get(value);
				}
				if (sources[attribute]) element.setAttribute(attribute, t(sources[attribute], language));
			}
		}
	}

	window.metisDesktopI18n = { languages, resolve, t, translateDocument };
})();
