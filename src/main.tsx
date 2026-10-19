import { initializeLocale } from './i18n';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Workspace } from './workspace';
import { browserStorage } from './state';
import './styles.css';
import './theme/brand.css';
import './components/composer.css';
import './components/sidebar.css';
import './components/sidebar-divider.css';
import './components/transcript.css';
import './components/ui/menu.css';
import './components/ui/motion.css';
import './components/annotations.css';

initializeLocale();
const workspace = new Workspace();
let token = browserStorage()?.getItem('tekes.agentkit.token') || '';
if (location.hash.length > 1) {
  try {
    token = decodeURIComponent(location.hash.slice(1));
  } catch {
    token = '';
  }
  history.replaceState(null, '', location.pathname + location.search);
}
createRoot(document.getElementById('root')!).render(
  <App workspace={workspace} />,
);
if (token) void workspace.connect(token);
window.addEventListener('pagehide', () => workspace.dispose());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    const saved = browserStorage()?.getItem('tekes.agentkit.token');
    if (saved) void workspace.connect(saved);
  }
});
