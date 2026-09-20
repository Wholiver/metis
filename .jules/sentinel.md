## 2024-05-24 - [Predictable Temporary File Names Risk (CWE-377)]
**Vulnerability:** Found multiple instances where temporary files and directories were created using predictable names like `Date.now()` or static strings in shared directories like `os.tmpdir()`.
**Learning:** This exposes the application to symlink overwrite attacks where a malicious user can pre-create a symlink at the predicted location, causing the application to overwrite unintended files with the application's privileges.
**Prevention:** Always use cryptographically secure random identifiers (e.g., `crypto.randomUUID()`) when creating temporary files or directories in shared locations.

## 2024-05-24 - [Broken Test on Slash Commands]
**Vulnerability:** Not a security vulnerability, but a regression introduced during the CI fix due to array length assertion.
**Learning:** Hardcoded length assertions can easily break tests when the array definition changes across commits.
**Prevention:** Avoid hardcoded lengths if possible, test for inclusion instead, or properly synchronize test constraints with source changes.
