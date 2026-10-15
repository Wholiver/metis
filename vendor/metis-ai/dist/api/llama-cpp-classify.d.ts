import type { ClassifierAnswer, ClassifierContext, ClassifierFunction, ClassifierOptions, ClassifierQuestion } from "../types.ts";
/** One question rendered for the model. */
export interface LabeledQuestion {
    /** User message content: the state, the question and its answer labels. */
    content: string;
    /** Answer labels the model can emit, in the order of `keys`. */
    labels: string[];
    /** Answer key each label stands for: choice keys, level indices, or `true`/`false`. */
    keys: string[];
}
/** The server root: pi's llama.cpp models use the OpenAI-compatible `/v1` URL as their base URL. */
export declare function llamaServerRoot(baseUrl: string): string;
/**
 * Writes one question of the request as a user message and picks its labels.
 * Throws for unsupported option counts.
 *
 * The message is the state, every question of the request with its options,
 * the state again, and then this question with labeled options. A causal model
 * reads the first copy of the state before it knows what is asked; the second
 * copy is read with the questions in view (prompt repetition). Everything
 * before the final question is the same for all questions of a request, so
 * the server's prompt cache evaluates it once.
 */
export declare function renderQuestion(context: ClassifierContext, id: string): LabeledQuestion;
/** Softmax over label log-probabilities after dividing them by `temperature`. */
export declare function labelProbabilities(logprobs: readonly number[], temperature: number): number[];
/** TypeSafe's documented choice confidence, `(n * peak - 1) / (n - 1)`, clamped to [0, 1]. */
export declare function peakConfidence(probabilities: readonly number[]): number;
/** Turns label probabilities, in the order of `keys`, into the public answer shape. */
export declare function answerFromProbabilities(question: ClassifierQuestion, keys: readonly string[], probabilities: readonly number[]): ClassifierAnswer;
/** Classifies with a chat model on llama-server by reading next-token probabilities of answer labels. */
export declare const classify: ClassifierFunction<ClassifierOptions>;
//# sourceMappingURL=llama-cpp-classify.d.ts.map