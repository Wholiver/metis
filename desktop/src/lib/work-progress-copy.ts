import type { WorkProgressPhase } from './work-progress';

export type WorkProgressCopyState = WorkProgressPhase | 'idle' | 'task-received';

export const WORK_PROGRESS_LABELS: Record<WorkProgressCopyState, readonly string[]> = {
  idle: [
    'Response complete',
    'All set',
    'Ready when you are',
    'Standing by',
    'Task wrapped up',
  ],
  'task-received': [
    'Task received…',
    'Getting started…',
    'On it…',
    'Starting the task…',
    'Setting things in motion…',
  ],
  thinking: [
    'Analyzing the request…',
    'Thinking through the details…',
    'Mapping the next steps…',
    'Working through the context…',
    'Forming an approach…',
  ],
  waiting: [
    'Waiting for the next signal…',
    'Standing by for input…',
    'Waiting on a response…',
    'Pausing for the next step…',
    'Holding here for now…',
  ],
  reading: [
    'Reading the source material…',
    'Reviewing the details…',
    'Gathering context…',
    'Inspecting the relevant files…',
    'Taking in the latest information…',
  ],
  searching: [
    'Searching for the right path…',
    'Looking through the codebase…',
    'Finding the relevant pieces…',
    'Tracing the source…',
    'Exploring possible matches…',
  ],
  executing: [
    'Putting the changes in place…',
    'Working on the implementation…',
    'Applying the update…',
    'Making the requested changes…',
    'Moving the task forward…',
  ],
  issue: [
    'Recovering from an issue…',
    'Adjusting the approach…',
    'Working around a problem…',
    'Resolving an unexpected result…',
    'Getting things back on track…',
  ],
  drafting: [
    'Drafting the response…',
    'Writing up the result…',
    'Turning the work into an answer…',
    'Preparing the response…',
    'Shaping the final message…',
  ],
  coordinating: [
    'Coordinating the work…',
    'Bringing the pieces together…',
    'Syncing with the team…',
    'Delegating the next step…',
    'Keeping the work moving…',
  ],
  checking: [
    'Checking the latest result…',
    'Verifying the details…',
    'Reviewing the outcome…',
    'Making sure everything lines up…',
    'Running a final check…',
  ],
  finalizing: [
    'Finalizing the response…',
    'Finishing the last details…',
    'Wrapping up the result…',
    'Preparing the final answer…',
    'Completing the response…',
  ],
};

export function pickWorkProgressLabel(
  state: WorkProgressCopyState,
  random: () => number = Math.random,
  previous?: string,
): string {
  const choices = WORK_PROGRESS_LABELS[state];
  const randomValue = Math.max(0, Math.min(0.999999, random()));
  const index = Math.floor(randomValue * choices.length);
  const choice = choices[index];
  return choice === previous && choices.length > 1
    ? choices[(index + 1) % choices.length]
    : choice;
}
