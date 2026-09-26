## 2024-09-26 - Predictable Temporary File Names (CWE-377)
**Vulnerability:** Found uses of `Date.now()` and static names when creating temporary files in `os.tmpdir()` (`src/modes/interactive/interactive-mode.ts` and `src/modes/interactive/components/extension-editor.ts`), making them predictable and vulnerable to symlink attacks.
**Learning:** Shared directories like `/tmp` require cryptographically secure random names to prevent local privilege escalation or data overwrite.
**Prevention:** Always use `crypto.randomUUID()` when creating temporary files in `os.tmpdir()`.
