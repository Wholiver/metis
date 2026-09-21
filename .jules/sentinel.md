## 2025-02-28 - Secure Temporary File Creation
**Vulnerability:** Use of predictable temporary file names (e.g., `Date.now()`, static names like `session.html`) in shared directories like `os.tmpdir()`.
**Learning:** This exposes the application to symlink attacks (CWE-377), where a malicious user could pre-create a symlink with the predictable name, potentially leading to arbitrary file overwrite or information disclosure when the application writes to or reads from the file.
**Prevention:** Always use cryptographically secure random identifiers (e.g., `crypto.randomUUID()`) when creating temporary files in shared directories.
