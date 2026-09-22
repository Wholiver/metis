## 2026-09-22 - Found Missing NODE_OPTIONS Filtering
**Vulnerability:** Node.js process injection via missing NODE_OPTIONS filtering.
**Learning:** The DANGEROUS_ENV_VARS list failed to account for NODE_OPTIONS, which could allow attackers to inject malicious scripts via '--require=/malicious.js' when spawning child processes.
**Prevention:** Always filter out language-specific runtime injection variables like NODE_OPTIONS in addition to standard OS injection variables (like LD_PRELOAD) before spawning child agents.
