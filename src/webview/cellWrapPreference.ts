let cellWrapEnabled = true;

export function getCellWrapEnabled(): boolean {
  return cellWrapEnabled;
}

export function setCellWrapEnabledPreference(enabled: boolean): void {
  cellWrapEnabled = enabled;
}
