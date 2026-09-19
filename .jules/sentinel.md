## Sentinel Journal

## 2024-05-18 - [CRITICAL] Predictable Temporary File Names (CWE-377)
**Vulnerability:** Predictable temporary file names (e.g., `metis-editor-${Date.now()}.metis.md` or static strings like `session.html`) were created directly in the shared temporary directory (`os.tmpdir()`).
**Learning:** This exposes the application to symlink attacks, allowing an attacker to pre-create symlinks matching the predictable pattern to overwrite arbitrary files when the application writes to what it believes is a temp file.
**Prevention:** Always use cryptographically secure random identifiers (e.g., `crypto.randomUUID()`) when creating temporary files in shared directories like `os.tmpdir()`.
