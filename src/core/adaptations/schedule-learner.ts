/**
 * Desktop-Only Self-Learning Schedule & Routine Learner.
 *
 * Autonomously detects periodic user intentions or high-frequency automated tasks,
 * proposes scheduled routines via `ask_user`, and registers them into Metis Desktop's
 * Routine host upon user confirmation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { RoutineHostClient } from "../routine-host.ts";
import type { AskUserRequest, AskUserResponse, AskUserHandler } from "../ask-user.ts";
import type { AgentMessage } from "@earendil-works/metis-agent-core";

export type AskUserInvoker =
	| AskUserHandler
	| ((request: AskUserRequest, signal?: AbortSignal) => Promise<AskUserResponse>)
	| ((mockInput: any) => Promise<any>);

export function extractLastUserPrompt(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m && m.role === "user") {
			const content = (m as { content?: unknown }).content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				return content
					.filter((part): part is { type: "text"; text: string } =>
						Boolean(part) && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string")
					.map((part) => part.text)
					.join(" ");
			}
		}
	}
	return "";
}

export interface ScheduleOpportunity {
	title: string;
	cron: string;
	cronDescription: string;
	prompt: string;
	projectPath: string;
	reason: string;
	fingerprint: string;
}

export interface DetectScheduleOptions {
	userPrompt: string;
	assistantResponse?: string;
	cwd: string;
	agentDir: string;
	routineHost?: RoutineHostClient;
}

/**
 * Natural language expressions to 5-field Cron parser.
 * Supports Chinese and English common temporal phrases.
 */
