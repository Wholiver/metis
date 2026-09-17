/**
 * Internal host-dispatch marker for Controller named-child runners.
 * Must NOT be exposed on the model-facing spawn_agent schema.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const hostDispatchStore = new AsyncLocalStorage<{ hostDispatch: true }>();

/** Run a Controller-owned named-child dispatch with the internal hostDispatch flag. */
export function runAsHostDispatch<T>(fn: () => T): T;
export function runAsHostDispatch<T>(fn: () => Promise<T>): Promise<T>;
export function runAsHostDispatch<T>(fn: () => T | Promise<T>): T | Promise<T> {
	return hostDispatchStore.run({ hostDispatch: true }, fn);
}

/** True only inside Controller named-child runner execute paths. */
export function isHostDispatchActive(): boolean {
	return hostDispatchStore.getStore()?.hostDispatch === true;
}
