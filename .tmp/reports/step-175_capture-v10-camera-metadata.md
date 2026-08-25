# Step 175 — Capture V10 bounded camera metadata

Дата: 2026-08-25

## Запрос / цель

Сохранять для каждого нового raw upload честный best-effort camera metadata status и ограниченный
набор нормализованных значений, извлечённых из тех же bytes, что дают persisted SHA-256.

## Понимание задачи

Парсинг не должен менять оригинал или превращать сохранённую фотографию в failed upload.
Неизвестные, отсутствующие и повреждённые metadata должны различаться без сохранения raw parser
output, GPS coordinates, binary payloads или текста ошибки.

## План

Добавить optional shared contract, один server helper на approved ExifReader, вызвать его из
существующего local image storage и покрыть synthetic buffers и HTTP upload focused tests.

## Сделано

- `cameraMetadata` добавлено как optional поле upload, поэтому старые attempts читаются без
  migration;
- schema фиксирует version/capture path/parser status, detected container, nullable bounded values,
  per-field sources и privacy GPS status;
- нормализованы разрешённые EXIF/XMP/ICC поля, ISO aliases и только `Auto`/`Manual` white balance;
- Kelvin принимается только из явно названного XMP `Temperature`, без вывода из `LightSource`;
- GPS coordinates вычислительно распознаются и отбрасываются; наружу выходит только
  `present_then_discarded` или `absent_or_stripped`;
- helper не возвращает raw XMP, thumbnail, MPF, MakerNote, ICC binary, stack/path/error;
- statuses: `parsed`, `no_metadata`, `unsupported_format`, `parse_error`;
- metadata извлекается из исходного `Buffer` после byte-identical write; bytes и SHA не меняются;
- `no_metadata` и malformed EXIF (`parse_error`) подтверждены как успешные HTTP 201 uploads;
- установлена единственная новая direct dependency `exifreader@4.44.0` exact. Его optional
  transitive `@xmldom/xmldom` отражён npm lock автоматически и не добавлен как direct dependency.

## Изменённые файлы

- `packages/shared/src/index.ts`;
- `apps/api/src/services/image-metadata.ts`;
- `apps/api/src/services/image-metadata.test.ts`;
- `apps/api/src/services/local-image-storage.ts`;
- `apps/api/package.json`;
- `package-lock.json`.

## Команды (что запускалось)

- `npm install --workspace apps/api --save-exact exifreader@4.44.0`;
- `npm run build --workspace packages/shared`;
- `npm run typecheck --workspace packages/shared`;
- `npm run typecheck --workspace apps/api`;
- `npm exec tsx -- --test apps/api/src/services/image-metadata.test.ts` — 6/6 passed;
- `npm exec tsx -- --test apps/api/src/services/capture-policy.test.ts` — 7/7 passed;
- `npm exec tsx -- --test apps/api/src/services/capture-lifecycle.test.ts` — 8/8 passed;
- targeted `prettier --check` и `git diff --check`.

## Риски / замечания

Реальный iPhone HEIC и физические vendor metadata не проверялись до deploy, как ограничено scope.
Парсинг остаётся best-effort: original физически не переписывается и может сохранять GPS внутри
самого файла, хотя координаты не попадают в `cameraMetadata`.

## Результат

Каждый новый Capture upload получает bounded metadata contract из exact upload bytes, а сбой или
отсутствие metadata не ломает сохранение оригинала.
