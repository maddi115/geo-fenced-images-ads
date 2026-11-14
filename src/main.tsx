import { render } from 'solid-js/web';
import { App } from './ui-new/App';

// Inter (self-hosted, no Google Fonts request)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// Import all CSS globally
import './ui-new/components/map/marker.css';
import './ui-new/components/map/comment-bubble.css';
import './ui-new/components/map/comment-bubble-posted.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

render(() => <App />, root);
