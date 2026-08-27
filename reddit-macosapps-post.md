# Recommended title

Metis: a free open-source coding agent with a visual Mac workspace

# Flair

💻 Productivity

# Post

Hi r/MacOSApps, I am the solo developer behind Metis.

I built it because long coding-agent runs often disappear into terminal logs. When something fails, it can be hard to see whether the agent lost context, skipped planning, or never verified its work.

Metis provides a visual Mac workspace for conversations, plans, model settings, sessions, token usage, questions, and subagent activity. It also includes explicit Plan and Build workflows, durable memory, recoverable sessions, recursive agents, and verification-focused execution. The same open-source runtime works from the terminal.

OpenCode is a strong terminal-first, model-flexible agent. Claude Code offers deep Anthropic integration. Metis focuses on combining provider flexibility with a visible desktop workflow and persistent, inspectable execution. In one controlled Terminal-Bench 2.1 run using the same DeepSeek V4 Flash setup, Metis solved 73/89 tasks versus 60/89 with OpenCode. This is one benchmark, not a universal performance claim.

**Privacy and security**

Metis works on local source trees, but prompts and relevant code context are sent to the model provider you configure. It sends an anonymous install/update version ping by default and checks for updates. Usage analytics are opt-in and disabled by default. Startup network operations can be disabled with offline mode.

Metis has no built-in OS sandbox. Its tools run with the permissions of the Metis process, so untrusted repositories and extensions require real OS or container isolation.

Data and telemetry details: https://github.com/Wholiver/metis/blob/main/docs/settings.md#telemetry-and-update-checks

Security model: https://github.com/Wholiver/metis/blob/main/docs/security.md

**AI disclosure**

I use AI-assisted engineering during development, while reviewing changes, maintaining tests, and owning product and security decisions. This promotional post was drafted with AI assistance and reviewed and edited by me.

**Pricing and distribution**

Metis is free forever, $0, and MIT licensed. There is no subscription or paid tier.

Mac support is currently Apple silicon only. The app is distributed outside the Mac App Store. Current builds are ad-hoc signed and **not notarized by Apple**. Download only from the official GitHub release and verify the published SHA-256 checksum.

Source: https://github.com/Wholiver/metis

Official download: https://github.com/Wholiver/metis/releases/latest

I would especially value feedback on onboarding and whether the desktop workflow feels useful on Mac.

# Compliance checklist

- Earn at least 5 comment karma in r/MacOSApps before posting.
- Confirm Metis has never been submitted to r/MacOSApps before. Rule 4 allows only one submission per app.
- Post and comments must be in English.
- Use the `💻 Productivity` flair.
- Developer introduction, motivation, problem, value, comparison, price, links, privacy notice, notarization status, and AI disclosure are included.
- Metis has 51 GitHub Stars, exceeding the rule's suggested 40+ baseline for a new open-source project.
- Repository already needs a comprehensive README with screenshots, feature list, and installation instructions. Verify these remain present before posting.
- Do not claim notarization. Current build is explicitly disclosed as not Apple-notarized.
- Do not remove or weaken the privacy, full-permission, or AI disclosures.
- Use only official GitHub source and release links.
