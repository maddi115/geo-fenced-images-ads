import { render } from 'solid-js/web';
import { App } from './ui-new/App';

// Import all CSS globally
import './ui-new/components/map/marker.css';
import './ui-new/components/map/comment-bubble.css';
import './ui-new/components/map/comment-bubble-posted.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

render(() => <App />, root);
