/**
 * Точка входа фронтенда.
 *
 * Задача фронтенда (MVP):
 * - анкета,
 * - шаг “эталон” (reference),
 * - шаг “диагностика” (diagnostic),
 * - показ результата (score/confidence + QC-подсказки),
 * - внутренняя панель `/admin`.
 */

import { createRoot } from 'react-dom/client';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден #root для монтирования приложения');
}

createRoot(container).render(<App />);

