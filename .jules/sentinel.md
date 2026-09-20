## 2024-05-24 - [Predictable Temporary File Names Risk (CWE-377)]
**Vulnerability:** Found multiple instances where temporary files and directories were created using predictable names like `Date.now()` or static strings in shared directories like `os.tmpdir()`.
**Learning:** This exposes the application to symlink overwrite attacks where a malicious user can pre-create a symlink at the predicted location, causing the application to overwrite unintended files with the application's privileges.
**Prevention:** Always use cryptographically secure random identifiers (e.g., `crypto.randomUUID()`) when creating temporary files or directories in shared locations.
