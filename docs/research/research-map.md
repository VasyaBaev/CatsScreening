# Карта исследований (Research Map)

Ниже — список исследований и материалов, уже упомянутых в `sources/Evidence_Pack_smartphone_colorimetry.docx`.
Карта нужна, чтобы **сначала искать ответы локально**, и только потом выходить в интернет.

## Список

| ID | Название | Год | Ссылка | Локальная копия | Для чего в проекте |
|---:|---|---:|---|---|---|
| R001 | Smartphone-Based Colorimetric Analysis of Urine Test Strips for At-Home Prenatal Care | 2022 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9292338/ | `docs/research/papers/R001_urine-test-strips_2022.html` | Подтверждение реализуемости “домашней” colorimetry, аргументы за референс/маркер в кадре, сравнение каналов (Hue и др.) |
| R002 | Accurate device-independent colorimetric measurements using smartphones (PLOS ONE) | 2020 | https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230561 | `docs/research/papers/R002_device-independent_2020.pdf` | Устойчивость к освещению: flash/no-flash, ambient subtraction, калибровка → device-independent space |
| R003 | A Smartphone-Based Automatic Measurement Method for Colorimetric pH Detection Using a Color Adaptation Algorithm (Sensors) | 2017 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5539506/ | `docs/research/papers/R003_ph-detection_2017.html` | Цветовая адаптация/нормализация к эталону, влияние авто‑коррекций камеры |
| R004 | Smartphone-Based Point-of-Care Urinalysis Under Variable Illumination (IEEE JTEHM) | 2017 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5764119/ | `docs/research/papers/R004_urinalysis-variable-illumination_2017.html` | Устойчивость под переменным светом, выбор цветовых пространств |
| R005 | The optimal color space enables advantageous smartphone-based colorimetric sensing | 2024/2025 | https://pubmed.ncbi.nlm.nih.gov/39818181/ | `docs/research/notes/R005_pubmed_record.md` | Выбор color space для sensing: аргументы за HSV/Lab/ΔE и т.п. |
| R006 | Colorimetric biosensor based on smartphone: State-of-art (ScienceDirect) | 2023 | https://www.sciencedirect.com/science/article/pii/S0924424722006914 | `docs/research/notes/R006_sciencedirect_record.md` | Обзор подходов/стандартных приёмов (аксессуары, пространства, обработка) |

## Как пополнять карту
1) Добавить новую строку с новым ID (R007, R008, …).
2) Сохранить локальную копию (PDF/HTML/конспект) и указать путь в колонке “Локальная копия”.
3) Добавить краткую выжимку (1–3 пункта) в отдельном файле в `docs/research/notes/` при необходимости.
