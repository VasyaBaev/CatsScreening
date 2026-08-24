/**
 * Корневой компонент приложения.
 *
 * В MVP держим capture flow, `/admin` и ROI-разметку в одном web app,
 * чтобы локальный запуск и VPS-деплой были проще.
 */

import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { AdminPage } from './pages/AdminPage';
import { CapturePage } from './pages/CapturePage';
import { RoiLabelPage } from './pages/RoiLabelPage';

export function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <nav className="app-nav">
          <Link to="/capture">Съёмка</Link>
          <Link to="/admin">Админка</Link>
          <Link to="/roi-labeling">Разметка ROI</Link>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<CapturePage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/roi-labeling" element={<RoiLabelPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
