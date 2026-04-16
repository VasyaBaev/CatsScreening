# Протокол и датасет (MVP)

Оригинальные договорённости и протоколы:
- `sources/Kickoff_Pack_Napolnitel_dlya_koshki.docx`
- `sources/Eksperiment_i_dataset_protokol_v1.docx`
- `sources/Metriki_i_kriterii_priemki_v1.docx`
- `sources/Evidence_Pack_smartphone_colorimetry.docx`

## Где лежат фото
- Локальный набор фото (pH по подпапкам): `sources/Photos/PH/`

## Минимальный набор метаданных (из протокола)
Ожидаемые поля:
- `filename`
- `pH`
- `class` (0 = норма, 1 = отклонение/риск)
- `tray` (white/gray/yellow)
- `light` (day/3000K/6000K)
- `location` (lab/home_bath и т.п.)
- `device`
- `notes`

