## 2025-02-27 - Predictable Temporary Directory Generation
**Vulnerability:** Insecure temporary file generation. Predictable `Math.random().toString(36)` was used to create temporary directories in `os.tmpdir()`.
**Learning:** Using `Math.random()` to generate random strings for temporary files/directories makes them predictable. An attacker can predict the directory name and preemptively create a file/directory or symlink with that name, leading to temporary file/symlink attacks, such as tricking the application into modifying unintended files.
**Prevention:** Use cryptographically secure methods for generating random identifiers, such as `crypto.randomBytes().toString('hex')` or `crypto.randomUUID()`.
