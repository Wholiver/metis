import { describe, expect, it, vi } from "vitest";
import { createPerformanceAdmitToolDefinition, performanceAdmitSchema } from "../src/core/tools/performance-admit.ts";

describe("performance_admit tool", () => {
	const input = {
		tier: "T1" as const,
		taskShape: "bounded" as const,
		deliverables: ["working parser"],
		acceptanceCriteria: ["parser test passes"],
		verificationCommands: ["npm test -- parser"],
		sharedMutableState: false,
		lanes: [{
			id: "parser",
			objective: "repair parser",
			framework: "backend-fix",
			ownedPaths: ["src/parser.ts"],
			deliverables: ["parser fix"],
			acceptanceCriteria: ["malformed input is rejected"],
			verificationCommands: ["npm test -- parser"],
			dependsOn: [],
		}],
	};

	it("exposes the structured admission interface", () => {
		expect(performanceAdmitSchema.properties.tier).toBeDefined();
		expect(performanceAdmitSchema.properties.taskShape).toBeDefined();
		expect(performanceAdmitSchema.properties.lanes).toBeDefined();
	});

	it("returns compact live routing context from the admission seam", async () => {
		const admit = vi.fn(() => ({
			runId: "perf-1",
			frontier: "G4",
			governanceRoot: "/tmp/perf-1",
			admission: input,
		}));
		const definition = createPerformanceAdmitToolDefinition({
			admit,
			context: () => "frontier: G4; route: T1/bounded; allowed roles: reviewer, fresh-verifier.",
		});
		const result = await definition.execute("call-1", input, new AbortController().signal, () => {}, undefined as never);

		expect(admit).toHaveBeenCalledWith(input);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(result.content[0].text).toContain("route: T1/bounded");
		expect(result.details).toMatchObject({ runId: "perf-1", frontier: "G4" });
	});
});
