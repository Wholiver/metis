import React from 'react';
import { FileCode2, GitBranch } from 'lucide-react';
import { useI18n } from '../../i18n';

export function ReviewEmptyNoGit({
  pending,
  onInitGit,
}: {
  pending: boolean;
  onInitGit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div data-slot="session-review-v2-empty-no-git">
      <FileCode2 size={20} strokeWidth={1.7} className="text-ink-3" aria-hidden="true" />
      <div data-slot="session-review-v2-empty-no-git-title">
        {t('reviewEmptyNoGitTitle')}
      </div>
      <div data-slot="session-review-v2-empty-no-git-description">
        {t('reviewEmptyNoGitDescription')}
      </div>
      <button
        type="button"
        data-review-init-git=""
        disabled={pending}
        onClick={onInitGit}
      >
        {pending ? t('reviewEmptyNoGitActionLoading') : t('reviewEmptyNoGitAction')}
      </button>
    </div>
  );
}

export function ReviewEmptyChanges() {
  const { t } = useI18n();
  return (
    <div data-slot="session-review-v2-empty-changes">
      <GitBranch size={22} strokeWidth={1.7} className="text-ink-3" aria-hidden="true" />
      <div data-slot="session-review-v2-empty-changes-title">
        {t('reviewEmptyChangesTitle')}
      </div>
      <div data-slot="session-review-v2-empty-changes-description">
        {t('reviewEmptyChangesDescription')}
      </div>
    </div>
  );
}
