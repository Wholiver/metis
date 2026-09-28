## 2024-05-18 - CWE-377: Insecure Temporary File Creation

**Vulnerability:** The application was generating predictable temporary file names using `Date.now()` and static strings like `session.html` within shared directories like `os.tmpdir()`. This predictability exposes the application to Symlink Attacks (CWE-377), where an attacker could create a symbolic link with the expected name beforehand, potentially causing the application to overwrite critical files or expose sensitive data.
**Learning:** Hardcoded strings or predictable values (like timestamps) should never be used for temporary file names in shared directories. Attackers can easily guess the filename and create malicious links.
**Prevention:** Always use cryptographically secure random identifiers, such as `crypto.randomUUID()`, when creating temporary files in shared directories to ensure the file names are unpredictable and mitigate the risk of Symlink Attacks.
