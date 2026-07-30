import { useEffect, useState } from 'react';
import { GroupEditor } from './GroupEditor';
import { PackEditor } from './PackEditor';

interface ProcessPacksWorkspaceProps {
  initialSection?: 'processes' | 'packs';
  initialProcessFile?: string;
  initialPackFile?: string;
  onProcessFileChange: (file: string) => void;
  onPackFileChange: (file: string) => void;
  onSectionChange: (section: 'processes' | 'packs') => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ProcessPacksWorkspace({
  initialSection = 'processes',
  initialProcessFile,
  initialPackFile,
  onProcessFileChange,
  onPackFileChange,
  onSectionChange,
  onDirtyChange,
}: ProcessPacksWorkspaceProps) {
  const [section, setSection] = useState(initialSection);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  function changeSection(next: 'processes' | 'packs') {
    if (next === section) return;
    if (dirty && !window.confirm('You have unsaved changes. Discard them and switch artifact type?')) return;
    setDirty(false);
    setSection(next);
    onSectionChange(next);
  }

  function handleDirty(next: boolean) {
    setDirty(next);
    onDirtyChange?.(next);
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="segmented-control" role="tablist" aria-label="Process and Pack artifact types">
          <button type="button" role="tab" aria-selected={section === 'processes'} className={section === 'processes' ? 'active' : ''} onClick={() => changeSection('processes')}>
            Business Processes
          </button>
          <button type="button" role="tab" aria-selected={section === 'packs'} className={section === 'packs' ? 'active' : ''} onClick={() => changeSection('packs')}>
            Regression Packs
          </button>
        </div>
        <p className="hint">
          {section === 'processes'
            ? 'A Business Process sequences Tests and carries outputs forward between stages.'
            : 'A Regression Pack runs independent Tests or Business Processes with member-specific bindings.'}
        </p>
      </div>
      {section === 'processes' ? (
        <GroupEditor initialFile={initialProcessFile} onSelectedFileChange={onProcessFileChange} onDirtyChange={handleDirty} />
      ) : (
        <PackEditor initialFile={initialPackFile} onSelectedFileChange={onPackFileChange} onDirtyChange={handleDirty} />
      )}
    </div>
  );
}
