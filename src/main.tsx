import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import './appearance-palettes.css';
import './surface-depth.css';
import './next-interface.css';
import { initializeAppearance } from './lib/appearance';

initializeAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
