import { createRoot } from 'react-dom/client';
import 'dockview/dist/styles/dockview.css';
import '../styles.css';
import './web/workbench.css';
import { Store } from './state/store.js';
import { AppShell } from './web/app-shell.js';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('#app root element not found.');
}

const store = new Store();

createRoot(root).render(<AppShell store={store} />);
