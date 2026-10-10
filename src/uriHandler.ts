import * as path from 'path';
import * as vscode from 'vscode';
import { Tours } from './tours';

export type UriRequest = { action: 'open'; file: string } | { error: string };

/** Parses the path and (already decoded) query of a vscode://martindotts.minuet/... URI. */
export function parseUriRequest(uriPath: string, query: string): UriRequest {
  const action = uriPath.replace(/^\/+|\/+$/g, '');
  if (action !== 'open') {
    return { error: `unknown action in the URI: "${action || '(empty)'}". The only action is "open".` };
  }
  const file = new URLSearchParams(query).get('file');
  if (!file || !path.isAbsolute(file)) {
    return {
      error:
        'the open URI needs "file" with the absolute path of the tour (for example ?file=%2Frepo%2F.minuet%2Fx.tour.json).',
    };
  }
  return { action: 'open', file };
}

/**
 * Lets agents (or links) drive the extension through vscode:// URIs:
 *
 *   vscode://martindotts.minuet/open?file=<absolute path, URL-encoded>
 *
 * Opens the tour, copying it into the tours folder when it is elsewhere. Every request is confirmed by
 * the user before anything changes.
 */
export class MinuetUriHandler implements vscode.UriHandler {
  constructor(private readonly tours: Tours) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const request = parseUriRequest(uri.path, uri.query);
    if ('error' in request) {
      void vscode.window.showErrorMessage(`minuet: ${request.error}`);
      return;
    }
    await this.tours.open(vscode.Uri.file(request.file), { external: true });
  }
}