export function parsePeriodicIntentToCron(text: string): {
	cron: string;
	cronDescription: string;
	cleanPrompt: string;
	title: string;
} | null {
	const normalized = text.toLowerCase().trim();

	// Check if the prompt has periodic intent keywords
	const periodicKeywords = [
		"每天", "每日", "天天", "工作日", "周末", "每周", "每星期", "每小时", "每隔", "每30分钟", "定时", "定期", "routine",
		"daily", "every day", "weekday", "weekdays", "every week", "weekly", "hourly", "every hour", "schedule", "recurring",
	];

	const hasPeriodicKeyword = periodicKeywords.some((kw) => normalized.includes(kw));
	if (!hasPeriodicKeyword) {
		return null;
	}

	let cron = "0 9 * * 1-5"; // default: weekdays 9am
	let cronDescription = "工作日 09:00";

	// 1. Time of day parsing (e.g. 9点, 09:00, 18:00, 下午5点, 早上8点, etc.)
	let targetHour = 9;
	let targetMinute = 0;
	let explicitTimeFound = false;

	const timeMatch24 = normalized.match(/(\d{1,2}):(\d{2})/);
	if (timeMatch24) {
		const h = Number.parseInt(timeMatch24[1], 10);
		const m = Number.parseInt(timeMatch24[2], 10);
		if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
			targetHour = h;
			targetMinute = m;
			explicitTimeFound = true;
		}
	} else {
		const zhHourMatch = normalized.match(/(早上|上午|下午|晚上|夜间)?\s*(\d{1,2})\s*(点|时|:)/);
		if (zhHourMatch) {
			let h = Number.parseInt(zhHourMatch[2], 10);
			const period = zhHourMatch[1] || "";
			if ((period === "下午" || period === "晚上") && h < 12) {
				h += 12;
			} else if (period === "早上" || period === "上午") {
				if (h === 12) h = 0;
			}
			if (h >= 0 && h <= 23) {
				targetHour = h;
				targetMinute = 0;
				explicitTimeFound = true;
			}
		} else {
			const enHourMatch = normalized.match(/(\d{1,2})\s*(am|pm)/);
			if (enHourMatch) {
				let h = Number.parseInt(enHourMatch[1], 10);
				const ampm = enHourMatch[2];
				if (ampm === "pm" && h < 12) h += 12;
				if (ampm === "am" && h === 12) h = 0;
				if (h >= 0 && h <= 23) {
					targetHour = h;
					targetMinute = 0;
					explicitTimeFound = true;
				}
			}
		}
	}

	const hh = String(targetHour).padStart(2, "0");
	const mm = String(targetMinute).padStart(2, "0");

	// 2. Interval & Days matching
	if (normalized.includes("每30分钟") || normalized.includes("每三十分钟") || normalized.includes("every 30 min")) {
		cron = "*/30 * * * *";
		cronDescription = "每 30 分钟";
	} else if (normalized.includes("每小时") || normalized.includes("hourly") || normalized.includes("every hour")) {
		cron = "0 * * * *";
		cronDescription = "每小时整点";
	} else if (normalized.includes("工作日") || normalized.includes("weekday")) {
		cron = `${targetMinute} ${targetHour} * * 1-5`;
		cronDescription = `工作日 ${hh}:${mm}`;
	} else if (normalized.includes("周末") || normalized.includes("weekend")) {
		cron = `${targetMinute} ${targetHour} * * 0,6`;
		cronDescription = `周末 ${hh}:${mm}`;
	} else if (normalized.includes("周一") || normalized.includes("星期一") || normalized.includes("monday")) {
		cron = `${targetMinute} ${targetHour} * * 1`;
		cronDescription = `每周一 ${hh}:${mm}`;
	} else if (normalized.includes("周二") || normalized.includes("星期二") || normalized.includes("tuesday")) {
		cron = `${targetMinute} ${targetHour} * * 2`;
		cronDescription = `每周二 ${hh}:${mm}`;
	} else if (normalized.includes("周三") || normalized.includes("星期三") || normalized.includes("wednesday")) {
		cron = `${targetMinute} ${targetHour} * * 3`;
		cronDescription = `每周三 ${hh}:${mm}`;
	} else if (normalized.includes("周四") || normalized.includes("星期四") || normalized.includes("thursday")) {
		cron = `${targetMinute} ${targetHour} * * 4`;
		cronDescription = `每周四 ${hh}:${mm}`;
	} else if (normalized.includes("周五") || normalized.includes("星期五") || normalized.includes("friday")) {
		cron = `${targetMinute} ${targetHour} * * 5`;
		cronDescription = `每周五 ${hh}:${mm}`;
	} else if (normalized.includes("周六") || normalized.includes("星期六") || normalized.includes("saturday")) {
		cron = `${targetMinute} ${targetHour} * * 6`;
		cronDescription = `每周六 ${hh}:${mm}`;
	} else if (normalized.includes("周日") || normalized.includes("周天") || normalized.includes("星期日") || normalized.includes("星期天") || normalized.includes("sunday")) {
		cron = `${targetMinute} ${targetHour} * * 0`;
		cronDescription = `每周日 ${hh}:${mm}`;
	} else if (normalized.includes("每周") || normalized.includes("每星期") || normalized.includes("weekly")) {
		cron = `${targetMinute} ${targetHour} * * 1`;
		cronDescription = `每周一 ${hh}:${mm}`;
	} else if (normalized.includes("每天") || normalized.includes("每日") || normalized.includes("天天") || normalized.includes("daily") || normalized.includes("every day")) {
		cron = `${targetMinute} ${targetHour} * * *`;
		cronDescription = `每天 ${hh}:${mm}`;
	} else if (normalized.includes("定时") || normalized.includes("定期") || normalized.includes("schedule")) {
		// Generic periodic requirement without explicit day -> default to weekdays
		cron = explicitTimeFound ? `${targetMinute} ${targetHour} * * 1-5` : "0 9 * * 1-5";
		cronDescription = explicitTimeFound ? `工作日 ${hh}:${mm}` : "工作日 09:00";
	}

	// 3. Extract clean prompt for scheduled execution
	const cleanPrompt = extractScheduledPrompt(text);
	if (!cleanPrompt || cleanPrompt.length < 3) {
		return null;
	}

	// 4. Generate suitable title
	const title = generateRoutineTitle(cleanPrompt, cronDescription);

	return {
		cron,
		cronDescription,
		cleanPrompt,
		title,
	};
}

/**
 * Remove periodic meta-instructions from user prompt to leave clean task instruction.
 */
export function extractScheduledPrompt(text: string): string {
	let cleaned = text.trim();

	// Strip common prefixes
	const prefixes = [
		/^(请|麻烦你|帮我)?(以后|接下来)?(每天|每日|天天|工作日|周末|每周|每星期|每小时|定期|定时)\s*(早上|上午|下午|晚上|夜间)?\s*(\d{1,2}(:\d{2}|点|时))?\s*(都|帮我|自动|去|跑一次|执行一次)?/i,
		/^(please\s+)?(schedule\s+|every\s+(day|weekday|week|hour)|daily\s+|weekly\s+)?(to\s+|run\s+|execute\s+)?/i,
		/^(创建|建一个|设置一个|添加一个)?(定时任务|例行任务|定时日程|schedule|routine)[:：\s]*/i,
	];

	for (const p of prefixes) {
		cleaned = cleaned.replace(p, "").trim();
	}

	// If cleaned text starts with comma or punctuation, strip it
	cleaned = cleaned.replace(/^[，,。：:\s]+/, "").trim();

	// Fallback to original text if stripping was too aggressive
	if (cleaned.length < 4) {
		cleaned = text.trim();
	}

	return cleaned;
}

