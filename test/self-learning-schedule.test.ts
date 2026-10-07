import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	parsePeriodicIntentToCron,
	extractScheduledPrompt,
	computeScheduleFingerprint,
	isScheduleDismissed,
	recordDismissedSchedule,
	isDuplicateRoutine,
	detectScheduleOpportunity,
	proposeAndCreateSchedule,
} from "../src/core/adaptations/schedule-learner.ts";
import { runOnlineFastLearner } from "../src/core/adaptations/fast-learner.ts";
import type { RoutineHostClient, RoutineHostCommand, RoutineHostResult } from "../src/core/routine-host.ts";
import type { AskUserRequest, AskUserResponse } from "../src/core/ask-user.ts";

describe("self-learning schedule & routine generator (Desktop only)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-schedule-learner-test-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("parsePeriodicIntentToCron & extractScheduledPrompt", () => {
		it("parses daily morning schedules", () => {
			const res = parsePeriodicIntentToCron("每天早上9点帮我跑测试");
			expect(res).not.toBeNull();
			expect(res?.cron).toBe("0 9 * * *");
			expect(res?.cronDescription).toBe("每天 09:00");
			expect(res?.title).toContain("测试");
			expect(res?.cleanPrompt).toBeDefined();
		});

		it("parses weekday evening schedules", () => {
			const res = parsePeriodicIntentToCron("工作日18:00整理今天的未提交代码");
			expect(res).not.toBeNull();
			expect(res?.cron).toBe("0 18 * * 1-5");
			expect(res?.cronDescription).toBe("工作日 18:00");
		});

		it("parses hourly health check schedules", () => {
			const res = parsePeriodicIntentToCron("每小时自动执行一次系统健康巡检");
			expect(res).not.toBeNull();
			expect(res?.cron).toBe("0 * * * *");
			expect(res?.cronDescription).toBe("每小时整点");
		});

		it("parses every 30 minutes schedule", () => {
			const res = parsePeriodicIntentToCron("每30分钟拉取一次最新代码");
			expect(res).not.toBeNull();
			expect(res?.cron).toBe("*/30 * * * *");
			expect(res?.cronDescription).toBe("每 30 分钟");
		});

		it("parses specific day of week schedules", () => {
			const resMon = parsePeriodicIntentToCron("每周一上午10:00汇总上周进展");
			expect(resMon).not.toBeNull();
			expect(resMon?.cron).toBe("0 10 * * 1");
			expect(resMon?.cronDescription).toBe("每周一 10:00");

			const resFri = parsePeriodicIntentToCron("每周五下午5点整理待上线清单");
			expect(resFri).not.toBeNull();
			expect(resFri?.cron).toBe("0 17 * * 5");
			expect(resFri?.cronDescription).toBe("每周五 17:00");
		});

		it("ignores non-periodic instructions", () => {
			expect(parsePeriodicIntentToCron("帮我写一个快速排序算法")).toBeNull();
			expect(parsePeriodicIntentToCron("修复 src/main.ts 的类型报错")).toBeNull();
			expect(parsePeriodicIntentToCron("请解释什么是 Dependency Injection")).toBeNull();
		});

		it("cleans meta periodic phrasing from prompt", () => {
			const cleaned = extractScheduledPrompt("每天早上9点都帮我跑一次测试并汇报结果");
			expect(cleaned).not.toContain("每天早上9点");
			expect(cleaned).toContain("测试并汇报结果");
		});
	});

	describe("fingerprinting and anti-nagging memory", () => {
		it("computes deterministic fingerprint", () => {
			const fp1 = computeScheduleFingerprint("0 9 * * *", "跑一次测试", "/workspace/project");
			const fp2 = computeScheduleFingerprint("0 9 * * *", "跑一次测试", "/workspace/project");
			expect(fp1).toBe(fp2);
			expect(typeof fp1).toBe("string");
		});

		it("records dismissals and remembers them to prevent nagging", () => {
			const fp = "test-fp-123";
			expect(isScheduleDismissed(tempDir, fp)).toBe(false);

			recordDismissedSchedule(tempDir, fp);
			expect(isScheduleDismissed(tempDir, fp)).toBe(true);

			// Check dismissed file
			const dismissedFile = path.join(tempDir, "dismissed-schedules.json");
			expect(fs.existsSync(dismissedFile)).toBe(true);
			const list = JSON.parse(fs.readFileSync(dismissedFile, "utf8"));
			expect(list).toContain(fp);
		});
	});

	describe("deduplication against existing routines", () => {
		it("detects existing routine with duplicate schedule & prompt", async () => {
			const mockHost: RoutineHostClient = {
				async execute(cmd: RoutineHostCommand): Promise<RoutineHostResult> {
					if (cmd.action === "list") {
						return {
							ok: true,
							routines: [
								{
									id: "routine-1",
									title: "测试任务",
									cron: "0 9 * * *",
									prompt: "运行项目测试套件",
									projectPath: "/proj",
									status: "active",
									createdAt: new Date().toISOString(),
								},
							],
						};
					}
					return { ok: true };
				},
			};

			const isDupe = await isDuplicateRoutine(mockHost, {
				cron: "0 9 * * *",
				cleanPrompt: "运行项目测试套件",
				projectPath: "/proj",
			});
			expect(isDupe).toBe(true);

			const isNotDupe = await isDuplicateRoutine(mockHost, {
				cron: "0 18 * * 1-5",
				cleanPrompt: "完全不同的任务",
				projectPath: "/proj",
			});
			expect(isNotDupe).toBe(false);
		});
	});

	describe("detectScheduleOpportunity (Desktop check)", () => {
		it("returns null if routineHost is absent and environment is not Desktop", async () => {
			const oldEnv = process.env.METIS_ROUTINE_HOST;
			delete process.env.METIS_ROUTINE_HOST;
			try {
				const opp = await detectScheduleOpportunity({
					userPrompt: "每天早上9点运行测试",
					cwd: tempDir,
					agentDir: tempDir,
					routineHost: undefined,
				});
				expect(opp).toBeNull();
			} finally {
				if (oldEnv) process.env.METIS_ROUTINE_HOST = oldEnv;
			}
		});

		it("returns opportunity when routineHost is provided and prompt is periodic", async () => {
			const mockHost: RoutineHostClient = {
				async execute(): Promise<RoutineHostResult> {
					return { ok: true, routines: [] };
				},
			};

			const opp = await detectScheduleOpportunity({
				userPrompt: "每天早上9点运行测试",
				cwd: tempDir,
				agentDir: tempDir,
				routineHost: mockHost,
			});

			expect(opp).not.toBeNull();
			expect(opp?.cron).toBe("0 9 * * *");
			expect(opp?.cronDescription).toBe("每天 09:00");
			expect(opp?.fingerprint).toBeDefined();
		});

		it("skips opportunity if user already dismissed it", async () => {
			const mockHost: RoutineHostClient = {
				async execute(): Promise<RoutineHostResult> {
					return { ok: true, routines: [] };
				},
			};

			const opp1 = await detectScheduleOpportunity({
				userPrompt: "每天早上9点运行测试",
				cwd: tempDir,
				agentDir: tempDir,
				routineHost: mockHost,
			});
			expect(opp1).not.toBeNull();

			// Record dismissal
			recordDismissedSchedule(tempDir, opp1!.fingerprint);

			// Second attempt should be bypassed
			const opp2 = await detectScheduleOpportunity({
				userPrompt: "每天早上9点运行测试",
				cwd: tempDir,
				agentDir: tempDir,
				routineHost: mockHost,
			});
			expect(opp2).toBeNull();
		});
	});

	describe("proposeAndCreateSchedule (Interactive confirmation)", () => {
		it("creates routine with source: 'self_learning' when user confirms", async () => {
			let createdPayload: any = null;
			const mockHost: RoutineHostClient = {
				async execute(cmd: RoutineHostCommand): Promise<RoutineHostResult> {
					if (cmd.action === "create") {
						createdPayload = cmd.payload;
						return {
							ok: true,
							routine: {
								id: "routine-new-123",
								title: cmd.payload.title,
								cron: cmd.payload.cron,
								prompt: cmd.payload.prompt,
								status: "active",
								source: cmd.payload.source,
								createdAt: new Date().toISOString(),
							},
						};
					}
					return { ok: true };
				},
			};

			const opportunity = {
				title: "自动运行测试与回归校验",
				cron: "0 9 * * *",
				cronDescription: "每天 09:00",
				prompt: "运行测试",
				projectPath: tempDir,
				reason: "检测到周期性指令需求",
				fingerprint: "fp-test-confirm",
			};

			// User confirms via askUser
			const mockAskUser = async (req: AskUserRequest): Promise<AskUserResponse> => {
				expect(req.questions.length).toBe(1);
				expect(req.questions[0].options?.length).toBe(2);
				expect(req.questions[0].options?.[0].label).toContain("确认创建");
				return {
					cancelled: false,
					answers: [
						{
							id: "confirm_schedule",
							value: req.questions[0].options![0].label,
							selectedLabel: req.questions[0].options![0].label,
						},
					],
				};
			};

			const result = await proposeAndCreateSchedule(opportunity, mockAskUser, mockHost, tempDir);
			expect(result.created).toBe(true);
			expect(result.routineId).toBe("routine-new-123");
			expect(createdPayload).not.toBeNull();
			expect(createdPayload.source).toBe("self_learning");
			expect(createdPayload.status).toBe("active");
			expect(createdPayload.cron).toBe("0 9 * * *");
		});

		it("does not create routine and records dismissal when user rejects", async () => {
			let createdPayload: any = null;
			const mockHost: RoutineHostClient = {
				async execute(cmd: RoutineHostCommand): Promise<RoutineHostResult> {
					if (cmd.action === "create") {
						createdPayload = cmd.payload;
					}
					return { ok: true };
				},
			};

			const opportunity = {
				title: "自动运行测试与回归校验",
				cron: "0 9 * * *",
				cronDescription: "每天 09:00",
				prompt: "运行测试",
				projectPath: tempDir,
				reason: "检测到周期性指令需求",
				fingerprint: "fp-test-reject",
			};

			// User chooses "暂不创建"
			const mockAskUser = async (_req: AskUserRequest): Promise<AskUserResponse> => {
				return {
					cancelled: false,
					answers: [
						{
							id: "confirm_schedule",
							value: "暂不创建",
							selectedLabel: "暂不创建",
						},
					],
				};
			};

			const result = await proposeAndCreateSchedule(opportunity, mockAskUser, mockHost, tempDir);
			expect(result.created).toBe(false);
			expect(result.dismissed).toBe(true);
			expect(createdPayload).toBeNull();
			expect(isScheduleDismissed(tempDir, "fp-test-reject")).toBe(true);
		});
	});

	describe("runOnlineFastLearner integration", () => {
		it("detects and proposes routine in fast learner loop when routineHost is active", async () => {
			let createdRoutine: any = null;
			const mockHost: RoutineHostClient = {
				async execute(cmd: RoutineHostCommand): Promise<RoutineHostResult> {
					if (cmd.action === "list") {
						return { ok: true, routines: createdRoutine ? [createdRoutine] : [] };
					}
					if (cmd.action === "create") {
						createdRoutine = {
							id: "routine-fast-1",
							...cmd.payload,
							createdAt: new Date().toISOString(),
						};
						return { ok: true, routine: createdRoutine };
					}
					return { ok: true };
				},
			};

			const refreshedAdaptations: any[] = [];
			const mockSession = {
				agentDir: tempDir,
				isSelfLearningActive: () => true,
				askUser: async (req: AskUserRequest): Promise<AskUserResponse> => {
					return {
						cancelled: false,
						answers: [
							{
								id: req.questions[0].id,
								value: req.questions[0].options![0].label,
								selectedLabel: req.questions[0].options![0].label,
							},
						],
					};
				},
				refreshAdaptations: async (event: any) => {
					refreshedAdaptations.push(event);
				},
				sessionManager: {
					getCwd: () => tempDir,
				},
			};

			const messages = [
				{ role: "user" as const, content: "请每天早上9点跑一次单元测试" },
				{ role: "assistant" as const, content: "好的，我已经了解。" },
			];

			const result = await runOnlineFastLearner({
				session: mockSession,
				mode: "desktop",
				messages,
				routineHost: mockHost,
			});

			expect(result.success).toBe(true);
			expect(result.createdScheduleCount).toBe(1);
			expect(createdRoutine).not.toBeNull();
			expect(createdRoutine.source).toBe("self_learning");
			expect(createdRoutine.cron).toBe("0 9 * * *");
			expect(refreshedAdaptations.some((e) => e.kind === "schedule")).toBe(true);
		});
	});
});
