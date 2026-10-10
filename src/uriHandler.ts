import * as path from 'path';
import * as vscode from 'vscode';
import { importTour } from './importExport';
import { StaleTracker } from './staleTracker';
import { AnnotationStore } from './store';

export type UriRequest = { action: 'import'; file: string } | { error: string };

/** Parses the path and (already decoded) query of a vscode://martindotts.stepwise/... URI. */
export function parseUriRequest(uriPath: string, query: string): UriRequest {
  const action = uriPath.replace(/^\/+|\/+$/g, '');
  if (action !== 'import') {
    return { error: `unknown action in the URI: "${action || '(empty)'}". The only action is "import".` };
  }
  const file = new URLSearchParams(query).get('file');
  if (!file || !path.isAbsolute(file)) {
    return {
      error:
        'the import URI needs "file" with the absolute path of the tour (for example ?file=%2Ftmp%2Ftour.json).',
    };
  }
  return { action: 'import', file };
}

/**
 * Lets agents (or links) drive the extension through vscode:// URIs:
 *
 *   vscode://martindotts.stepwise/import?file=<absolute path, URL-encoded>
 *
 * Every request is confirmed by the user before anything changes.
 */
export class StepwiseUriHandler implements vscode.UriHandler {
  constructor(
    private readonly store: AnnotationStore,
    private readonly staleTracker: StaleTracker,
  ) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const request = parseUriRequest(uri.path, uri.query);
    if ('error' in request) {
      void vscode.window.showErrorMessage(`Stepwise: ${request.error}`);
      return;
    }
    await importTour(this.store, this.staleTracker, vscode.Uri.file(request.file), { external: true });
  }
}
