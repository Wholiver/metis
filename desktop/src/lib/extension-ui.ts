export type ExtensionUiMethod = 'confirm' | 'select' | 'input' | 'editor';

export interface ExtensionUiRequest {
  id: string;
  method: ExtensionUiMethod;
  title?: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options: string[];
}

export type ExtensionUiResponse =
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true }
  | { id: string; value: string };

const INTERACTIVE_METHODS = new Set<ExtensionUiMethod>(['confirm', 'select', 'input', 'editor']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function toExtensionUiRequest(event: Record<string, unknown>): ExtensionUiRequest | undefined {
  const id = optionalString(event.id);
  const method = optionalString(event.method) as ExtensionUiMethod | undefined;
  if (!id || !method || !INTERACTIVE_METHODS.has(method)) return undefined;

  return {
    id,
    method,
    title: optionalString(event.title),
    message: optionalString(event.message),
    placeholder: optionalString(event.placeholder),
    prefill: optionalString(event.prefill),
    options: Array.isArray(event.options) ? event.options.map(String) : [],
  };
}

export function cancelExtensionUiRequest(request: ExtensionUiRequest): ExtensionUiResponse {
  return request.method === 'confirm'
    ? { id: request.id, confirmed: false }
    : { id: request.id, cancelled: true };
}

export function submitExtensionUiRequest(request: ExtensionUiRequest, value: string): ExtensionUiResponse {
  return request.method === 'confirm'
    ? { id: request.id, confirmed: true }
    : { id: request.id, value };
}
