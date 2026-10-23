import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './ui/App';
createRoot(document.getElementById('root')!).render(<App />);