/**
 * Generate a concise title for the routine.
 */
function generateRoutineTitle(cleanPrompt: string, cronDescription: string): string {
	const firstLine = cleanPrompt.split(/[\n,，。]/)[0]?.trim() || cleanPrompt;
	let title = firstLine.slice(0, 24).trim();
	if (cleanPrompt.includes("测试") || cleanPrompt.includes("test")) {
		title = "自动运行测试与回归校验";
	} else if (cleanPrompt.includes("代码审查") || cleanPrompt.includes("review") || cleanPrompt.includes("pr")) {
		title = "例行代码审查与状态检查";
	} else if (cleanPrompt.includes("构建") || cleanPrompt.includes("build")) {
		title = "例行项目构建与健康检查";
	} else if (cleanPrompt.includes("备份") || cleanPrompt.includes("backup")) {
		title = "定时数据与文件备份";
	} else if (cleanPrompt.includes("汇报") || cleanPrompt.includes("总结") || cleanPrompt.includes("report")) {
		title = "定时工作汇总与进展报告";
	} else if (cleanPrompt.includes("扫描") || cleanPrompt.includes("scan") || cleanPrompt.includes("安全")) {
		title = "定时安全与合规扫描";
	}

	return `${title} (${cronDescription})`;
}

/**
 * Fingerprint a candidate schedule to track duplicate proposals and user dismissals.
 */
export function computeScheduleFingerprint(cron: string, prompt: string, projectPath: string): string {
	const normalizedPrompt = prompt.toLowerCase().replace(/[\s\p{P}]+/gu, "").slice(0, 50);
	return createHash("sha256")
		.update(`${cron}:${projectPath}:${normalizedPrompt}`)
		.digest("hex")
		.slice(0, 16);
}

/**
 * Manage dismissed schedules memory file to prevent nagging.
 */
function getDismissedPath(agentDir: string): string {
	return path.join(agentDir, "dismissed-schedules.json");
}

export function isScheduleDismissed(agentDir: string, fingerprint: string): boolean {
	try {
		const filePath = getDismissedPath(agentDir);
		if (!fs.existsSync(filePath)) return false;
		const raw = fs.readFileSync(filePath, "utf8");
		const data = JSON.parse(raw);
		if (Array.isArray(data)) {
			return data.includes(fingerprint);
		}
		if (data && typeof data === "object") {
			return Boolean(data[fingerprint]);
		}
		return false;
	} catch {
		return false;
	}
}

export function recordDismissedSchedule(agentDir: string, fingerprint: string): void {
	try {
		const filePath = getDismissedPath(agentDir);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		let list: string[] = [];
		if (fs.existsSync(filePath)) {
			try {
				const raw = fs.readFileSync(filePath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) list = parsed;
			} catch {}
		}
		if (!list.includes(fingerprint)) {
			list.push(fingerprint);
			// Keep at most 200 dismissal records
			if (list.length > 200) list = list.slice(-200);
			fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf8");
		}
	} catch (err) {
		console.warn("[schedule-learner] Failed to record dismissed schedule:", err);
	}
}

/**
 * Check if a similar routine already exists in Desktop Routine host.
 */
