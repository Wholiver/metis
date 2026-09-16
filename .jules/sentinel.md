## 2026-09-16 - Prevent Symlink Attacks in Temporary Files
**Vulnerability:** Insecure temporary file creation using predictable names (e.g., `Date.now()` and static `session.html`) in `os.tmpdir()`.
**Learning:** This exposes the application to symlink attacks where a malicious local user could overwrite sensitive data or escalate privileges by predicting the file name and creating a symlink to a target file before the application writes to it.
**Prevention:** Always use cryptographically secure random identifiers, such as `crypto.randomUUID()`, when generating temporary file paths in shared directories.
