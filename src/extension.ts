import * as vscode from 'vscode';
import { BreakpointSync } from './breakpointSync';
import { StepCodeLensProvider } from './codeLens';
import { CONTEXT_SCHEME, contextContentProvider, registerCommands } from './commands';
import { StepDecorations } from './decorations';
import { StepSelection } from './selection';
import { StepPage } from './stepPage';
import { StaleTracker } from './staleTracker';
import { StepView } from './stepView';
import { StopController } from './stopController';
import { AnnotationStore } from './store';
import { Tours, ToursView } from './tours';
import { TourView } from './tourView';
import { MinuetUriHandler } from './uriHandler';

/** Returned from activate(); used by the integration tests. */
export interface MinuetApi {
  store: AnnotationStore;
  staleTracker: StaleTracker;
  stops: StopController;
  selection: StepSelection;
  stepView: StepView;
  decorations: StepDecorations;
  tours: Tours;
  page: StepPage;
}

export async function activate(context: vscode.ExtensionContext): Promise<MinuetApi> {
  const store = new AnnotationStore();
  const staleTracker = new StaleTracker(store);
  const tours = new Tours(context.workspaceState, store, staleTracker);
  const breakpointSync = new BreakpointSync(store, async () => {
    await tours.close();
    void vscode.window.showInformationMessage('All the breakpoints of the tour were removed, so it was closed. Its file is kept.');
  });
  const stops = new StopController(store);
  const selection = new StepSelection(store, stops);
  const decorations = new StepDecorations(store, stops, selection);
  const toursView = new ToursView(tours);
  const tourView = new TourView(store, staleTracker, stops, selection, {
    isOpen: () => tours.activeFile !== undefined,
    onDidChange: tours.onDidChange,
  });
  const page = new StepPage(store, tours, stops, selection);
  const stepView = new StepView(context.extensionUri, store, staleTracker, stops, selection, tours, page);
  const codeLens = new StepCodeLensProvider(store, staleTracker);
  const contextProvider = contextContentProvider(store);

  context.subscriptions.push(
    store,
    tours,
    breakpointSync,
    staleTracker,
    stops,
    selection,
    decorations,
    toursView,
    tourView,
    page,
    stepView,
    codeLens,
    contextProvider,
    vscode.workspace.registerTextDocumentContentProvider(CONTEXT_SCHEME, contextProvider),
    vscode.window.registerUriHandler(new MinuetUriHandler(tours)),
    ...registerCommands({ extensionUri: context.extensionUri, store, staleTracker, stops, selection, stepView, tours, page }),
  );

  // The open tour must be loaded before the breakpoints are reconciled with it.
  await tours.restore();
  breakpointSync.start();
  return { store, staleTracker, stops, selection, stepView, decorations, tours, page };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
