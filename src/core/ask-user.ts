/** Portable contract for a model-initiated clarification. */
export interface AskUserOption {
	label: string;
	description: string;
	recommended?: boolean;
}

export interface AskUserQuestion {
	id: string;
	header: string;
	question: string;
	options?: AskUserOption[];
}

export interface AskUserRequest {
	requestId: string;
	toolCallId: string;
	questions: AskUserQuestion[];
}

export interface AskUserAnswer {
	id: string;
	value: string;
	selectedLabel?: string;
}

export interface AskUserResponse {
	cancelled: boolean;
	answers: AskUserAnswer[];
}

export type AskUserHandler = (request: AskUserRequest, signal?: AbortSignal) => Promise<AskUserResponse>;

export function validateAskUserRequest(request: Omit<AskUserRequest, "requestId" | "toolCallId">): string | undefined {
	if (request.questions.length < 1 || request.questions.length > 3) return "ask_user requires one to three questions.";
	const ids = new Set<string>();
	for (const question of request.questions) {
		if (!question.id?.trim() || !question.header?.trim() || !question.question?.trim()) return "Each ask_user question requires id, header, and question.";
		if (ids.has(question.id)) return "ask_user question ids must be unique.";
		ids.add(question.id);
		if (question.options && (question.options.length < 2 || question.options.length > 3)) return "Question options must contain two or three choices.";
		if (question.options?.some((option) => !option.label?.trim() || !option.description?.trim())) return "Each ask_user option requires a non-empty label and description.";
		if (question.options && new Set(question.options.map((option) => option.label)).size !== question.options.length) return "ask_user option labels must be unique within each question.";
		if ((question.options ?? []).filter((option) => option.recommended).length > 1) return "Each question may have at most one recommended option.";
	}
	return undefined;
}

export function validateAskUserResponse(request: AskUserRequest, response: AskUserResponse): string | undefined {
	if (response.cancelled) return response.answers.length === 0 ? undefined : "A cancelled ask_user response must not contain answers.";
	if (response.answers.length !== request.questions.length) return "A completed ask_user response must answer every question exactly once.";
	const questions = new Map(request.questions.map((question) => [question.id, question]));
	const seen = new Set<string>();
	for (const answer of response.answers) {
		if (!answer || typeof answer.id !== "string" || typeof answer.value !== "string" || !answer.value.trim()) return "Every ask_user answer requires a known id and a non-empty value.";
		if (seen.has(answer.id)) return "ask_user answer ids must be unique.";
		seen.add(answer.id);
		const question = questions.get(answer.id);
		if (!question) return `Unknown ask_user answer id: ${answer.id}`;
		if (answer.selectedLabel !== undefined) {
			const option = question.options?.find((candidate) => candidate.label === answer.selectedLabel);
			if (!option || answer.value !== option.label) return `selectedLabel for ${answer.id} must match an option and its value.`;
		}
	}
	return undefined;
}
