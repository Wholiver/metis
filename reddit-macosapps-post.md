# Rules audit

All 13 r/MacOSApps rules were reviewed on 2026-08-28.

1. At least 5 comment karma in r/MacOSApps is required before posting.
2. Post must stay focused on macOS apps.
3. No hate or bullying.
4. The same app may only be submitted once. Future updates or gift codes belong in the original submission.
5. Post and comments must be in English.
6. Submission needs a clear app description, link, and privacy notice.
7. Because Metis is not in the Mac App Store, the post must introduce the developer, motivation, and problem.
8. Post must explain specific value and how Metis fits alongside existing solutions.
9. Apple notarization status must be explicit.
10. No trademark, copyright, branding, code, asset, or UI infringement.
11. New open-source projects are encouraged to have 40+ Stars and a complete README with screenshots, features, and installation instructions. Metis has 51 Stars and meets the stated Star guideline.
12. A public Privacy Policy link is strongly encouraged. Metis does not currently appear to publish a standalone Privacy Policy, so a precise privacy notice is included below. Publishing a policy before posting would reduce removal risk.
13. Significant AI use in code, UI assets, or promotional text must be disclosed. This post was drafted with AI assistance, so disclosure is mandatory.

# Recommended title

Same DeepSeek V4 Flash: Metis for Mac scored 82.02% vs OpenCode's 67.42% [Free, Open Source]

# Post

Hi r/MacOSApps. I am the solo developer of Metis.

I built it because long coding-agent runs often disappear into terminal logs. When something fails, it can be hard to tell whether the agent lost context, skipped planning, or stopped without verifying its work. I wanted a visual workspace where I could inspect the plan, answer questions, switch models, follow subagents, and resume interrupted sessions.

Metis includes:

- separate Plan and Build workflows;
- durable memory and recoverable sessions;
- visible subagent activity, token usage, attachments, and model settings;
- provider flexibility, including supported subscriptions, API keys, and custom OpenAI-compatible endpoints;
- the same open-source runtime in both desktop and terminal modes.

OpenCode is a strong terminal-first, model-flexible agent. Claude Code provides deep integration with Anthropic models. Metis takes a different approach by combining provider flexibility with a visible desktop workflow, persistent context, multi-agent coordination, and verification-focused execution.

In one controlled Terminal-Bench 2.1 run using the same DeepSeek V4 Flash model, version, tasks, environment, and budget, Metis solved 73/89 tasks versus 60/89 with OpenCode. This is one benchmark, not a universal performance claim.

**Pricing:** Free forever. $0. MIT licensed. No subscription or paid tier.

**Mac distribution:** Apple silicon only. Current builds are ad-hoc signed and **not notarized by Apple**. Download only from the official GitHub release and verify the published SHA-256 checksum.

**Privacy:** Sessions, settings, and credentials are stored locally. Prompts, selected project context, and attachments may be sent to the model provider you configure when needed to perform a task. Anonymous install/update telemetry is enabled by default and can be disabled with `METIS_TELEMETRY=0` or offline mode. Additional usage analytics is opt-in and disabled by default.

**AI disclosure:** This post was drafted with AI assistance and reviewed and edited by me. Choose the accurate project disclosure below before posting.

Source: https://github.com/Wholiver/metis

Official download: https://github.com/Wholiver/metis/releases/latest

Security and privacy controls: https://github.com/Wholiver/metis/blob/main/docs/security.md

I would especially value feedback on onboarding and whether the desktop workflow feels useful on Mac rather than like terminal output moved into a window.

# Required AI disclosure choice

Use exactly one accurate sentence in the post, immediately after the existing AI disclosure sentence.

## A. Significant AI assistance was used for code or UI

AI assistance was also used during development. I reviewed the resulting code, tests, UI, and documentation before release.

## B. Significant AI assistance was not used for code or UI

No significant portion of the application code or UI assets was AI-generated.

# Posting checklist

- Do not post until the account has at least 5 comment karma in r/MacOSApps.
- Confirm Metis has never been submitted to r/MacOSApps before. Rule 4 permits only one submission per app.
- Use English only.
- Attach a real Metis desktop screenshot or short walkthrough. Prefer the desktop UI over the benchmark chart as the lead media.
- Keep the developer introduction and relationship disclosure.
- Keep the explicit “not notarized by Apple” statement.
- Keep the privacy notice. Ideally publish and link a standalone Privacy Policy first.
- Select AI disclosure A or B. Do not post both or leave the choice unresolved.
- Use only official GitHub source and release links.
- Do not use affiliate, referral, shortened, or redirect links.
- Do not repost if removed. Ask moderators what needs correction.
