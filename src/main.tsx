import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import './appearance-palettes.css';
import './app-shell.css';
import './simple-layout.css';
import './surface-depth.css';
import { initializeAppearance } from './lib/appearance';

initializeAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
