import * as vscode from 'vscode';
import { MinuetUriHandler } from './agents/uriHandler';
import { registerCommands } from './commands';
import { BreakpointSync } from './debug/breakpointSync';
import { StopController } from './debug/stopController';
import { StaleTracker } from './tours/staleTracker';
import { StepStore } from './tours/stepStore';
import { Tours } from './tours/tours';
import { StepCodeLensProvider } from './views/codeLens';
import { CurrentStepView } from './views/currentStep/currentStepView';
import { StepDecorations } from './views/decorations';
import { StepSelection } from './views/selection';
import { StepPage } from './views/stepPage';
import { ToursView } from './views/toursView';

/** Returned from activate(); used by the integration tests. */
export interface MinuetApi {
  store: StepStore;
  staleTracker: StaleTracker;
  stops: StopController;
  selection: StepSelection;
  currentStepView: CurrentStepView;
  decorations: StepDecorations;
  tours: Tours;
  page: StepPage;
}

export async function activate(context: vscode.ExtensionContext): Promise<MinuetApi> {
  const store = new StepStore();
  const staleTracker = new StaleTracker(store);
  const tours = new Tours(context.workspaceState, store, staleTracker);
  const breakpointSync = new BreakpointSync(store, async () => {
    await tours.close();
    void vscode.window.showInformationMessage('All the breakpoints of the tour were removed, so it was closed. Its file is kept.');
  });
  const stops = new StopController(store);
  const selection = new StepSelection(store, stops);
  const decorations = new StepDecorations(store, stops, selection);
  const toursView = new ToursView(tours, store, staleTracker, stops, selection);
  const page = new StepPage(store, tours, stops, selection);
  const currentStepView = new CurrentStepView(context.extensionUri, store, staleTracker, stops, selection, tours, page);
  const codeLens = new StepCodeLensProvider(store, staleTracker);

  context.subscriptions.push(
    store,
    tours,
    breakpointSync,
    staleTracker,
    stops,
    selection,
    decorations,
    toursView,
    page,
    currentStepView,
    codeLens,
    vscode.window.registerUriHandler(new MinuetUriHandler(tours)),
    ...registerCommands({ extensionUri: context.extensionUri, store, staleTracker, stops, selection, currentStepView, tours, page }),
  );

  // The open tour must be loaded before the breakpoints are reconciled with it.
  await tours.restore();
  breakpointSync.start();
  return { store, staleTracker, stops, selection, currentStepView, decorations, tours, page };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
