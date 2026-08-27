/**
 * Custom System Prompt
 *
 * Shows how to replace or modify the default system prompt.
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "metis";

const cwd = process.cwd();
const agentDir = getAgentDir();

	// Option 1: Replace the base instruction profile.
const loader1 = new DefaultResourceLoader({
	cwd,
	agentDir,
	baseInstructions: `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
	developerInstructions: [],
});
await loader1.reload();

const { session: session1 } = await createAgentSession({
	resourceLoader: loader1,
	sessionManager: SessionManager.inMemory(),
});

try {
	session1.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	console.log("=== Replace prompt ===");
	await session1.prompt("What is 2 + 2?");
	console.log("\n");
} finally {
	session1.dispose();
}

	// Option 2: Add trusted developer instructions to the default profile.
const loader2 = new DefaultResourceLoader({
	cwd,
	agentDir,
	developerInstructions: [
		"## Additional Instructions\n- Always be concise\n- Use bullet points when listing things",
	],
});
await loader2.reload();

const { session: session2 } = await createAgentSession({
	resourceLoader: loader2,
	sessionManager: SessionManager.inMemory(),
});

try {
	session2.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	console.log("=== Modify prompt ===");
	await session2.prompt("List 3 benefits of TypeScript.");
	console.log();
} finally {
	session2.dispose();
}

