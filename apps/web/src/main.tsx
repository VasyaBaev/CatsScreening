/**
 * Точка входа фронтенда.
 */

import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден #root для монтирования приложения');
}

createRoot(container).render(<App />);
