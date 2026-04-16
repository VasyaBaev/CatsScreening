/**
 * Корневой компонент приложения.
 *
 * Важно:
 * - держим и “пользовательский” флоу, и `/admin` в одном приложении,
 *   чтобы не плодить отдельные деплои на старте.
 */

import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { AdminPage } from './pages/AdminPage';
import { RoiLabelerPage } from './pages/RoiLabelerPage';
import { UserFlowPage } from './pages/UserFlowPage';

export function App() {
  return (
    <BrowserRouter>
      <header style={{ padding: 16, borderBottom: '1px solid #eee' }}>
        <nav style={{ display: 'flex', gap: 12 }}>
          <Link to="/">Скрининг</Link>
          <Link to="/admin">Админка</Link>
          <Link to="/tools/roi-labeler">ROI</Link>
        </nav>
      </header>

      <main style={{ padding: 16 }}>
        <Routes>
          <Route path="/" element={<UserFlowPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/tools/roi-labeler" element={<RoiLabelerPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
