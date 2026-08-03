/**
 * Tracks the in-flight parse request so other screens (e.g. ParsingScreen's
 * Cancel button) can abort it without prop drilling an AbortController.
 */

let activeController: AbortController | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToParseActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isParseActive() {
  return activeController !== null;
}

export function beginParse(): AbortController | null {
  // A parse is a workspace-wide resource. Ignore duplicate UI submissions
  // rather than cancelling work that the user explicitly started.
  if (activeController) return null;
  activeController = new AbortController();
  notify();
  return activeController;
}

export function endParse(controller: AbortController) {
  if (activeController === controller) {
    activeController = null;
    notify();
  }
}

export function cancelActiveParse() {
  activeController?.abort();
  activeController = null;
  notify();
}
