import * as vscode from 'vscode';
import { StopController } from '../debug/stopController';
import { Tours } from '../tours/tours';
import { ToursView } from './toursView';

/** Lets VS Code switch the sidebar first, then switches it back. */
const AFTER_VS_CODE_MS = 300;

/**
 * VS Code shows Run and Debug when a debug session starts (and on every break with
 * `debug.openDebug: openOnDebugBreak`). While a tour is open, go back to minuet's sidebar, where Current
 * Step shows the step and its values. The focus stays where it was (editor, terminal).
 */
export function stayInMinuet(tours: Tours, stops: StopController, view: ToursView): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const back = (): void => {
    if (!tours.activeFile) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => view.showOpenTour(), AFTER_VS_CODE_MS);
  };
  return vscode.Disposable.from(
    vscode.debug.onDidStartDebugSession(back),
    stops.onDidChange((stop) => {
      if (stop && vscode.workspace.getConfiguration('debug').get<string>('openDebug') === 'openOnDebugBreak') {
        back();
      }
    }),
    { dispose: () => clearTimeout(timer) },
  );
}
