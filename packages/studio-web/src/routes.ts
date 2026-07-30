export type WorkspaceView = 'launchpad' | 'objects' | 'editor' | 'data' | 'groups' | 'run' | 'documents';

export interface StudioRoute {
  view: WorkspaceView;
  path: string;
  testFile?: string;
  dataFile?: string;
  processFile?: string;
  objectAppId?: string;
  objectName?: string;
  runId?: string;
  auditRunId?: string;
}

export const VIEW_PATHS: Record<WorkspaceView, string> = {
  launchpad: '/',
  objects: '/objects',
  editor: '/compose',
  data: '/data',
  groups: '/process-suites',
  run: '/execute/new',
  documents: '/audit-evidence',
};

function decode(segment: string | undefined): string | undefined {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function parseStudioRoute(pathname: string): StudioRoute {
  let match = pathname.match(/^\/compose\/tests\/([^/]+)\/?$/);
  if (match) return { view: 'editor', path: pathname, testFile: decode(match[1]) };

  match = pathname.match(/^\/data\/([^/]+)\/?$/);
  if (match) return { view: 'data', path: pathname, dataFile: decode(match[1]) };

  match = pathname.match(/^\/process-suites\/([^/]+)\/?$/);
  if (match) return { view: 'groups', path: pathname, processFile: decode(match[1]) };

  match = pathname.match(/^\/objects\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (match) {
    return {
      view: 'objects',
      path: pathname,
      objectAppId: decode(match[1]),
      objectName: decode(match[2]),
    };
  }

  match = pathname.match(/^\/execute\/runs\/([^/]+)\/?$/);
  if (match) return { view: 'run', path: pathname, runId: decode(match[1]) };

  match = pathname.match(/^\/audit\/runs\/([^/]+)\/?$/);
  if (match) return { view: 'documents', path: pathname, auditRunId: decode(match[1]) };

  const view = (Object.entries(VIEW_PATHS).find(([, route]) => route === pathname)?.[0] as WorkspaceView | undefined)
    ?? 'launchpad';
  return { view, path: VIEW_PATHS[view] };
}

const encoded = (value: string) => encodeURIComponent(value);

export const studioRoutes = {
  test: (file: string) => `/compose/tests/${encoded(file)}`,
  data: (file: string) => `/data/${encoded(file)}`,
  process: (file: string) => `/process-suites/${encoded(file)}`,
  object: (appId: string, name?: string) =>
    `/objects/${encoded(appId)}${name ? `/${encoded(name)}` : ''}`,
  run: (runId: string) => `/execute/runs/${encoded(runId)}`,
  auditRun: (runId: string) => `/audit/runs/${encoded(runId)}`,
};
