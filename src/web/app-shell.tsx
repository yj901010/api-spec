import { Suspense, lazy, startTransition, useState } from 'react';
import { Store } from '../state/store.js';
import { DockviewWorkbench } from './dockview-workbench.js';

const LazyLegacyWorkbench = lazy(async () => {
  const module = await import('./legacy-workbench.js');
  return { default: module.LegacyWorkbench };
});

function preloadLegacyWorkbench(): void {
  void import('./legacy-workbench.js');
}

interface AppShellProps {
  store: Store;
}

export function AppShell({ store }: AppShellProps) {
  const [mode, setMode] = useState<'alpha' | 'classic'>('alpha');
  const [classicMounted, setClassicMounted] = useState(false);

  const switchMode = (nextMode: 'alpha' | 'classic') => {
    if (nextMode === 'classic' && !classicMounted) {
      preloadLegacyWorkbench();
      setClassicMounted(true);
    }
    startTransition(() => {
      setMode(nextMode);
    });
  };

  return (
    <div className="migration-shell">
      <header className="migration-topbar">
        <div>
          <div className="migration-kicker">Migration Preview</div>
          <h1>Dockview Workbench Alpha</h1>
          <p className="migration-copy">
            The new React workbench now handles editing, diagnostics, configuration, and snapshots in Alpha mode while
            Classic mode keeps the original full UI available during migration.
          </p>
        </div>
        <div className="migration-actions" role="tablist" aria-label="Workbench mode">
          <button
            type="button"
            className={mode === 'alpha' ? 'ghost-button mode-button mode-button-active' : 'ghost-button mode-button'}
            aria-pressed={mode === 'alpha'}
            onClick={() => switchMode('alpha')}
          >
            Alpha
          </button>
          <button
            type="button"
            className={mode === 'classic' ? 'ghost-button mode-button mode-button-active' : 'ghost-button mode-button'}
            aria-pressed={mode === 'classic'}
            onMouseEnter={preloadLegacyWorkbench}
            onFocus={preloadLegacyWorkbench}
            onClick={() => switchMode('classic')}
          >
            Classic
          </button>
        </div>
      </header>

      <section className="migration-note">
        <strong>Current alpha scope:</strong> Dockview layout, CodeMirror request/response editors, clickable issues,
        endpoint config, preset selection, snapshot compare/restore, masking, copy, and workspace export.
      </section>

      <DockviewWorkbench store={store} hidden={mode !== 'alpha'} />
      {classicMounted ? (
        <Suspense fallback={<div className="mode-loading">Loading Classic workbench...</div>}>
          <LazyLegacyWorkbench store={store} hidden={mode !== 'classic'} />
        </Suspense>
      ) : null}
    </div>
  );
}
