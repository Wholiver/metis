## 2024-05-24 - Unsafe Temporary File Generation
**Vulnerability:** Found predictable temporary file generation using `Date.now()` and static string `"session.html"` in shared directories (`os.tmpdir()`) in `src/modes/interactive/interactive-mode.ts` and `src/modes/interactive/components/extension-editor.ts`.
**Learning:** Hardcoded or predictably-named temporary files in world-writable directories are vulnerable to local symlink attacks and race conditions (CWE-377).
**Prevention:** Always use cryptographically secure random values, such as `crypto.randomUUID()`, combined with a prefix when generating names for temporary files in shared directories.