export async function isDuplicateRoutine(
	routineHost: RoutineHostClient,
	candidate: { cron: string; cleanPrompt: string; projectPath: string },
): Promise<boolean> {
	try {
		const res = await routineHost.execute({ action: "list" });
		if (!res.ok || !Array.isArray(res.routines)) return false;

		const candidateKeywords = candidate.cleanPrompt.toLowerCase().replace(/[\s\p{P}]+/gu, "").slice(0, 30);

		for (const r of res.routines) {
			const existingKeywords = r.prompt.toLowerCase().replace(/[\s\p{P}]+/gu, "").slice(0, 30);
			// Same cron and overlapping prompt keyword core
			if (r.cron === candidate.cron && (candidateKeywords.includes(existingKeywords) || existingKeywords.includes(candidateKeywords))) {
				return true;
			}
			// Exact prompt match
			if (r.prompt.trim() === candidate.cleanPrompt.trim()) {
				return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Detect if current turn qualifies for a schedule suggestion.
 * Only active in Desktop environment with Routine Host enabled.
 */
export async function detectScheduleOpportunity(
	options: DetectScheduleOptions,
): Promise<ScheduleOpportunity | null> {
	// 1. Strictly Desktop only: check for routine host
	if (!options.routineHost && !process.env.METIS_ROUTINE_HOST) {
		return null;
	}

	const parsed = parsePeriodicIntentToCron(options.userPrompt);
	if (!parsed) {
		return null;
	}

	const projectPath = options.cwd;
	const fingerprint = computeScheduleFingerprint(parsed.cron, parsed.cleanPrompt, projectPath);

	// 2. Anti-nagging: check if user already dismissed this schedule
	if (isScheduleDismissed(options.agentDir, fingerprint)) {
		return null;
	}

	// 3. Deduplication: check if already exists in routine host
	if (options.routineHost) {
		const isDupe = await isDuplicateRoutine(options.routineHost, {
			cron: parsed.cron,
			cleanPrompt: parsed.cleanPrompt,
			projectPath,
		});
		if (isDupe) {
			return null;
		}
	}

	return {
		title: parsed.title,
		cron: parsed.cron,
		cronDescription: parsed.cronDescription,
		prompt: parsed.cleanPrompt,
		projectPath,
		reason: `检测到周期性指令需求: "${parsed.cronDescription}"`,
		fingerprint,
	};
}

/**
 * Propose schedule creation to user via `ask_user` and execute creation if confirmed.
 */
export async function proposeAndCreateSchedule(
	opportunity: ScheduleOpportunity,
	askUser: AskUserInvoker,
	routineHost: RoutineHostClient,
	agentDir: string,
): Promise<{ created: boolean; dismissed?: boolean; routineId?: string }> {
	const promptPreview = opportunity.prompt.length > 80 ? `${opportunity.prompt.slice(0, 77)}...` : opportunity.prompt;
	const questionText = [
		`💡 检测到您有周期性运行此任务的需求，是否自动创建 Desktop 定时例行任务 (Schedule)？`,
		``,
		`- **任务名称**：${opportunity.title}`,
		`- **执行周期**：${opportunity.cronDescription} (\`${opportunity.cron}\`)`,
		`- **执行指令**：${promptPreview}`,
		`- **执行目录**：${opportunity.projectPath}`,
	].join("\n");

	const optConfirm = `确认创建并开启：[${opportunity.title}]`;
	const optDismiss = "暂不创建";

	const request: AskUserRequest = {
		requestId: `schedule-confirm-${Date.now()}`,
		toolCallId: `call_${Date.now()}`,
		questions: [
			{
				id: "confirm_schedule",
				header: "定时例行任务提议",
				question: questionText,
				options: [
					{
						label: optConfirm,
						description: `在 Desktop 中创建并激活例行任务: ${opportunity.title}`,
						recommended: true,
					},
					{
						label: optDismiss,
						description: "忽略本次提议并记录偏好，近期不再重复打扰",
					},
				],
			},
		],
	};

	try {
		const rawAnswer = await askUser(request);
		let confirmed = false;

		if (typeof rawAnswer === "string") {
			confirmed = rawAnswer.includes("确认创建") || rawAnswer.includes("开启");
		} else if (rawAnswer && typeof rawAnswer === "object") {
			if (rawAnswer.cancelled) {
				recordDismissedSchedule(agentDir, opportunity.fingerprint);
				return { created: false, dismissed: true };
			}
			const answers = Array.isArray(rawAnswer.answers) ? rawAnswer.answers : [];
			const ans = answers.find((a: any) => a.id === "confirm_schedule") || answers[0];
			const val = ans?.selectedLabel || ans?.value || "";
			confirmed = typeof val === "string" && (val.includes("确认") || val.includes("开启"));
		}

		if (confirmed) {
			const res = await routineHost.execute({
				action: "create",
				payload: {
					title: opportunity.title,
					cron: opportunity.cron,
					prompt: opportunity.prompt,
					projectPath: opportunity.projectPath,
					status: "active",
					source: "self_learning",
				},
			});

			if (res.ok && res.routine) {
				return { created: true, routineId: res.routine.id };
			}
		}

		// User rejected or dismissed: remember to prevent repeated nagging
		recordDismissedSchedule(agentDir, opportunity.fingerprint);
		return { created: false, dismissed: true };
	} catch (err) {
		console.warn("[schedule-learner] proposeAndCreateSchedule interaction failed:", err);
		return { created: false };
	}
}
