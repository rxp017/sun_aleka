import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './planner.css';
import '@fontsource-variable/outfit';
import './taste.css';
import './simple.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
