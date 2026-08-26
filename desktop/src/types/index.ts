export type AvatarType =
  | 'blob'
  | 'drop'
  | 'cloud'
  | 'water'
  | 'bean'
  | 'droplet'
  | 'pill'
  | 'triangle'
  | 'square';

export interface Agent {
  id: string;
  name: string;
  avatarType: AvatarType;
  gradient: string;
  subtitle: string;
  time: string;
  unread?: boolean;
  sessionPath?: string;
  projectPath?: string;
}

export interface AttachmentFile {
  name: string;
  sizeText: string;
  pagesText?: string;
  type: 'pdf' | 'file';
  url?: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type MessageAttachmentKind = 'image' | 'video' | 'text' | 'file';

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  name: string;
  sizeText: string;
  mimeType?: string;
  data?: string;
  previewUrl?: string;
  content?: string;
  path?: string;
}

export interface SendMessageOptions {
  workflowAction?: 'process_proposal';
  images?: ImageContent[];
  displayText?: string;
  attachments?: MessageAttachment[];
}

export interface ToolCallResult {
  content: string;
  isError?: boolean;
  timestamp?: string | number;
}

export interface SubagentProgress {
  jobId: string;
  state: 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export type AssistantContentPart =
  | {
      type: 'thinking';
      id: string;
      thinking: string;
      durationMs?: number;
    }
  | {
      type: 'text';
      id: string;
      text: string;
    }
  | {
      type: 'toolCall';
      id: string;
      name: string;
      arguments: unknown;
      result?: ToolCallResult;
      progress?: SubagentProgress;
    };

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: number;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  contextWindow: number;
  percent: number | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  thinkingDurationMs?: number;
  parts?: AssistantContentPart[];
  stopReason?: string;
  time?: string;
  serverTimestamp?: string | number;
  completedAt?: number;
  optimistic?: boolean;
  failed?: boolean;
  streaming?: boolean;
  file?: AttachmentFile;
  attachments?: MessageAttachment[];
  tags?: string[];
  usage?: MessageUsage;
}

export interface WorkflowProposalState {
  markdown: string;
  revision: number;
  updatedAt: string;
  sourceMessageId?: string;
}

export type WorkflowPlanStatus = 'pending' | 'in_progress' | 'completed';

export interface WorkflowPlanStep {
  step: string;
  status: WorkflowPlanStatus;
}

export interface WorkflowPlanState {
  explanation?: string;
  plan: WorkflowPlanStep[];
  updatedAt: string;
  taskId?: string;
  proposalRevision?: number;
  phase?: 'reading_proposal' | 'creating_checklist' | 'active';
  legacyMarkdown?: string;
}

export interface UserInputOption {
  label: string;
  description: string;
  recommended?: boolean;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options?: UserInputOption[];
}

export interface PendingUserInput {
  requestId: string;
  toolCallId: string;
  questions: UserInputQuestion[];
}

export interface UserInputAnswer {
  id: string;
  value: string;
  selectedLabel?: string;
}

export interface UserInputResponse {
  cancelled: boolean;
  answers: UserInputAnswer[];
}

export type CollaborationMode = 'plan' | 'build';

export interface ThinkingOption {
  id: string;
  label: string;
  value: string;
}

export interface ModelOption {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingOptions?: ThinkingOption[];
}

export interface RoutineItem {
  id: string;
  title: string;
  scheduleText: string;
  status: 'active' | 'paused';
}

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  color?: string;
}

export interface ServerSessionItem {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export type MemoryPhase = 'idle' | 'extracting' | 'consolidating' | 'retry_wait' | 'error' | 'disabled';

export interface MemoryState {
  enabled: boolean;
  phase: MemoryPhase;
  globalCount?: number;
  projectCount?: number;
  pendingJobs?: number;
  lastExtractedAt?: string;
  lastConsolidatedAt?: string;
  nextRetryAt?: string;
  error?: string;
  nextEligibleAt?: string;
  lastRunProcessed?: number;
  lastRunAdded?: number;
  lastRunSkipped?: number;
  lastExtractionMethod?: 'model' | 'fallback' | 'none';
  fallbackUsed?: boolean;
  modelFailureReason?: string;
  extractingTotal?: number;
  extractingProcessed?: number;
  extractingAdded?: number;
  extractingSkipped?: number;
  summary?: string;
  recordCount?: number;
  lastRunAt?: string;
  extractionMethod?: string;
}
