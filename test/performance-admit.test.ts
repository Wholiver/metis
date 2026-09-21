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

	it("exposes JSON Schema enums Gemini can read, and tells the model not to hunt for them", () => {
		expect(performanceAdmitSchema.properties.taskShape).toMatchObject({
			type: "string",
			enum: ["bounded", "sequential-complex", "parallel"],
		});
		expect(performanceAdmitSchema.properties.tier).toMatchObject({
			type: "string",
			enum: ["T0", "T1", "T2", "T3"],
		});
		expect(performanceAdmitSchema.properties.lanes.items.properties.framework.enum).toContain("docs");
		expect(JSON.stringify(performanceAdmitSchema)).not.toContain('"anyOf"');
		expect(createPerformanceAdmitToolDefinition().promptGuidelines?.[0]).toContain("README");
		expect(createPerformanceAdmitToolDefinition().promptGuidelines?.[0]).toContain("Do not grep");
		expect(createPerformanceAdmitToolDefinition().promptGuidelines?.[0]).toContain("independent check");
		expect(createPerformanceAdmitToolDefinition().promptGuidelines?.[0]).not.toContain("after admit, write the file");
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
		expect(result.content[0].text).toContain("root performs G4; dispatch fresh G5 reviewer and G6 verifier");
		expect(result.details).toMatchObject({ runId: "perf-1", frontier: "G4" });
	});

	it("mentions T0 independent checks and artifact coercion in the route protocol", async () => {
		const admit = vi.fn(() => ({
			runId: "perf-svg",
			frontier: "G4",
			governanceRoot: "/tmp/perf-svg",
			admission: {
				tier: "T0" as const,
				taskShape: "bounded" as const,
				tierCoercedFrom: "T1" as const,
				deliverables: ["pelican.svg"],
				acceptanceCriteria: ["opens"],
				verificationCommands: ["xmllint --noout pelican.svg"],
				sharedMutableState: false,
				lanes: [{
					id: "svg",
					objective: "draw pelican svg",
					framework: "apply",
					ownedPaths: ["pelican.svg"],
					deliverables: ["pelican.svg"],
					acceptanceCriteria: ["opens"],
					verificationCommands: ["xmllint --noout pelican.svg"],
					dependsOn: [],
				}],
			},
		}));
		const definition = createPerformanceAdmitToolDefinition({
			admit,
			context: () => "frontier: G4; route: T0/bounded.",
		});
		const result = await definition.execute("call-svg", {
			tier: "T1",
			taskShape: "bounded",
			deliverables: ["pelican.svg"],
			acceptanceCriteria: ["opens"],
			verificationCommands: ["xmllint --noout pelican.svg"],
			sharedMutableState: false,
			lanes: [{
				id: "svg",
				objective: "draw pelican svg",
				framework: "apply",
				ownedPaths: ["pelican.svg"],
				deliverables: ["pelican.svg"],
				acceptanceCriteria: ["opens"],
				verificationCommands: ["xmllint --noout pelican.svg"],
				dependsOn: [],
			}],
		}, new AbortController().signal, () => {}, undefined as never);

		expect(result.content[0].text).toContain("independent checks, then G4");
		expect(result.content[0].text).toContain("Coerced from T1 to T0 for single-lane artifact apply/docs/polish");
	});
});
