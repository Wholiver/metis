import {
  ImageContent,
  MessageAttachment,
  MessageAttachmentKind,
} from '../types';

export const MAX_INLINE_TEXT_BYTES = 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
export const MAX_BUFFERED_ATTACHMENT_BYTES = 128 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'conf', 'cpp', 'css', 'csv', 'go', 'h', 'hpp', 'html', 'ini', 'java', 'js', 'json', 'jsx',
  'log', 'md', 'mjs', 'py', 'rb', 'rs', 'sh', 'sql', 'svg', 'toml', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml',
]);
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_EXTENSIONS = new Set(['avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv']);
const TEXT_MIME_TYPES = new Set([
  'application/javascript', 'application/json', 'application/ld+json', 'application/sql', 'application/toml',
  'application/x-httpd-php', 'application/x-javascript', 'application/x-sh', 'application/xhtml+xml',
  'application/xml', 'application/yaml', 'image/svg+xml',
]);
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

type FileDescriptor = { name?: string; type?: string; size?: number };

function extensionOf(name = ''): string {
  return String(name).toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
}

export function classifyAttachment(file: FileDescriptor): MessageAttachmentKind {
  const mimeType = String(file.type || '').toLowerCase();
  const extension = extensionOf(file.name);
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'file';
}

export function formatFileSize(size = 0): string {
  const bytes = Number.isFinite(Number(size)) ? Number(size) : 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function imageMimeType(file: FileDescriptor): string {
  const mimeType = String(file.type || '').toLowerCase();
  return mimeType.startsWith('image/') ? mimeType : IMAGE_MIME_BY_EXTENSION[extensionOf(file.name)] || 'image/png';
}

export function filesFromTransfer(transfer?: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files || []);
  if (files.length > 0) return files;
  return Array.from(transfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function transferHasFiles(transfer?: DataTransfer | null): boolean {
  return Boolean(transfer && (filesFromTransfer(transfer).length > 0 || Array.from(transfer.types || []).includes('Files')));
}

function safeBackticks(value: string): string {
  return value.replaceAll('`', "'");
}

export function attachmentPrompt(attachment: MessageAttachment): string {
  const token = attachment.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'attachment';
  const metadata = encodeURIComponent(JSON.stringify({
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    sizeText: attachment.sizeText,
    mimeType: attachment.mimeType,
    path: attachment.path,
  }));
  const safeName = safeBackticks(attachment.name || 'attachment');
  let context: string;
  if (attachment.kind === 'image') {
    context = `已添加图片 \`${safeName}\`，请结合图片内容处理。`;
  } else if (attachment.kind === 'text') {
    context = `文件 \`${safeName}\` 的内容如下：\n\`\`\`\n${attachment.content || ''}\n\`\`\``;
  } else {
    const safePath = safeBackticks(attachment.path || '');
    const noun = attachment.kind === 'video' ? '视频' : '文件';
    const instruction = attachment.kind === 'video' ? '请按需使用 video 工具处理。' : '请按需读取或处理该文件。';
    context = `已添加${noun} \`${safeName}\`，本地路径：\`${safePath}\`。${instruction}`;
  }
  return `<metis_attachment data="${metadata}" token="${token}">\n${context}\n</metis_attachment:${token}>`;
}

export function composeAttachmentPayload(text: string, attachments: MessageAttachment[]): {
  message: string;
  images?: ImageContent[];
} {
  const blocks = attachments.map(attachmentPrompt);
  const message = [text.trim(), ...blocks].filter(Boolean).join('\n\n');
  const images = attachments.flatMap((attachment): ImageContent[] => (
    attachment.kind === 'image' && attachment.data && attachment.mimeType
      ? [{ type: 'image', data: attachment.data, mimeType: attachment.mimeType }]
      : []
  ));
  return { message, ...(images.length > 0 ? { images } : {}) };
}

export function parseAttachmentPayloadText(value: string): {
  text: string;
  attachments: MessageAttachment[];
} {
  const attachments: MessageAttachment[] = [];
  const visible: string[] = [];
  const openPattern = /<metis_attachment data="([^"]+)" token="([a-zA-Z0-9_-]+)">/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = openPattern.exec(value))) {
    const close = `</metis_attachment:${match[2]}>`;
    const closeIndex = value.indexOf(close, openPattern.lastIndex);
    if (closeIndex < 0) break;
    visible.push(value.slice(cursor, match.index));
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<MessageAttachment>;
      if (parsed.id && parsed.kind && parsed.name) {
        attachments.push({
          id: parsed.id,
          kind: parsed.kind,
          name: parsed.name,
          sizeText: parsed.sizeText || '',
          ...(parsed.mimeType ? { mimeType: parsed.mimeType } : {}),
          ...(parsed.path ? { path: parsed.path } : {}),
        });
      }
    } catch {}
    cursor = closeIndex + close.length;
    openPattern.lastIndex = cursor;
  }
  visible.push(value.slice(cursor));
  return { text: visible.join('').trim(), attachments };
}

export function extractImageAttachments(content: unknown): MessageAttachment[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part, index): MessageAttachment[] => {
    if (!part || typeof part !== 'object') return [];
    const value = part as {
      type?: unknown;
      data?: unknown;
      mimeType?: unknown;
      image?: { data?: unknown; mimeType?: unknown };
    };
    if (value.type !== 'image') return [];
    const data = typeof value.data === 'string' ? value.data : value.image?.data;
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : value.image?.mimeType;
    if (typeof data !== 'string' || typeof mimeType !== 'string') return [];
    return [{
      id: `image-${index}`,
      kind: 'image',
      name: `Image ${index + 1}`,
      sizeText: '',
      mimeType,
      data,
      previewUrl: `data:${mimeType};base64,${data}`,
    }];
  });
}
