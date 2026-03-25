import { Store } from './state/store.js';
import { App } from './ui/app.js';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('#app root element not found.');
}

const store = new Store();
const app = new App(root, store);
app.mount();
