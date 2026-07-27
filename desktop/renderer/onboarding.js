/**
 * Metis Desktop - Pure Spotlight Onboarding Tour (黑白极简与精确定位)
 */
(function () {
	const STORAGE_KEY = "metis.desktopOnboardingCompleted.v1";

	let isRunning = false;
	let currentStep = 1; // 1: Credential, 2: Workspace, 3: First Message
	let subStep = 0; // For step 1: 0 = click settings, 1 = in security panel

	// UI Elements
	let overlayEl = null;
	let maskPathEl = null;
	let arrowPathEl = null;
	let spotlightRingEl = null;
	let inputBlockerEls = [];
	let cardEl = null;

	const STEPS = [
		{
			id: "credential",
			stepNum: 1,
			title: "配置 AI 凭据",
			desc: "请先配置模型 API Key、OAuth 授权或自定义 Base URL。点击【设置】进入账户与安全完成配置。",
			targetSelector: "#sidebarSettingsButton",
			targetPanel: null,
			placementPriority: ["top", "right", "bottom", "left"],
		},
		{
			id: "credential-panel",
			stepNum: 1,
			title: "配置 API / OAuth / Base URL",
			desc: "在 Provider 登录中，支持 API Key、OAuth 或自定义 Base URL，任选一种配置保存即可开启 Metis 能力！",
			targetSelector: ".settings-panel[data-settings-content='security'] .settings-group:nth-of-type(2)",
			targetPanel: "security",
			placementPriority: ["left", "bottom", "top", "right"],
		},
		{
			id: "workspace",
			stepNum: 2,
			title: "添加项目工作区",
			desc: "点击【添加项目】选择或新建一个本地代码仓库文件夹，Metis 将为你提供全项目级别的 Agent 协作！",
			targetSelector: "#chooseWorkspaceButton",
			targetPanel: null,
			placementPriority: ["right", "bottom", "top", "left"],
		},
		{
			id: "chat",
			stepNum: 3,
			title: "发送第一条消息",
			desc: "在下方输入框填入你的第一个需求（例如：帮我分析项目结构），点击发送开启 AI 协作体验！",
			targetSelector: "#composer",
			targetPanel: null,
			placementPriority: ["top", "right", "left", "bottom"],
		},
	];

	function getStepConfig() {
		if (currentStep === 1) {
			return subStep === 0 ? STEPS[0] : STEPS[1];
		}
		if (currentStep === 2) return STEPS[2];
		if (currentStep === 3) return STEPS[3];
		return STEPS[0];
	}

	function createOverlayDOM() {
		if (document.getElementById("onboardingOverlay")) return;

		const wrap = document.createElement("div");
		wrap.id = "onboardingOverlay";
		wrap.className = "onboarding-overlay hidden";
		wrap.innerHTML = `
			<svg class="onboarding-svg" width="100%" height="100%">
				<defs>
					<mask id="onboardingMask">
						<rect width="100%" height="100%" fill="white"/>
						<!-- Spotlight Mask Cutout -->
						<rect id="onboardingMaskCutout" x="0" y="0" width="0" height="0" rx="10" ry="10" fill="black" fill-opacity="0.9"/>
					</mask>
					<!-- Open arrow head stays legible even when the path is short. -->
					<marker id="sketchArrowHead" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
						<path d="M 1 1 L 10 6 L 1 11" class="sketch-arrow-head" />
					</marker>
					<filter id="onboardingSketchWobble" x="-10%" y="-10%" width="120%" height="120%">
						<feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="7" result="noise" />
						<feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G" />
					</filter>
				</defs>
				<rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.46)" mask="url(#onboardingMask)"/>
				<rect id="onboardingSpotlightRing" class="onboarding-spotlight-ring" x="0" y="0" width="0" height="0" rx="10" ry="10" />
				<!-- Natural Curved Arrow Pointer -->
				<path id="sketchArrow" class="sketch-arrow" d="" marker-end="url(#sketchArrowHead)" />
			</svg>
			<div class="onboarding-input-blocker" data-onboarding-blocker="top"></div>
			<div class="onboarding-input-blocker" data-onboarding-blocker="right"></div>
			<div class="onboarding-input-blocker" data-onboarding-blocker="bottom"></div>
			<div class="onboarding-input-blocker" data-onboarding-blocker="left"></div>
			<div id="onboardingCard" class="onboarding-card">
				<div class="onboarding-card-header">
					<span class="onboarding-step-badge" id="onboardingStepBadge">步骤 1 / 3</span>
					<button class="onboarding-skip-btn" id="onboardingSkipBtn" type="button" title="跳过引导">✕</button>
				</div>
				<div class="onboarding-card-body">
					<h3 id="onboardingCardTitle">配置 AI 凭据</h3>
					<p id="onboardingCardDesc">请配置 API Key 或 OAuth 登录。</p>
				</div>
				<div class="onboarding-card-footer">
					<button class="onboarding-prev-btn" id="onboardingPrevBtn" type="button">上一步</button>
					<button class="onboarding-next-btn" id="onboardingNextBtn" type="button">下一步</button>
				</div>
			</div>
		`;
		document.body.appendChild(wrap);

		overlayEl = wrap;
		maskPathEl = document.getElementById("onboardingMaskCutout");
		arrowPathEl = document.getElementById("sketchArrow");
		spotlightRingEl = document.getElementById("onboardingSpotlightRing");
		inputBlockerEls = Array.from(document.querySelectorAll("[data-onboarding-blocker]"));
		cardEl = document.getElementById("onboardingCard");

		document.getElementById("onboardingSkipBtn").addEventListener("click", stop);
		document.getElementById("onboardingNextBtn").addEventListener("click", nextStep);
		document.getElementById("onboardingPrevBtn").addEventListener("click", prevStep);
	}

	function clamp(value, min, max) {
		return Math.min(Math.max(value, min), Math.max(min, max));
	}

	// Two cubic segments make a restrained S curve while keeping the arrow head
	// perpendicular to the target edge.
	function generateSketchArrowPath(fromX, fromY, toX, toY, direction) {
		const dx = toX - fromX;
		const dy = toY - fromY;
		const midX = (fromX + toX) / 2;
		const midY = (fromY + toY) / 2;
		const distance = direction === "top" || direction === "bottom" ? Math.abs(dy) : Math.abs(dx);
		const bend = clamp(distance * 0.2, 7, 18);

		if (direction === "top" || direction === "bottom") {
			const sign = dy >= 0 ? 1 : -1;
			return [
				`M ${fromX.toFixed(1)},${fromY.toFixed(1)}`,
				`C ${(fromX + bend).toFixed(1)},${(fromY + dy * 0.18).toFixed(1)} ${(midX + bend).toFixed(1)},${(midY - sign * bend * 0.35).toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`,
				`C ${(midX - bend).toFixed(1)},${(midY + sign * bend * 0.35).toFixed(1)} ${toX.toFixed(1)},${(toY - dy * 0.2).toFixed(1)} ${toX.toFixed(1)},${toY.toFixed(1)}`,
			].join(" ");
		}

		const sign = dx >= 0 ? 1 : -1;
		return [
			`M ${fromX.toFixed(1)},${fromY.toFixed(1)}`,
			`C ${(fromX + dx * 0.18).toFixed(1)},${(fromY + bend).toFixed(1)} ${(midX - sign * bend * 0.35).toFixed(1)},${(midY + bend).toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`,
			`C ${(midX + sign * bend * 0.35).toFixed(1)},${(midY - bend).toFixed(1)} ${(toX - dx * 0.2).toFixed(1)},${toY.toFixed(1)} ${toX.toFixed(1)},${toY.toFixed(1)}`,
		].join(" ");
	}

	function chooseCardPlacement(targetRect, cardWidth, cardHeight, winWidth, winHeight, priority) {
		const viewportMargin = 16;
		const arrowGap = 62;
		const available = {
			top: targetRect.top - viewportMargin,
			bottom: winHeight - targetRect.bottom - viewportMargin,
			left: targetRect.left - viewportMargin,
			right: winWidth - targetRect.right - viewportMargin,
		};
		const required = {
			top: cardHeight + arrowGap,
			bottom: cardHeight + arrowGap,
			left: cardWidth + arrowGap,
			right: cardWidth + arrowGap,
		};
		const direction = priority.find((side) => available[side] >= required[side])
			|| priority.reduce((best, side) => available[side] / required[side] > available[best] / required[best] ? side : best);

		let x = targetRect.left + targetRect.width / 2 - cardWidth / 2;
		let y = targetRect.top + targetRect.height / 2 - cardHeight / 2;
		if (direction === "top") y = targetRect.top - arrowGap - cardHeight;
		if (direction === "bottom") y = targetRect.bottom + arrowGap;
		if (direction === "left") x = targetRect.left - arrowGap - cardWidth;
		if (direction === "right") x = targetRect.right + arrowGap;

		return {
			direction,
			x: clamp(x, viewportMargin, winWidth - cardWidth - viewportMargin),
			y: clamp(y, viewportMargin, winHeight - cardHeight - viewportMargin),
		};
	}

	function getArrowAnchors(placement, cardRect, targetRect, spotlightPad) {
		const targetCenterX = targetRect.left + targetRect.width / 2;
		const targetCenterY = targetRect.top + targetRect.height / 2;
		const edgeInset = 28;

		if (placement === "top" || placement === "bottom") {
			const x = clamp(targetCenterX, cardRect.left + edgeInset, cardRect.right - edgeInset);
			return placement === "top"
				? { fromX: x, fromY: cardRect.bottom + 5, toX: targetCenterX, toY: targetRect.top - spotlightPad - 6 }
				: { fromX: x, fromY: cardRect.top - 5, toX: targetCenterX, toY: targetRect.bottom + spotlightPad + 6 };
		}

		const y = clamp(targetCenterY, cardRect.top + edgeInset, cardRect.bottom - edgeInset);
		return placement === "left"
			? { fromX: cardRect.right + 5, fromY: y, toX: targetRect.left - spotlightPad - 6, toY: targetCenterY }
			: { fromX: cardRect.left - 5, fromY: y, toX: targetRect.right + spotlightPad + 6, toY: targetCenterY };
	}

	function setInputBlockerRect(name, x, y, width, height) {
		const blocker = inputBlockerEls.find((element) => element.dataset.onboardingBlocker === name);
		if (!blocker) return;
		blocker.style.left = `${Math.max(0, x)}px`;
		blocker.style.top = `${Math.max(0, y)}px`;
		blocker.style.width = `${Math.max(0, width)}px`;
		blocker.style.height = `${Math.max(0, height)}px`;
	}

	function updateInputBlockers(cutout, winWidth, winHeight) {
		setInputBlockerRect("top", 0, 0, winWidth, cutout.y);
		setInputBlockerRect("right", cutout.x + cutout.width, cutout.y, winWidth - cutout.x - cutout.width, cutout.height);
		setInputBlockerRect("bottom", 0, cutout.y + cutout.height, winWidth, winHeight - cutout.y - cutout.height);
		setInputBlockerRect("left", 0, cutout.y, cutout.x, cutout.height);
	}

	function blockEntireViewport() {
		setInputBlockerRect("top", 0, 0, window.innerWidth, window.innerHeight);
		for (const name of ["right", "bottom", "left"]) {
			setInputBlockerRect(name, 0, 0, 0, 0);
		}
	}

	function updateSpotlight() {
		if (!isRunning) return;

		const stepConfig = getStepConfig();
		document.getElementById("onboardingStepBadge").textContent = `步骤 ${stepConfig.stepNum} / 3`;
		document.getElementById("onboardingCardTitle").textContent = stepConfig.title;
		document.getElementById("onboardingCardDesc").textContent = stepConfig.desc;

		const prevBtn = document.getElementById("onboardingPrevBtn");
		const nextBtn = document.getElementById("onboardingNextBtn");
		prevBtn.style.display = currentStep === 1 && subStep === 0 ? "none" : "inline-block";
		nextBtn.textContent = currentStep === 3 ? "完成体验" : "下一步";

		let target = document.querySelector(stepConfig.targetSelector);

		if (!target || target.offsetParent === null) {
			arrowPathEl.setAttribute("d", "");
			spotlightRingEl.setAttribute("width", "0");
			spotlightRingEl.setAttribute("height", "0");
			maskPathEl.setAttribute("width", "0");
			maskPathEl.setAttribute("height", "0");
			blockEntireViewport();
			return;
		}

		const rect = target.getBoundingClientRect();
		const pad = 8;
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const cutout = {
			x: Math.max(0, rect.left - pad),
			y: Math.max(0, rect.top - pad),
			width: Math.min(winW, rect.right + pad) - Math.max(0, rect.left - pad),
			height: Math.min(winH, rect.bottom + pad) - Math.max(0, rect.top - pad),
		};

		maskPathEl.setAttribute("x", cutout.x);
		maskPathEl.setAttribute("y", cutout.y);
		maskPathEl.setAttribute("width", cutout.width);
		maskPathEl.setAttribute("height", cutout.height);
		spotlightRingEl.setAttribute("x", cutout.x + 1);
		spotlightRingEl.setAttribute("y", cutout.y + 1);
		spotlightRingEl.setAttribute("width", Math.max(0, cutout.width - 2));
		spotlightRingEl.setAttribute("height", Math.max(0, cutout.height - 2));
		updateInputBlockers(cutout, winW, winH);

		const cardSize = cardEl.getBoundingClientRect();
		const placement = chooseCardPlacement(rect, cardSize.width, cardSize.height, winW, winH, stepConfig.placementPriority);
		cardEl.style.left = `${placement.x}px`;
		cardEl.style.top = `${placement.y}px`;
		cardEl.dataset.placement = placement.direction;

		const positionedCardRect = cardEl.getBoundingClientRect();
		const anchors = getArrowAnchors(placement.direction, positionedCardRect, rect, pad);
		arrowPathEl.setAttribute("d", generateSketchArrowPath(
			anchors.fromX,
			anchors.fromY,
			anchors.toX,
			anchors.toY,
			placement.direction,
		));

	}

	function start() {
		createOverlayDOM();
		isRunning = true;
		currentStep = 1;
		const settingsShell = document.querySelector("#settingsShell");
		subStep = settingsShell && !settingsShell.hidden ? 1 : 0;
		overlayEl.classList.remove("hidden");

		updateSpotlight();

		window.addEventListener("resize", updateSpotlight);
		window.addEventListener("scroll", updateSpotlight, true);
	}

	function stop() {
		isRunning = false;
		if (overlayEl) {
			overlayEl.classList.add("hidden");
		}
		window.removeEventListener("resize", updateSpotlight);
		window.removeEventListener("scroll", updateSpotlight, true);
	}

	function complete() {
		localStorage.setItem(STORAGE_KEY, "true");
		showCelebration();
		setTimeout(() => {
			stop();
		}, 2200);
	}

	function showCelebration() {
		if (!cardEl) return;
		cardEl.classList.add("celebrating");
		document.getElementById("onboardingStepBadge").textContent = "🎉 初始化完成";
		document.getElementById("onboardingCardTitle").textContent = "开启 Metis AI 体验！";
		document.getElementById("onboardingCardDesc").textContent = "你已成功完成凭据配置、新建项目与首条消息提示，开启智能编程之旅！";
		document.getElementById("onboardingPrevBtn").style.display = "none";
		document.getElementById("onboardingNextBtn").style.display = "none";
	}

	function nextStep() {
		if (currentStep === 1) {
			if (subStep === 0) {
				subStep = 1;
				const settingsBtn = document.querySelector("#sidebarSettingsButton");
				if (settingsBtn) settingsBtn.click();
				setTimeout(() => {
					const securityNav = document.querySelector('[data-settings-panel="security"]');
					if (securityNav) securityNav.click();
					updateSpotlight();
				}, 150);
				return;
			} else {
				currentStep = 2;
				subStep = 0;
				const backBtn = document.querySelector("#settingsBackButton");
				if (backBtn) backBtn.click();
			}
		} else if (currentStep === 2) {
			currentStep = 3;
		} else if (currentStep === 3) {
			complete();
			return;
		}
		updateSpotlight();
	}

	function prevStep() {
		if (currentStep === 1 && subStep === 1) {
			subStep = 0;
			const backBtn = document.querySelector("#settingsBackButton");
			if (backBtn) backBtn.click();
			setTimeout(updateSpotlight, 150);
			return;
		} else if (currentStep === 2) {
			currentStep = 1;
			subStep = 1;
			const settingsBtn = document.querySelector("#sidebarSettingsButton");
			if (settingsBtn) settingsBtn.click();
			setTimeout(() => {
				const securityNav = document.querySelector('[data-settings-panel="security"]');
				if (securityNav) securityNav.click();
				updateSpotlight();
			}, 150);
			return;
		} else if (currentStep === 3) {
			currentStep = 2;
		}
		updateSpotlight();
	}

	function notifyEvent(eventType) {
		if (!isRunning) return;

		if (eventType === "provider_saved" || eventType === "credentials_present") {
			if (currentStep === 1) {
				currentStep = 2;
				subStep = 0;
				const backBtn = document.querySelector("#settingsBackButton");
				if (backBtn) backBtn.click();
				updateSpotlight();
			}
		} else if (eventType === "workspace_changed" || eventType === "workspace_added") {
			if (currentStep === 2) {
				currentStep = 3;
				updateSpotlight();
			}
		} else if (eventType === "message_sent") {
			if (currentStep === 3) {
				complete();
			}
		} else if (eventType === "open_settings") {
			if (currentStep === 1 && subStep === 0) {
				subStep = 1;
				setTimeout(() => {
					const securityNav = document.querySelector('[data-settings-panel="security"]');
					if (securityNav) securityNav.click();
					updateSpotlight();
				}, 150);
			}
		}
	}

	function isCompleted() {
		return localStorage.getItem(STORAGE_KEY) === "true";
	}

	function reset() {
		localStorage.removeItem(STORAGE_KEY);
		start();
	}

	window.MetisOnboarding = {
		start,
		stop,
		complete,
		nextStep,
		prevStep,
		notifyEvent,
		isCompleted,
		reset,
	};
})();
