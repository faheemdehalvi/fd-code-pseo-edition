const OPEN_EVENT = "fdcode:open-pseo";

export function openPseoWorkspace(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenPseoWorkspace(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
