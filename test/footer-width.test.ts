import { visibleWidth } from "@earendil-works/metis-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import {
  FooterComponent,
  formatCwdForFooter,
} from "../src/modes/interactive/components/footer.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
};

function createSession(options: {
  sessionName: string;
  modelId?: string;
  provider?: string;
  reasoning?: boolean;
  thinkingLevel?: string;
  collaborationMode?: "build" | "plan";
  runningSubagents?: number;
  usage?: AssistantUsage;
}): AgentSession {
  const usage = options.usage;
  const entries =
    usage === undefined
      ? []
      : [
          {
            type: "message",
            message: {
              role: "assistant",
              usage,
            },
          },
        ];

  const session = {
    collaborationMode: options.collaborationMode ?? "build",
    state: {
      model: {
        id: options.modelId ?? "test-model",
        provider: options.provider ?? "test",
        contextWindow: 200_000,
        reasoning: options.reasoning ?? false,
      },
      thinkingLevel: options.thinkingLevel ?? "off",
    },
    sessionManager: {
      getEntries: () => entries,
      getSessionName: () => options.sessionName,
      getCwd: () => "/tmp/project",
    },
    getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
    getRunningSubagentCount: () => options.runningSubagents ?? 0,
    modelRegistry: {
      isUsingOAuth: () => false,
    },
  };

  return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
  const provider = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map<string, string>(),
    getAvailableProviderCount: () => providerCount,
    onBranchChange: (callback: () => void) => {
      void callback;
      return () => {};
    },
  };

  return provider;
}

function createFooterDataWithStatuses(
  providerCount: number,
  statuses: Map<string, string> = new Map(),
): ReadonlyFooterDataProvider {
  const provider = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => providerCount,
    onBranchChange: (callback: () => void) => {
      void callback;
      return () => {};
    },
  };

  return provider;
}

describe("formatCwdForFooter", () => {
  it("does not abbreviate sibling paths that share the home prefix", () => {
    expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
  });

  it("abbreviates the home directory and descendants", () => {
    expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
    expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe(
      "~/project",
    );
  });
});

describe("FooterComponent width handling", () => {
  beforeAll(() => {
    initTheme(undefined, false);
  });

  it("keeps all lines within width for wide session names", () => {
    const width = 93;
    const session = createSession({ sessionName: "한글".repeat(30) });
    const footer = new FooterComponent(session, createFooterData(1));

    const lines = footer.render(width);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("keeps stats line within width for wide model and provider names", () => {
    const width = 60;
    const session = createSession({
      sessionName: "",
      modelId: "模".repeat(30),
      provider: "공급자",
      reasoning: true,
      thinkingLevel: "high",
      usage: {
        input: 12_345,
        output: 6_789,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 1.234 },
      },
    });
    const footer = new FooterComponent(session, createFooterData(2));

    const lines = footer.render(width);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("shows one running subagent above the model line", () => {
    const session = createSession({ sessionName: "", runningSubagents: 1 });
    const footer = new FooterComponent(session, createFooterData(1));
    const lines = footer.render(80).map(stripAnsi);

    expect(lines).toHaveLength(3);
    expect(lines[1].trim()).toBe("1 running subagent");
    expect(lines[2]).toContain("test-model");
  });

  it("pluralizes multiple running subagents", () => {
    const session = createSession({ sessionName: "", runningSubagents: 3 });
    const footer = new FooterComponent(session, createFooterData(1));
    const lines = footer.render(80).map(stripAnsi);

    expect(lines[1].trim()).toBe("3 running subagents");
  });

  it("shows the latest cache hit rate when cache usage is present", () => {
    const session = createSession({
      sessionName: "",
      usage: {
        input: 100,
        output: 10,
        cacheRead: 50,
        cacheWrite: 50,
        cost: { total: 0.001 },
      },
    });
    const footer = new FooterComponent(session, createFooterData(1));

    const statsLine = stripAnsi(footer.render(120)[1]);
    expect(statsLine).toContain("CH25.0%");
  });

  it("renders Plan as a high-contrast labelled mode badge", () => {
    const session = createSession({ sessionName: "", collaborationMode: "plan" });
    const footer = new FooterComponent(session, createFooterData(1));
    const statsLine = footer.render(120)[1];

    expect(stripAnsi(statsLine)).toContain("PLAN");
    expect(statsLine).toContain(theme.getBgAnsi("toolPendingBg"));
  });

  it("keeps workflow stats on the main line and other statuses below", () => {
    const session = createSession({ sessionName: "" });
    const footer = new FooterComponent(
      session,
      createFooterDataWithStatuses(
        1,
        new Map([
			  ["dream", "Dream: Done"], // Legacy extension status is intentionally ignored.
          ["lint", "Lint: 3 warnings"],
        ]),
      ),
    );

    const lines = footer.render(120);
    expect(lines).toHaveLength(3);
		expect(stripAnsi(lines[1])).toContain("12.3%/200k (auto)");
		expect(stripAnsi(lines[1])).not.toContain("Dream");
    expect(stripAnsi(lines[2])).toContain("Lint: 3 warnings");
  });
});
