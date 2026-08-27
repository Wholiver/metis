import type { ThinkingLevel } from "@earendil-works/metis-agent-core";
import type { ThinkingOption } from "@earendil-works/metis-ai";
import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/metis-tui";
import { getSelectListTheme } from "../theme/theme.ts";
import { t } from "../i18n/index.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const THINKING_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32,
};

const LEVEL_DESCRIPTION_KEYS: Partial<Record<ThinkingLevel, string>> = {
	off: "thinking.off",
	minimal: "thinking.minimal",
	low: "thinking.low",
	medium: "thinking.medium",
	high: "thinking.high",
	xhigh: "thinking.xhigh",
} as const;

/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(
		currentLevel: ThinkingLevel,
		availableOptions: ThinkingOption[],
		onSelect: (level: ThinkingLevel) => void,
		onCancel: () => void,
	) {
		super();

		const thinkingLevels: SelectItem[] = availableOptions.map((option) => ({
			value: option.id,
			label: option.label,
			description: LEVEL_DESCRIPTION_KEYS[option.id] ? t(LEVEL_DESCRIPTION_KEYS[option.id]! as any) : `Provider value: ${option.value}`,
		}));

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.selectList = new SelectList(
			thinkingLevels,
			thinkingLevels.length,
			getSelectListTheme(),
			THINKING_SELECT_LIST_LAYOUT,
		);

		// Preselect current level
		const currentIndex = thinkingLevels.findIndex((item) => item.value === currentLevel);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value as ThinkingLevel);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}

