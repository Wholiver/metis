(function attachDesktopConversations(global) {
	const DREAM_TASK_PATTERN = /^\[BACKGROUND DREAM (?:PHASE(?: TASK)?|TASK)\]/;
	const SUBAGENT_TASK_PATTERN = /(?:^|\n)\[SUBAGENT TASK\](?:\r?\n|$)/;
	const SUBAGENT_FILE_PATTERN = /^<file name="[^"]*[\\/]\.metis-subagent-[^"]+\.txt">/;
	const PROJECT_STATE_VERSION = 2;

	function normalizeProjectPath(value) {
		const path = typeof value === "string" ? value.trim() : "";
		if (!path) return "";
		return path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
	}

	function projectNameFromPath(projectPath) {
		const parts = normalizeProjectPath(projectPath).split(/[\\/]/).filter(Boolean);
		return parts.at(-1) || projectPath;
	}

	function projectIdFromPath(projectPath) {
		return `workspace:${encodeURIComponent(normalizeProjectPath(projectPath))}`;
	}

	function isInvalidProjectPath(path) {
		const norm = normalizeProjectPath(path);
		if (!norm) return true;
		if (norm === "/" || norm === "\\" || norm === "." || norm === ".." || /^[A-Za-z]:[\\/]?$/.test(norm)) return true;
		const parts = norm.split(/[\\/]/).filter(Boolean);
		const basename = parts.at(-1)?.toLowerCase() || "";
		if (parts.length <= 3 && ["documents", "document", "desktop", "downloads"].includes(basename)) {
			return true;
		}
		return false;
	}

	function createProject(workspace) {
		const projectPath = normalizeProjectPath(workspace?.path);
		if (isInvalidProjectPath(projectPath)) return undefined;
		return {
			id: projectIdFromPath(projectPath),
			name: String(workspace?.name || projectNameFromPath(projectPath)),
			path: projectPath,
			collapsed: false,
			conversations: [],
			lastSessionPath: undefined,
		};
	}

	function normalizeProjectDisplayName(value) {
		return typeof value === "string" ? value.trim().slice(0, 80) : "";
	}

	function normalizeProjectAccentColor(value) {
		const color = typeof value === "string" ? value.trim().toLowerCase() : "";
		return /^#[0-9a-f]{6}$/.test(color) ? color : "";
	}

	function timestampValue(value) {
		const timestamp = new Date(value).getTime();
		return Number.isFinite(timestamp) ? timestamp : undefined;
	}

	function sortConversationsByCreatedAt(value) {
		return (Array.isArray(value) ? value : [])
			.map((conversation, index) => ({ conversation, index, createdAt: timestampValue(conversation?.createdAt) }))
			.sort((left, right) => {
				if (left.createdAt !== undefined && right.createdAt !== undefined) return right.createdAt - left.createdAt;
				if (left.createdAt !== undefined) return -1;
				if (right.createdAt !== undefined) return 1;
				return left.index - right.index;
			})
			.map(({ conversation }) => conversation);
	}

	function restoreConversationSummaries(value) {
		const conversations = [];
		const seen = new Set();
		for (const candidate of Array.isArray(value) ? value : []) {
			const id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
			const title = typeof candidate?.title === "string" ? candidate.title.trim() : "";
			const sessionPath = typeof candidate?.sessionPath === "string" ? candidate.sessionPath.trim() : "";
			const identity = id || sessionPath;
			if (!identity || !title || seen.has(identity)) continue;
			seen.add(identity);
			const item = {
				id: identity,
				title,
				branch: Boolean(candidate.branch),
				sessionPath: sessionPath || undefined,
			};
			if (candidate.updatedAt || candidate.modified) {
				item.updatedAt = candidate.updatedAt || candidate.modified;
			}
			if (candidate.createdAt || candidate.created) {
				item.createdAt = candidate.createdAt || candidate.created;
			}
			const tokenTotal = Number(candidate.tokenTotal);
			if (Number.isFinite(tokenTotal) && tokenTotal > 0) item.tokenTotal = tokenTotal;
			conversations.push(item);
		}
		return sortConversationsByCreatedAt(conversations);
	}

	function restoreProjectState(serialized, fallbackWorkspace) {
		let value;
		try {
			value = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
		} catch {
			value = undefined;
		}

		const projects = [];
		const seenPaths = new Set();
		for (const candidate of Array.isArray(value?.projects) ? value.projects : []) {
			const project = createProject(candidate);
			if (!project || seenPaths.has(project.path)) continue;
			seenPaths.add(project.path);
			project.id = typeof candidate.id === "string" && candidate.id ? candidate.id : project.id;
			const displayName = normalizeProjectDisplayName(candidate.displayName);
			const accentColor = normalizeProjectAccentColor(candidate.accentColor);
			if (displayName) project.displayName = displayName;
			if (accentColor) project.accentColor = accentColor;
			project.collapsed = Boolean(candidate.collapsed);
			project.conversations = restoreConversationSummaries(candidate.conversations);
			project.lastSessionPath = typeof candidate.lastSessionPath === "string" && candidate.lastSessionPath
				? candidate.lastSessionPath
				: undefined;
			projects.push(project);
		}
		const fallbackProject = createProject(fallbackWorkspace);
		if (fallbackProject && !seenPaths.has(fallbackProject.path)) {
			projects.push(fallbackProject);
		}

		const requestedActiveId = typeof value?.activeProjectId === "string" ? value.activeProjectId : undefined;
		const activeProjectId = projects.some((project) => project.id === requestedActiveId)
			? requestedActiveId
			: projects[0]?.id;
		return { version: PROJECT_STATE_VERSION, projects, activeProjectId };
	}

	function serializeProjectState(projects, activeProjectId) {
		return JSON.stringify({
			version: PROJECT_STATE_VERSION,
			activeProjectId,
			projects: (Array.isArray(projects) ? projects : []).map((project) => ({
				id: project.id,
				name: project.name,
				displayName: normalizeProjectDisplayName(project.displayName) || undefined,
				accentColor: normalizeProjectAccentColor(project.accentColor) || undefined,
				path: normalizeProjectPath(project.path),
				collapsed: Boolean(project.collapsed),
				conversations: restoreConversationSummaries(project.conversations),
				lastSessionPath: project.lastSessionPath,
			})),
		});
	}

	function firstTitleLine(value) {
		return String(value || "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) || "";
	}

	function isDreamSession(session) {
		return typeof session?.firstMessage === "string" && DREAM_TASK_PATTERN.test(session.firstMessage.trimStart());
	}

	function isSubagentSession(session) {
		if (typeof session?.firstMessage !== "string") return false;
		const firstMessage = session.firstMessage.trimStart();
		return SUBAGENT_TASK_PATTERN.test(firstMessage) || SUBAGENT_FILE_PATTERN.test(firstMessage);
	}

	function visibleSessions(sessions) {
		return (Array.isArray(sessions) ? sessions : []).filter((session) => !isDreamSession(session) && !isSubagentSession(session));
	}

	function fromSessions(sessions, untitledTitle) {
		const conversations = [];
		const seen = new Set();
		for (const session of visibleSessions(sessions)) {
			const sessionPath = typeof session?.path === "string" ? session.path.trim() : "";
			const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
			const id = sessionPath || sessionId;
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const item = {
				id,
				title: firstTitleLine(session.name) || firstTitleLine(session.firstMessage) || untitledTitle,
				branch: Boolean(session.parentSessionPath),
				sessionPath: sessionPath || undefined,
			};
			if (session.modified || session.updatedAt || session.created) {
				item.updatedAt = session.modified || session.updatedAt || session.created;
			}
			if (session.created) item.createdAt = session.created;
			const tokenTotal = Number(session.tokenTotal);
			if (Number.isFinite(tokenTotal) && tokenTotal > 0) item.tokenTotal = tokenTotal;
			conversations.push(item);
		}
		return sortConversationsByCreatedAt(conversations);
	}

	const helpers = Object.freeze({
		createProject,
		fromSessions,
		isDreamSession,
		isSubagentSession,
		normalizeProjectPath,
		projectIdFromPath,
		restoreProjectState,
		serializeProjectState,
		sortConversationsByCreatedAt,
		visibleSessions,
	});
	if (typeof module === "object" && module.exports) module.exports = helpers;
	global.metisDesktopConversations = helpers;
})(typeof window === "undefined" ? globalThis : window);
