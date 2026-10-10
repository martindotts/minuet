import * as vscode from 'vscode';
import { BreakpointSync } from './breakpointSync';
import { StepCodeLensProvider } from './codeLens';
import { CONTEXT_SCHEME, contextContentProvider, registerCommands } from './commands';
import { StepDecorations } from './decorations';
import { StepSelection } from './selection';
import { StaleTracker } from './staleTracker';
import { StepView } from './stepView';
import { StopController } from './stopController';
import { AnnotationStore } from './store';
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
}

export function activate(context: vscode.ExtensionContext): MinuetApi {
  const store = new AnnotationStore(context.workspaceState);
  const breakpointSync = new BreakpointSync(store);
  const staleTracker = new StaleTracker(store);
  const stops = new StopController(store);
  const selection = new StepSelection(store, stops);
  const decorations = new StepDecorations(store, stops, selection);
  const tourView = new TourView(store, staleTracker, stops, selection);
  const stepView = new StepView(context.extensionUri, store, staleTracker, stops, selection);
  const codeLens = new StepCodeLensProvider(store, staleTracker);
  const contextProvider = contextContentProvider(store);

  context.subscriptions.push(
    store,
    breakpointSync,
    staleTracker,
    stops,
    selection,
    decorations,
    tourView,
    stepView,
    codeLens,
    contextProvider,
    vscode.workspace.registerTextDocumentContentProvider(CONTEXT_SCHEME, contextProvider),
    vscode.window.registerUriHandler(new MinuetUriHandler(store, staleTracker)),
    ...registerCommands({ extensionUri: context.extensionUri, store, staleTracker, stops, selection, stepView }),
  );

  breakpointSync.start();
  return { store, staleTracker, stops, selection, stepView, decorations };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
