/** Lines that systems contribute to the debug panel. Providers are polled at panel refresh rate only. */
export class DebugInfo {
  readonly lines = new Map<string, () => string>();

  set(key: string, provider: () => string): void {
    this.lines.set(key, provider);
  }

  delete(key: string): void {
    this.lines.delete(key);
  }
}
