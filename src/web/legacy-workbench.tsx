import { useEffect, useRef } from 'react';
import { Store } from '../state/store.js';
import { App } from '../ui/app.js';

interface LegacyWorkbenchProps {
  store: Store;
  hidden: boolean;
}

export function LegacyWorkbench({ store, hidden }: LegacyWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const app = new App(element, store);
    app.mount();
    appRef.current = app;

    return () => {
      app.destroy();
      appRef.current = null;
    };
  }, [store]);

  return <div ref={rootRef} className={hidden ? 'legacy-shell legacy-shell-hidden' : 'legacy-shell'} />;
}
