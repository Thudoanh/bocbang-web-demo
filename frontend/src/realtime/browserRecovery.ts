/** Keep one recovery deadline across unrelated live transcript updates. */
export class BrowserRecoveryScheduler {
  private key?: string;
  private timer?: ReturnType<typeof setTimeout>;

  schedule(key: string, delay: number, run: () => void) {
    if (this.key === key) return;
    this.cancel();
    this.key = key;
    this.timer = setTimeout(() => {
      this.key = undefined;
      this.timer = undefined;
      run();
    }, delay);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.key = undefined;
  }
}
