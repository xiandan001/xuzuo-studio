import React from 'react';
import { createRoot } from 'react-dom/client';
import DialogApp from './DialogApp';
import './theme.css';
import './appearance-palettes.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><DialogApp /></React.StrictMode>);
