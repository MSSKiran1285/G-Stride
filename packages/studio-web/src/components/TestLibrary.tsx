import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileCode2, Plus, Search } from 'lucide-react';
import { api } from '../api';
import type { CaptureRequest, TestApplication, TestCase, TestLibraryItem, TestLibraryStatus } from '../types';
import { TestCaseEditor } from './TestCaseEditor';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';

const APPLICATIONS: TestApplication[] = ['SAP', 'Salesforce', 'Oracle', 'ServiceNow'];

function fileStem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function statusLabel(status: TestLibraryStatus): string {
  return status === 'published' ? 'Published' : status === 'ready' ? 'Legacy ready' : 'Draft';
}

interface TestLibraryProps {
  initialFile?: string;
  onSelectedFileChange: (file?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRequestCapture?: (request: CaptureRequest) => void;
}

export function TestLibrary({ initialFile, onSelectedFileChange, onDirtyChange, onRequestCapture }: TestLibraryProps) {
  const [items, setItems] = useState<TestLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [application, setApplication] = useState<TestApplication>('SAP');
  const [processArea, setProcessArea] = useState('');
  const [startingPoint, setStartingPoint] = useState<'blank' | 'template'>('blank');
  const [templateFile, setTemplateFile] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [applicationFilter, setApplicationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  function loadLibrary() {
    setLoading(true);
    api.listTestLibrary()
      .then((next) => {
        setItems(next);
        setError(null);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }

  useEffect(loadLibrary, []);

  useEffect(() => {
    if (!initialFile) onDirtyChange?.(false);
  }, [initialFile, onDirtyChange]);

  const processAreas = useMemo(
    () => Array.from(new Set(items.map((item) => item.processArea).filter(Boolean))).sort(),
    [items],
  );
  const templateItems = useMemo(() => items.filter((item) => item.status !== 'draft'), [items]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query || `${item.name} ${item.file}`.toLowerCase().includes(query);
      const matchesArea = areaFilter === 'all' || (areaFilter === 'untagged' ? !item.processArea : item.processArea === areaFilter);
      const matchesApplication = applicationFilter === 'all' || item.application === applicationFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesArea && matchesApplication && matchesStatus;
    });
  }, [applicationFilter, areaFilter, items, search, statusFilter]);

  function updateBusinessName(value: string) {
    setBusinessName(value);
    if (!fileNameEdited) setFileName(fileStem(value));
  }

  function resetCreation() {
    setBusinessName('');
    setFileName('');
    setFileNameEdited(false);
    setApplication('SAP');
    setProcessArea('');
    setStartingPoint('blank');
    setTemplateFile('');
    setShowCreate(false);
    setError(null);
  }

  async function createTest(event: React.FormEvent) {
    event.preventDefault();
    const stem = fileStem(fileName || businessName);
    if (!businessName.trim() || !stem) {
      setError('Enter a business name and a valid file name.');
      return;
    }
    if (startingPoint === 'template' && !templateFile) {
      setError('Choose an existing Test to use as the template.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      let source: TestCase | null = null;
      if (startingPoint === 'template') source = await api.getTestCase(templateFile);
      const next: TestCase = {
        name: businessName.trim(),
        application,
        version: 1,
        lifecycle: 'draft',
        steps: source ? structuredClone(source.steps) : [],
        contract: source?.contract ? structuredClone(source.contract) : { version: 1, inputs: [], outputs: [] },
      };
      const file = `${stem}.json`;
      await api.createTestCase(file, next, processArea.trim());
      resetCreation();
      onSelectedFileChange(file);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreating(false);
    }
  }

  if (initialFile) {
    return (
      <div className="stack test-detail-workspace">
        <div className="workspace-subheader">
          <button type="button" className="ghost" onClick={() => onSelectedFileChange(undefined)}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to Test Library
          </button>
          <span className="hint">Stable route · {initialFile}</span>
        </div>
        <TestCaseEditor
          initialFile={initialFile}
          onSelectedFileChange={(file) => onSelectedFileChange(file)}
          onDirtyChange={onDirtyChange}
          showLibraryControls={false}
          onRequestCapture={onRequestCapture}
        />
      </div>
    );
  }

  return (
    <div className="stack test-library-workspace">
      <section className="workspace-intro-row" aria-labelledby="testLibraryHeading">
        <div>
          <span className="eyebrow">Reusable automation assets</span>
          <h2 id="testLibraryHeading">Test Library</h2>
          <p className="hint">Find a Test by business meaning, application, process area or readiness.</p>
        </div>
        <button type="button" className="primary" onClick={() => setShowCreate((current) => !current)} aria-expanded={showCreate}>
          <Plus size={16} aria-hidden="true" /> New Test
        </button>
      </section>

      {showCreate && (
        <form className="panel stack test-create-panel" onSubmit={createTest} aria-labelledby="newTestHeading">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Guided creation</p>
              <h3 id="newTestHeading">Create a reusable Test</h3>
            </div>
            <button type="button" className="ghost" onClick={resetCreation}>Cancel</button>
          </div>
          <div className="test-create-grid">
            <div>
              <label htmlFor="new-test-business-name">Business name</label>
              <input id="new-test-business-name" value={businessName} onChange={(event) => updateBusinessName(event.target.value)} placeholder="Create purchase order" autoFocus />
            </div>
            <div>
              <label htmlFor="new-test-file-name">File name</label>
              <div className="input-suffix">
                <input id="new-test-file-name" value={fileName} onChange={(event) => { setFileName(event.target.value); setFileNameEdited(true); }} placeholder="create-purchase-order" />
                <span>.json</span>
              </div>
            </div>
            <div>
              <label htmlFor="new-test-application">Test application</label>
              <select id="new-test-application" value={application} onChange={(event) => setApplication(event.target.value as TestApplication)}>
                {APPLICATIONS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="new-test-process-area">Test process area</label>
              <input id="new-test-process-area" list="test-process-areas" value={processArea} onChange={(event) => setProcessArea(event.target.value)} placeholder="e.g. Procurement" />
              <datalist id="test-process-areas">{processAreas.map((value) => <option key={value} value={value} />)}</datalist>
            </div>
            <div>
              <label htmlFor="new-test-starting-point">Starting point</label>
              <select id="new-test-starting-point" value={startingPoint} onChange={(event) => setStartingPoint(event.target.value as 'blank' | 'template')}>
                <option value="blank">Blank Test</option>
                <option value="template">Copy an existing Test</option>
              </select>
            </div>
            {startingPoint === 'template' && (
              <div>
                <label htmlFor="new-test-template">Template Test</label>
                <select id="new-test-template" value={templateFile} onChange={(event) => setTemplateFile(event.target.value)}>
                  <option value="">— choose a ready Test —</option>
                  {templateItems.map((item) => <option key={item.file} value={item.file}>{item.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="row">
            <button type="submit" className="primary" disabled={creating}>{creating ? 'Creating…' : 'Create Test'}</button>
            <span className="hint">Creation persists the initial Test and opens its stable route.</span>
          </div>
        </form>
      )}

      {error && <AsyncFeedback state="error" message={error} />}
      {loading && <AsyncFeedback state="loading" message="Loading Test Library…" />}

      <section className="panel stack" aria-label="Test Library filters and results">
        <div className="test-library-filters">
          <div className="test-library-search">
            <label htmlFor="test-library-search">Search</label>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input id="test-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or file" />
            </div>
          </div>
          <div>
            <label htmlFor="test-library-area">Filter by process area</label>
            <select id="test-library-area" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
              <option value="all">All process areas</option>
              {processAreas.map((value) => <option key={value} value={value}>{value}</option>)}
              <option value="untagged">Untagged</option>
            </select>
          </div>
          <div>
            <label htmlFor="test-library-application">Filter by application</label>
            <select id="test-library-application" value={applicationFilter} onChange={(event) => setApplicationFilter(event.target.value)}>
              <option value="all">All applications</option>
              {APPLICATIONS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="test-library-status">Filter by status</label>
            <select id="test-library-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="ready">Ready</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        </div>

        <div className="test-library-result-summary" role="status" aria-live="polite">
          <strong>{filtered.length}</strong> of {items.length} Tests
        </div>

        <TableFrame label="Test Library results">
          <table className="responsive-table test-library-table">
            <thead>
              <tr><th>Test</th><th>Process area</th><th>Application</th><th>Steps</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.file}>
                  <td data-label="Test">
                    <strong>{item.name}</strong>
                    <span className="test-library-file"><FileCode2 size={13} aria-hidden="true" /> {item.file}</span>
                  </td>
                  <td data-label="Process area">{item.processArea || <span className="hint">Untagged</span>}</td>
                  <td data-label="Application">{item.application}</td>
                  <td data-label="Steps">{item.stepCount}</td>
                  <td data-label="Status"><span className={`badge ${item.status === 'published' ? 'passed' : 'running'}`}>{statusLabel(item.status)}</span></td>
                  <td data-label="Actions"><button type="button" className="ghost" onClick={() => onSelectedFileChange(item.file)}>Open Test</button></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-table-state">No Tests match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>
    </div>
  );
}
