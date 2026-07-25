import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import './styles/app.css';
import './styles/receipt.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <OfflineBanner />
      <App />
      <InstallPrompt />
      <UpdateBanner />
    </BrowserRouter>
  </React.StrictMode>
);
