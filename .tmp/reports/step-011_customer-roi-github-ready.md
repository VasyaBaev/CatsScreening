# Step 011 — Customer ROI GitHub ready
Дата: 2026-05-02

## Запрос / цель
Подготовить репозиторий так, чтобы заказчики могли скачать проект из GitHub, запустить локальную оснастку ROI-разметки, разметить фотографии и отправить результат обратно через GitHub.

## Понимание задачи
- Фотографии должны попасть в GitHub, иначе заказчик не сможет разметить датасет после clone.
- Разметка не должна менять исходные фотографии: результат хранится в `data/dataset/roi-labels-v1.json`.
- Для заказчика нужны короткие PowerShell-команды без необходимости понимать внутреннюю структуру проекта.

## План
1) Убрать игнорирование `sources/Photos/`, чтобы первая пачка фото коммитилась в репозиторий.
2) Добавить инструкцию для заказчика: что выделять, зачем ROI, как запустить и как отправить результат.
3) Добавить команды запуска, проверки и публикации ROI-разметки.
4) Проверить TypeScript и состояние ROI-проверки.
5) Сделать commit и push.

## Сделано
- `.gitignore` обновлён: `sources/Photos/` теперь можно коммитить.
- Добавлена инструкция `docs/dataset/customer-roi-guide.md`.
- Добавлены команды:
  - `npm run roi:start`
  - `npm run roi:check`
  - `npm run roi:publish`
- Добавлены скрипты:
  - `scripts/customer/start-roi-labeler.ps1`
  - `scripts/customer/publish-roi-labels.ps1`
  - `scripts/dataset/check-roi-labels.ts`
- Обновлены `README.md` и `docs/dataset/README.md`.

## Изменённые файлы
- `.gitignore`
- `README.md`
- `docs/dataset/README.md`
- `docs/dataset/customer-roi-guide.md`
- `package.json`
- `scripts/customer/start-roi-labeler.ps1`
- `scripts/customer/publish-roi-labels.ps1`
- `scripts/dataset/check-roi-labels.ts`
- `sources/Photos/PH/**` (добавляются в git как исходный датасет для разметки)
- `.tmp/reports/step-011_customer-roi-github-ready.md`

## Команды (что запускалось)
```powershell
npm run typecheck
npm run roi:check
```

## Риски / замечания
- `npm run roi:check` сейчас ожидаемо возвращает ошибку: размечено 0 из 45 фото. После работы заказчика должно быть `missing=0`, `invalid=0`.
- Датасет фото занимает около 77 МБ; отдельных файлов больше лимита GitHub 100 МБ нет.
- `npm run roi:publish` требует прав на push в репозиторий GitHub.

## Следующие шаги
1) Закоммитить изменения и фотографии.
2) Выполнить `git push`.
3) Передать заказчикам инструкцию из `docs/dataset/customer-roi-guide.md`.

