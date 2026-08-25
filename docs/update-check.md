# Update Check

Metis resolves the latest released version from a small JSON manifest hosted on GitHub. There is no IP or geolocation lookup — no third-party geo service is contacted, and nothing about the user's location leaves the machine.

The backend lives in [`src/utils/version-check.ts`](../src/utils/version-check.ts). Frontends never fetch the manifest directly — they call the local server endpoint or the desktop IPC channel described below.

## Manifest

The manifest lives at the root of the `main` branch of the [`Wholiver/metis-check-update`](https://github.com/Wholiver/metis-check-update) repository, served over the raw file host:

```
https://raw.githubusercontent.com/Wholiver/metis-check-update/main/latest-version.json
```

```json
{
  "version": "1.1.1",
  "packageName": "@wholiver_hu/metis",
  "note": "Optional Markdown upgrade notice",
  "publishedAt": "2026-08-25T00:00:00.000Z"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Latest released semver. A manifest without a non-empty string here is treated as a failed check. |
| `packageName` | no | npm package to install. Set this when the published scope changes; `metis update` installs `packageName@version`. Defaults to the currently installed package. |
| `note` | no | Markdown shown to the user alongside the update prompt. |
| `publishedAt` | no | Display only. Ignored by the backend. |

The check **fails** — reported as `checkFailed` below — when the request errors or times out (10 s), the status is not 2xx, the body is not valid JSON (e.g. a captive-portal HTML page), or `version` is missing.

## Consuming from a frontend

### Desktop (Electron renderer)

```ts
const result = await window.metisDesktop.update.check();
// result: { ok: boolean; status: number; data?: UpdateCheckResponse; error?: string }
if (result.ok && result.data?.updateAvailable) {
  showUpdateBanner(result.data.latest);
}
```

`update.check()` is exposed in [`desktop/preload.cjs`](../desktop/preload.cjs) and forwards through the `update:check` IPC handler in [`desktop/main.cjs`](../desktop/main.cjs) to the local Metis server, so the desktop shell and the CLI share one implementation. The outer `{ ok, status, data, error }` envelope is the standard shape of every desktop → server request; `ok: false` means the local server could not be reached at all (not that the update check failed).
### HTTP (any frontend)

```
GET http://127.0.0.1:4096/global/update-check
```

```ts
interface UpdateCheckResponse {
  currentVersion: string;
  updateAvailable: boolean;
  /** true when the manifest could not be read; `latest` is then absent. */
  checkFailed: boolean;
  latest?: {
    version: string;
    packageName?: string;
    note?: string;
    /** Source that produced the manifest. Diagnostic only. */
    source?: "github" | "custom";
  };
}
```

Distinguish the three outcomes:

- `checkFailed: true` — offline, GitHub unreachable, or checks disabled by env var. Show nothing, or a quiet "could not check" state. Never treat this as "up to date".
- `checkFailed: false, updateAvailable: false` — already on the latest version.
- `updateAvailable: true` — `latest` is present; render `latest.version` and, if set, `latest.note` as Markdown.

The endpoint performs a live check on every call and can take up to 10 s (the request timeout) before reporting failure. Call it on app start and on explicit user action — do not poll it on a short interval.

Note that `checkFailed: true` is also what you get when the user has disabled checks, so a frontend does not need to read the environment itself.

## Environment variables

| Variable | Effect |
| --- | --- |
| `METIS_SKIP_VERSION_CHECK=1` | Skip the version check entirely; no request is made. |
| `METIS_OFFLINE=1` (or `--offline`) | Disables all startup network operations, including this check. |
| `METIS_VERSION_MANIFEST_URLS` | Comma-separated list of manifest URLs that **replaces** the built-in GitHub source. Useful for a private mirror or local testing. When several are given they are requested concurrently and the first valid manifest wins. Entries that are not valid URLs are ignored; if none are valid, the built-in source is used. |

## Release procedure

The manifest is what clients see, so publishing a release is not complete until it is updated:

1. Bump `version` in `package.json` and release as usual.
2. In the [`metis-check-update`](https://github.com/Wholiver/metis-check-update) repository, set `latest-version.json` `version` to the same value (and `packageName` / `note` if they changed).
3. Push to `main`. Until this lands, clients keep reporting the previous version as latest.

## Testing

[`test/version-check.test.ts`](../test/version-check.test.ts) covers the happy path, error statuses, malformed manifests, the concurrent race used by multi-URL overrides, the env-var override, and the disable flags by stubbing global `fetch` per URL.

Manual end-to-end check:

```bash
node -e 'import("./dist/utils/version-check.js").then(m=>m.getLatestMetisRelease("0.0.1").then(console.log))'
```

```bash
curl http://127.0.0.1:4096/global/update-check
```
