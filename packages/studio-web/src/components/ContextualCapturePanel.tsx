import { X } from 'lucide-react';
import type { CaptureRequest } from '../types';
import { ObjectScanner } from './ObjectScanner';

/**
 * Lets a Compose field launch a live-screen capture session without leaving Compose or
 * losing in-progress, possibly-unsaved Test edits (BL-023 AC4). This is an app-level
 * overlay rendered as a sibling of the active view — like SettingsPanel — not a route
 * change, so it never touches the dirty-navigation guard in App.tsx. It closes itself
 * once the tester saves an object and clicks "Use for <field>" in CurationList, which
 * fills the originating field via request.onCaptured before this panel is torn down.
 */
export function ContextualCapturePanel({ request, onClose }: { request: CaptureRequest; onClose: () => void }) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section className="capture-panel" role="dialog" aria-modal="true" aria-labelledby="capture-panel-title">
        <header className="settings-header">
          <div>
            <span className="canvas-eyebrow">Capture a new object</span>
            <h2 id="capture-panel-title">For: {request.fieldLabel}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close capture and return to Compose without a change">
            <X size={18} />
          </button>
        </header>
        <div className="capture-content">
          <ObjectScanner
            captureTarget={{
              appId: request.appId,
              fieldLabel: request.fieldLabel,
              onUse: (name) => {
                request.onCaptured(name);
                onClose();
              },
            }}
          />
        </div>
      </section>
    </div>
  );
}
