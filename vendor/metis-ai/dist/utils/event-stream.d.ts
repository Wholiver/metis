import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";
export declare class EventStream<T, R = T> implements AsyncIterable<T> {
    private queue;
    private waiting;
    protected done: boolean;
    private finalResultPromise;
    private resolveFinalResult;
    private isComplete;
    private extractResult;
    constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R);
    push(event: T): void;
    end(result?: R): void;
    [Symbol.asyncIterator](): AsyncIterator<T>;
    result(): Promise<R>;
}
/**
 * Event stream of one assistant response. It also times the response: the final message (`done` or `error` event, or
 * the result passed to `end()`) gets `durationMs`, measured with a monotonic clock from the stream's creation, unless
 * the message already has one or its `timestamp` predates the stream. A stream that forwards a response which started
 * elsewhere, such as a deferred result fetched later, therefore leaves it untimed.
 */
export declare class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
    #private;
    constructor();
    push(event: AssistantMessageEvent): void;
    end(result?: AssistantMessage): void;
}
/** Factory function for AssistantMessageEventStream (for use in extensions) */
export declare function createAssistantMessageEventStream(): AssistantMessageEventStream;
//# sourceMappingURL=event-stream.d.ts.map