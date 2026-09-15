## 2024-05-24 - Insecure Temporary File Names (CWE-377)
**Vulnerability:** Insecure temporary file creation using predictable names (e.g., `session.html` or names based on `Date.now()`/`Math.random()`) in shared directories like `os.tmpdir()`.
**Learning:** This exposes the application to symlink attacks (CWE-377) on multi-user systems. A malicious actor can pre-create these files as symlinks to sensitive files, leading to unauthorized overwriting or data leakage. It also causes race conditions when multiple instances run simultaneously.
**Prevention:** Always use cryptographically secure random identifiers (e.g., `crypto.randomUUID()`) when creating temporary files in shared directories.
