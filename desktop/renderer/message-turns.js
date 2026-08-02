(function exposeMessageTurnHelpers(globalScope) {
	function messageHasCoT(message, messages = []) {
		return Array.isArray(message?.content)
			&& message.content.some((part) => (part.type === "thinking" && Boolean(String(part.thinking || "").trim()))
				|| part.type === "toolCall");
	}

	function isSubagentLaunchNotice(text) {
		const normalized = String(text || "").trim();
		if (!normalized || normalized.length > 240 || !/subagent/i.test(normalized)) return false;
		return /(已启动|启动了|started|launched)/i.test(normalized) && /(等待|等它|waiting|wait for)/i.test(normalized);
	}

	function shouldHideAssistantWorkHeader(message, messages) {
		const messageIndex = messages.indexOf(message);
		if (messageIndex <= 0) return false;
		for (let index = messageIndex - 1; index >= 0; index -= 1) {
			const previous = messages[index];
			if (previous?.role === "user") break;
			if (previous?.role === "assistant" && messageHasCoT(previous, messages)) return true;
		}
		return false;
	}

	function messageHasText(message) {
		if (typeof message?.content === "string") return Boolean(message.content.trim()) && !isSubagentLaunchNotice(message.content);
		return Array.isArray(message?.content)
			&& message.content.some((part) => part.type === "text" && Boolean(part.text) && !isSubagentLaunchNotice(part.text));
	}

	function toTimestamp(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return undefined;
	}

	function getAssistantTurnDuration(message, messages, messageTimings = {}, options = {}) {
		const messageIndex = messages.indexOf(message);
		if (messageIndex < 0) return undefined;

		let turnStart = messageIndex;
		while (turnStart > 0 && messages[turnStart]?.role !== "user") turnStart -= 1;
		if (messages[turnStart]?.role !== "user") turnStart = messageIndex;

		let turnEnd = messageIndex + 1;
		while (turnEnd < messages.length && messages[turnEnd]?.role !== "user") turnEnd += 1;
		const turnMessages = messages.slice(turnStart, turnEnd);
		const firstMessage = turnMessages.find((candidate) => candidate?.role === "user") ?? message;
		const lastAssistant = [...turnMessages].reverse().find((candidate) => candidate?.role === "assistant");
		const startedAt = toTimestamp(firstMessage?.timestamp) ?? toTimestamp(message?.timestamp);
		if (startedAt === undefined || !lastAssistant) return undefined;

		const isLatestTurn = turnEnd === messages.length;
		const active = Boolean(options.active && isLatestTurn);
		const timing = messageTimings[String(lastAssistant.timestamp)] ?? messageTimings[lastAssistant.timestamp];
		const completedAt = toTimestamp(timing?.completedAt ?? timing);
		const endedAt = active ? Number(options.now ?? Date.now()) : completedAt ?? toTimestamp(lastAssistant.timestamp);
		if (!Number.isFinite(endedAt) || endedAt < startedAt) return undefined;
		return Math.max(0.1, Number(((endedAt - startedAt) / 1000).toFixed(1)));
	}

	function analyzeAssistantTurn(message, messages, isStreaming) {
		const messageIndex = messages.indexOf(message);
		if (messageIndex === -1) {
			return {
				hasCoT: false,
				hasFinalResponse: false,
				hasRunningSubagent: false,
				isCurrentTurn: false,
				isFinalAssistant: true,
				isIntermediate: false,
				shouldCollapse: false,
			};
		}

		let turnStart = messageIndex;
		while (turnStart > 0 && messages[turnStart - 1].role !== "user") turnStart -= 1;

		let turnEnd = messageIndex + 1;
		while (turnEnd < messages.length && messages[turnEnd].role !== "user") turnEnd += 1;

		const assistantMessages = messages
			.slice(turnStart, turnEnd)
			.filter((candidate) => candidate.role === "assistant");
		const trailingAssistant = assistantMessages.at(-1);
		const lastAssistant = isStreaming
			? trailingAssistant
			: [...assistantMessages].reverse().find((assistantMessage) => messageHasText(assistantMessage)
				|| messageHasCoT(assistantMessage, messages)
				|| Boolean(assistantMessage?.errorMessage)) ?? trailingAssistant;
		const hasCoT = assistantMessages.some((assistantMessage) => messageHasCoT(assistantMessage, messages));
		const hasFinalResponse = messageHasText(lastAssistant);
		const hasRunningSubagent = assistantMessages.some((assistantMessage) => Array.isArray(assistantMessage.content)
			&& assistantMessage.content.some((part) => part.type === "toolCall"
				&& String(part.name || "").toLowerCase() === "subagent"
				&& getSubagentProgress(part, messages).state === "running"));
		const lastUserIndex = messages.findLastIndex((candidate) => candidate.role === "user");
		const isCurrentTurn = messageIndex > lastUserIndex;
		const isFinalAssistant = message === lastAssistant;

		return {
			hasCoT,
			hasFinalResponse,
			hasRunningSubagent,
			isCurrentTurn,
			isFinalAssistant,
			isIntermediate: !isFinalAssistant,
			shouldCollapse: hasCoT && hasFinalResponse && !isStreaming && !hasRunningSubagent,
		};
	}

	function messageText(message) {
		if (typeof message?.content === "string") return message.content;
		if (!Array.isArray(message?.content)) return "";
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text || "")
			.join("\n");
	}

	function getSubagentProgress(part, messages) {
		const jobId = String(part?.id || "").slice(-6);
		const toolResult = messages.find((message) => message.role === "toolResult" && message.toolCallId === part?.id);
		if (toolResult?.isError) {
			return { jobId, state: "failed" };
		}

		const completionMarker = `[Subagent Job ${jobId} finished]`;
		const completed = messages.some((message) => {
			if (message.customType === "subagent_result" && messageText(message).includes(completionMarker)) return true;
			return messageText(message).includes(completionMarker);
		});

		return { jobId, state: completed ? "completed" : "running" };
	}

	function getRunningSubagentCount(messages) {
		return getRunningSubagentIds(messages).length;
	}

	function getSubagentToolCalls(messages) {
		const calls = [];
		const seen = new Set();
		for (const message of messages) {
			if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
			for (const part of message.content) {
				if (part?.type !== "toolCall" || String(part.name || "").toLowerCase() !== "subagent") continue;
				const jobId = String(part.id || "").slice(-6);
				if (!jobId || seen.has(jobId)) continue;
				seen.add(jobId);
				calls.push({ jobId, part });
			}
		}
		return calls;
	}

	function getRunningSubagentIds(messages, reportedJobIds = []) {
		const progressByJobId = new Map(getSubagentToolCalls(messages).map(({ jobId, part }) => [
			jobId,
			getSubagentProgress(part, messages).state,
		]));
		const runningJobIds = new Set();

		for (const rawJobId of Array.isArray(reportedJobIds) ? reportedJobIds : []) {
			const jobId = String(rawJobId || "").trim();
			if (!jobId) continue;
			const progress = progressByJobId.get(jobId);
			if (!progress || progress === "running") runningJobIds.add(jobId);
		}

		for (const [jobId, progress] of progressByJobId) {
			if (progress === "running") runningJobIds.add(jobId);
		}

		return [...runningJobIds];
	}

	function shouldQueueDesktopMessage(messages, isStreaming) {
		return Boolean(isStreaming) || getRunningSubagentCount(messages) > 0;
	}

	function getAssistantContentLayout(message, isFinalAssistant) {
		const content = Array.isArray(message?.content) ? message.content : [];
		let finalResponseIndex = -1;
		if (isFinalAssistant) {
			const lastToolCallIndex = content.findLastIndex((part) => part?.type === "toolCall");
			for (let index = content.length - 1; index > lastToolCallIndex; index -= 1) {
				const part = content[index];
				if (part?.type === "text" && Boolean(String(part.text || "").trim()) && !isSubagentLaunchNotice(part.text)) {
					finalResponseIndex = index;
					break;
				}
			}
		}

		const cotParts = content.filter((part, index) => {
			if (index === finalResponseIndex) return false;
			if (part?.type === "toolCall") return String(part.name || "").toLowerCase() !== "subagent";
			if (part?.type === "thinking") return Boolean(String(part.thinking || "").trim());
			if (part?.type === "text") return Boolean(String(part.text || "").trim()) && !isSubagentLaunchNotice(part.text);
			return false;
		});

		return {
			cotParts,
			finalResponsePart: finalResponseIndex === -1 ? undefined : content[finalResponseIndex],
		};
	}

	function getAssistantWorkLayout(message, messages, isFinalAssistant) {
		const { cotParts, finalResponsePart } = getAssistantContentLayout(message, isFinalAssistant);
		const cotPartSet = new Set(cotParts);
		const workItems = [];
		for (const part of Array.isArray(message?.content) ? message.content : []) {
			if (cotPartSet.has(part)) {
				workItems.push(part);
				continue;
			}
			if (part?.type !== "toolCall" || String(part.name || "").toLowerCase() !== "subagent") continue;
			const progress = getSubagentProgress(part, messages);
			workItems.push({ type: "subagentCard", part, progress });
		}
		return { workItems, finalResponsePart };
	}

	function reconcileAssistantFinalDivider(body, shouldRender, beforeNode) {
		if (!body) return undefined;

		// Older renders placed a second divider inside the work container. Remove
		// that ownership path so every turn can have only one final-response line.
		for (const divider of body.querySelectorAll(".cot-divider")) divider.remove();
		for (const container of body.querySelectorAll(".cot-container.has-final-response")) {
			container.classList.remove("has-final-response");
		}

		const dividers = [...body.querySelectorAll(":scope > .turn-final-divider")];
		let divider = dividers.shift();
		for (const duplicate of dividers) duplicate.remove();

		if (!shouldRender || !beforeNode) {
			if (divider) divider.remove();
			return undefined;
		}

		if (!divider) {
			divider = body.ownerDocument.createElement("div");
			divider.className = "turn-final-divider";
		}
		if (divider.nextSibling !== beforeNode) body.insertBefore(divider, beforeNode);
		return divider;
	}

	const helpers = {
		analyzeAssistantTurn,
		getSubagentProgress,
		getRunningSubagentCount,
		getRunningSubagentIds,
		getSubagentToolCalls,
		shouldHideAssistantWorkHeader,
		getAssistantTurnDuration,
		shouldQueueDesktopMessage,
		getAssistantContentLayout,
		getAssistantWorkLayout,
		reconcileAssistantFinalDivider,
		isSubagentLaunchNotice,
	};
	if (typeof module === "object" && module.exports) module.exports = helpers;
	globalScope.metisMessageTurns = helpers;
})(typeof window === "undefined" ? globalThis : window);
