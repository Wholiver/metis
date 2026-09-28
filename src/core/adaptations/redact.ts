const SECRET = /(?:\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b|\b(?:api[_-]?key|authorization|password|token)\s*[:=]\s*[^\s,;]+)/gi;

export function redact(value: string): string {
	return value.replace(SECRET, "[redacted]").replace(/\0/g, "").trim();
}
