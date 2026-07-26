#!/usr/bin/env node
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { main } from "./main.ts";

process.title = `${APP_NAME}-rpc`;
process.env.METIS_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

const userArgs = process.argv.slice(2);
const hasMode = userArgs.includes("--mode");
const hasPrint = userArgs.includes("--print") || userArgs.includes("-p");

if (!hasMode && !hasPrint) {
	main(["--mode", "rpc", ...userArgs]);
} else {
	main(userArgs);
}

