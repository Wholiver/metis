(function attachDesktopConversations(global) {
	const DREAM_TASK_PATTERN = /^\[BACKGROUND DREAM PHASE(?: TASK)?\]/;
	const SUBAGENT_TASK_PATTERN = /(?:^|\n)\[SUBAGENT TASK\](?:\r?\n|$)/;
	const SUBAGENT_FILE_PATTERN = /^<file name="[^"]*[\\/]\.metis-subagent-[^"]+\.txt">/;
	const PROJECT_STATE_VERSION = 1;

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
			conversationsExpanded: false,
			conversations: [],
			lastSessionPath: undefined,
		};
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
			project.collapsed = Boolean(candidate.collapsed);
			project.lastSessionPath = typeof candidate.lastSessionPath === "string" && candidate.lastSessionPath
				? candidate.lastSessionPath
				: undefined;
			projects.push(project);
		}

		if (value === undefined && fallbackWorkspace?.isProjectRepo) {
			const fallback = createProject(fallbackWorkspace);
			if (fallback && !seenPaths.has(fallback.path)) projects.push(fallback);
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
				path: normalizeProjectPath(project.path),
				collapsed: Boolean(project.collapsed),
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
			conversations.push({
				id,
				title: firstTitleLine(session.name) || firstTitleLine(session.firstMessage) || untitledTitle,
				branch: Boolean(session.parentSessionPath),
				sessionPath: sessionPath || undefined,
			});
		}
		return conversations;
	}

	function visibleProjectConversations(conversations, expanded = false, limit = 5) {
		const items = Array.isArray(conversations) ? conversations : [];
		if (expanded) return items;
		return items.slice(0, Math.max(0, limit));
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
		visibleProjectConversations,
		visibleSessions,
	});
	if (typeof module === "object" && module.exports) module.exports = helpers;
	global.metisDesktopConversations = helpers;
})(typeof window === "undefined" ? globalThis : window);
