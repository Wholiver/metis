import React, { useMemo } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { DiffRow } from '../primitives/CodeBlock';
import CodeBlock from '../primitives/CodeBlock';
import { parseUnifiedDiff } from '../../lib/review-diff';

export function ReviewDiffPreview({
  file,
  patch,
  rows: rowsProp,
  loading,
}: {
  file?: string | null;
  patch?: string;
  rows?: DiffRow[];
  loading?: boolean;
}) {
  const { t } = useI18n();
  const parsedRows = useMemo(() => {
    if (rowsProp && rowsProp.length > 0) return rowsProp;
    return patch ? parseUnifiedDiff(patch) : [];
  }, [rowsProp, patch]);
  const name = file?.split(/[\\/]/).filter(Boolean).at(-1) || file || '';
  const code = useMemo(
    () => parsedRows.map((row) => row.pieces.map((piece) => piece.text).join('')).join('\n'),
    [parsedRows],
  );
  const added = parsedRows.filter((row) => row.type === 'add').length;
  const removed = parsedRows.filter((row) => row.type === 'del').length;

  if (!file) {
    return (
      <div data-slot="session-review-v2-empty" className="text-[13px] text-ink-3">
        {t('chooseFileForDiff')}
      </div>
    );
  }

  return (
    <div data-slot="session-review-v2-preview" className="h-full min-h-0">
      <div data-slot="session-review-v2-toolbar">
        <div data-slot="session-review-v2-toolbar-title" title={file}>{name}</div>
        {(added > 0 || removed > 0) && (
          <span data-slot="session-review-v2-stats" aria-label={`+${added} -${removed}`}>
            {added > 0 && <span data-add="">+{added}</span>}
            {removed > 0 && <span data-del="">-{removed}</span>}
          </span>
        )}
      </div>
      <div data-slot="session-review-v2-preview-scroll" data-review-diff-flush="">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] py-16 text-center px-4 text-ink-3">
            <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
            <p className="text-[12px] text-ink-3">{t('reviewLoadingChanges')}</p>
          </div>
        ) : parsedRows.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-ink-3">{t('waitingForFile')}</p>
        ) : (
          <CodeBlock
            variant="Diff"
            flush
            filename={name}
            code={code}
            diff={parsedRows}
            labels={{ copy: t('copy'), copied: t('copied') }}
          />
        )}
      </div>
    </div>
  );
}
