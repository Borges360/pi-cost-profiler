import { Input, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';

export interface PanelChoice { value: string; label: string }
export interface PanelApi {
  input(title: string, value: string): Promise<string | undefined>;
  choose(title: string, choices: PanelChoice[], current?: string): Promise<string | undefined>;
  confirm(title: string): Promise<boolean>;
  report(message: string): void;
  close(action?: string): void;
}
export interface PanelRow {
  id: string; label: string; value(): string; description: string;
  activate(panel: PanelApi, signal: AbortSignal): Promise<void> | void;
}
export interface PanelShellText {
  back: string; authorize: string; canceled: string; failed: string;
  canceling: string; working: string; unsaved: string; chooseHelp: string; mainHelp: string;
}
export interface PanelOptions {
  title: string | (() => string); summary(): string; rows: PanelRow[]; dirty(): boolean; signal: AbortSignal;
  save(panel: PanelApi, signal: AbortSignal): Promise<void>;
  formatError?(error: unknown): string;
  shell?: () => PanelShellText;
}
type Factory = Parameters<ExtensionUIContext['custom']>[0];
type Keys = Parameters<Factory>[2];
type Theme = ExtensionUIContext['theme'];
const safe = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const DEFAULT_SHELL: PanelShellText = Object.freeze({
  back: 'Back', authorize: 'Authorize', canceled: 'Operation canceled.',
  failed: 'Operation failed. Try again.', canceling: 'Canceling…',
  working: 'Working… Esc cancels the operation.',
  unsaved: 'Unsaved changes. Ctrl+S saves; press Esc again to discard.',
  chooseHelp: '↑↓ choose · Enter confirm · Esc back',
  mainHelp: '↑↓ navigate · Enter edit/open · Ctrl+S save · Esc close',
});

/** Reusable Pi settings shell: draft, explicit commit, inline dialogs and scoped cleanup. */
export class SettingsPanel implements Component, PanelApi {
  private selected = 0;
  private status = '';
  private busy?: AbortController;
  private closed = false;
  private discardPending = false;
  private saveAfterEdit = false;
  private pending?: Promise<void>;
  private dialog?: { title: string; input?: Input; choices?: PanelChoice[]; selected: number; resolve(value?: string): void };
  focused = true;
  private readonly abort = () => this.close();
  private shell(key: keyof PanelShellText) { return this.options.shell?.()[key] ?? DEFAULT_SHELL[key]; }
  constructor(private readonly options: PanelOptions, private readonly theme: Theme, private readonly keys: Keys,
    private readonly renderRequest: () => void, private readonly done: (action?: string) => void, private readonly rowsAvailable = () => 24) {
    options.signal.addEventListener('abort', this.abort, { once: true });
    if (options.signal.aborted) this.close();
  }
  invalidate() {}
  dispose() {
    this.closed = true; this.busy?.abort();
    this.dialog?.resolve(undefined); this.dialog = undefined;
    this.options.signal.removeEventListener('abort', this.abort);
  }
  close(action?: string) { if (this.closed) return; this.dispose(); this.done(action); }
  report(message: string) { if (!this.closed && !this.busy?.signal.aborted) { this.status = message; this.renderRequest(); } }
  input(title: string, value: string): Promise<string | undefined> {
    if (this.closed || this.busy?.signal.aborted) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const input = new Input();
      // Native paste initializes the caret at the end; setValue() preserves its old position (zero).
      input.handleInput(`\x1b[200~${safe(value)}\x1b[201~`); input.focused = true;
      this.dialog = { title, input, selected: 0, resolve }; this.renderRequest();
    });
  }
  choose(title: string, choices: PanelChoice[], current?: string): Promise<string | undefined> {
    if (this.closed || this.busy?.signal.aborted || !choices.length) return Promise.resolve(undefined);
    return new Promise(resolve => {
      this.dialog = { title, choices, selected: Math.max(0, choices.findIndex(c => c.value === current)), resolve }; this.renderRequest();
    });
  }
  async confirm(title: string) {
    return await this.choose(title, [{ value: 'no', label: this.shell('back') }, { value: 'yes', label: this.shell('authorize') }]) === 'yes';
  }
  async drain() { while (this.pending) await this.pending; }
  private run(work: (signal: AbortSignal) => Promise<void> | void) {
    if (this.busy || this.closed) return;
    const task = this.execute(work); this.pending = task;
    void task.finally(() => { if (this.pending === task) this.pending = undefined; });
  }
  private async execute(work: (signal: AbortSignal) => Promise<void> | void) {
    if (this.busy || this.closed) return;
    const abort = new AbortController(); this.busy = abort; this.discardPending = false;
    try { await work(abort.signal); }
    catch (error) { this.report(abort.signal.aborted ? this.shell('canceled') : this.options.formatError?.(error) ?? this.shell('failed')); }
    finally {
      this.busy = undefined;
      if (!this.closed) {
        if (abort.signal.aborted) this.status = this.shell('canceled');
        this.renderRequest();
        if (this.saveAfterEdit) { this.saveAfterEdit = false; void this.run(signal => this.options.save(this, signal)); }
      }
    }
  }
  handleInput(data: string) {
    if (this.closed) return;
    const dialog = this.dialog;
    const cancel = this.keys.matches(data, 'tui.select.cancel') || matchesKey(data, 'ctrl+c');
    if (dialog) {
      if (cancel) { this.dialog = undefined; dialog.resolve(undefined); this.renderRequest(); return; }
      if (dialog.input) {
        if (this.keys.matches(data, 'tui.select.confirm') || matchesKey(data, 'ctrl+s')) {
          this.saveAfterEdit = matchesKey(data, 'ctrl+s');
          this.dialog = undefined; dialog.resolve(dialog.input.getValue()); this.renderRequest();
        } else { dialog.input.handleInput(data); this.renderRequest(); }
      } else {
        const length = dialog.choices!.length;
        if (this.keys.matches(data, 'tui.select.up')) dialog.selected = (dialog.selected + length - 1) % length;
        if (this.keys.matches(data, 'tui.select.down')) dialog.selected = (dialog.selected + 1) % length;
        if (this.keys.matches(data, 'tui.select.confirm')) { this.dialog = undefined; dialog.resolve(dialog.choices![dialog.selected]!.value); }
        this.renderRequest();
      }
      return;
    }
    if (this.busy) { if (cancel) { this.busy.abort(); this.status = this.shell('canceling'); this.renderRequest(); } return; }
    if (matchesKey(data, 'ctrl+s')) { void this.run(signal => this.options.save(this, signal)); return; }
    if (cancel) {
      if (this.options.dirty() && !this.discardPending) { this.discardPending = true; this.report(this.shell('unsaved')); }
      else this.close();
      return;
    }
    this.discardPending = false;
    if (this.keys.matches(data, 'tui.select.up')) this.selected = (this.selected + this.options.rows.length - 1) % this.options.rows.length;
    else if (this.keys.matches(data, 'tui.select.down')) this.selected = (this.selected + 1) % this.options.rows.length;
    else if (this.keys.matches(data, 'tui.select.confirm')) {
      const row = this.options.rows[this.selected]; if (row) void this.run(signal => row.activate(this, signal));
    }
    this.renderRequest();
  }
  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const maxRows = Math.max(2, Math.min(10, this.rowsAvailable() - 11));
    const dialog = this.dialog;
    const labelWidth = Math.max(1, Math.min(26, Math.floor(inner * 0.42)));
    const rows = dialog?.choices ?? this.options.rows.map(r => {
      const label = truncateToWidth(safe(r.label), labelWidth, '…');
      return { value: r.id, label: `${label}${' '.repeat(Math.max(1, labelWidth - visibleWidth(label) + 2))}${safe(r.value())}` };
    });
    const selected = dialog?.choices ? dialog.selected : this.selected;
    const start = Math.max(0, Math.min(rows.length - maxRows, selected - Math.floor(maxRows / 2)));
    const main = [this.theme.fg('accent', this.theme.bold(safe(typeof this.options.title === 'function' ? this.options.title() : this.options.title) + (this.options.dirty() ? ' *' : ''))),
      this.theme.fg('muted', safe(this.options.summary())), ''];
    if (dialog) main.push(this.theme.fg('accent', safe(dialog.title)));
    if (dialog?.input) main.push(...dialog.input.render(inner));
    else main.push(...rows.slice(start, start + maxRows).map((row, i) => {
      const text = `${i + start === selected ? '›' : ' '} ${safe(row.label)}`;
      return i + start === selected ? this.theme.fg('accent', this.theme.bold(text)) : text;
    }));
    if (!dialog?.input && rows.length > maxRows) main.push(this.theme.fg('muted', `${selected + 1}/${rows.length}`));
    main.push('');
    if (!dialog) main.push(...wrapTextWithAnsi(safe(this.options.rows[this.selected]?.description ?? ''), inner).slice(0, 2));
    main.push(...wrapTextWithAnsi(safe(this.status || (this.busy ? this.shell('working') : '')), inner).slice(0, 3));
    main.push(this.theme.fg('muted', dialog ? this.shell('chooseHelp') : this.shell('mainHelp')));
    return main.map(line => this.theme.bg('toolPendingBg', `  ${truncateToWidth(line, inner, '…', true)}  `));
  }
}

export async function openSettingsPanel(ui: ExtensionUIContext, options: PanelOptions) {
  let panel: SettingsPanel | undefined;
  try {
    return await ui.custom<string | undefined>((tui, theme, keys, done) => {
      panel = new SettingsPanel(options, theme, keys, () => tui.requestRender(), done, () => tui.terminal.rows); return panel;
    }, { overlay: true, overlayOptions: { width: '85%', maxHeight: '95%', anchor: 'center', margin: 1 } });
  } finally { panel?.dispose(); await panel?.drain(); }
}
