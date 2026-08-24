/**
 * Пользовательский флоу теперь ведёт на production-like capture.
 * Оставляем файл как совместимый entrypoint для старого маршрута `/`.
 */

import { CapturePage } from './CapturePage';

export function UserFlowPage() {
  return <CapturePage />;
}
