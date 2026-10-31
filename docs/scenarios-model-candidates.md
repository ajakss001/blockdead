# Сценарии POI: кандидаты моделей (Sketchfab)

Сейчас в игре — лоу-поли заглушки из боксов и цилиндров (`poiScenes.ts`: `tanker`, `baggageTrain`, `slide`,
`mannequin`, радар — мачта + `LIFE.spin`, пожарная машина — `chaos.fireTruck`). Ниже — бесплатные модели,
лицензия по данным страницы Sketchfab (перед скачиванием проверить ещё раз). Подходят только CC0 / CC BY;
NC и «Free Standard» отмечены и не рекомендуются. Логотипы (Pertamina и т. п.) перекрасить через `recolor`.

| Роль | Модель | Автор | Треуг. | Лицензия | Замечание |
|---|---|---|---|---|---|
| Топливозаправщик | [Tanker Truck Low Poly](https://sketchfab.com/3d-models/tanker-truck-low-poly-b3ba48e4c85d4f8387b16ba289a578fe) | AFCM | 32k | CC BY | лучший по виду; упростить до ~4k |
| Топливозаправщик (запас) | [Tanker Truck (Bowser)](https://sketchfab.com/3d-models/tanker-truck-bowser-33fa260e257a42dc8cb20608761eef2d) | BUKKBEEK | 15.7k | CC BY | водовоз, перекрасить |
| Топливозаправщик (запас) | [Low Poly Pertamina Tanker](https://sketchfab.com/3d-models/low-poly-indonesia-pertamina-tanker-59cf146a18634be0af94c1d434fd3270) | ridhobahri | 32k | CC BY | убрать логотип |
| Багажная тележка | [Airport Luggage Cart](https://sketchfab.com/3d-models/airport-luggage-cart-d603df609698459a98d797b5a7618845) | Dayvable | 22.4k | CC BY | упростить; тягач — заглушка |
| Багажный тягач | [Airport Baggage Truck](https://sketchfab.com/3d-models/airport-baggage-truck-89680c1dc30a44d6bae306db5aebb346) | assetfactory | 29.6k | Free Standard | **не подходит по лицензии** |
| Пожарная машина | [Low Poly Fire Truck](https://sketchfab.com/3d-models/low-poly-fire-truck-48557913856d48bab083a0fa05019f69) | JohnnySix | 1.7k | CC BY | самый лёгкий, с лестницей |
| Пожарная машина (запас) | [Low Poly Fire Truck](https://sketchfab.com/3d-models/low-poly-fire-truck-688b7c17a0e54a05b0b2d51a8aee061b) | JG3D | 14.3k | CC BY | европейский вид |
| Пожарная машина (запас) | [Fire Engine with Ladder Low Poly](https://sketchfab.com/3d-models/fire-engine-with-ladder-low-poly-b72d3b0536da4a68ae306bb6e1bc7617) | AFCM | 25.7k | CC BY | один стиль с заправщиком AFCM |
| Аэродромная пожарная | [Airport Firetruck](https://sketchfab.com/3d-models/airport-firetruck-bea8c90191614d349b6ef9de24dfa613) | assetfactory | — | Free Standard | **не подходит по лицензии** |
| Надувной трап | [Emergency Escape Slides](https://sketchfab.com/3d-models/emergency-escape-slides-063d907fd76b408b9668a7c6df458546) | Kanedog | 533k | не скачивается | только референс; трап остаётся процедурным |
| Манекен | [Proportional Low Poly Man](https://sketchfab.com/3d-models/proportional-low-poly-man-free-download-0bfd0e2b49a348a4b64b20cc8196e3b3) | Robin Butler | 0.5k | CC BY | очень лёгкий, безликий |
| Манекен (запас) | [Low Poly Mannequin Model](https://sketchfab.com/3d-models/low-poly-mannequin-model-d317b9e069014a9b8f9a3c1ed5dba2ba) | tae222 | 4.5k | CC BY | |
| Манекен (запас) | [Mannequin(CC0)](https://sketchfab.com/3d-models/mannequincc0-db6ac59387c245d8bae086ce1ee17fec) | WuYin | 5.3k | CC0 в описании / CC BY в поле | уточнить у автора |
| Радар | [Low-Poly Radar Dish](https://sketchfab.com/3d-models/low-poly-radar-dish-ed6850e61792430581c8f9851fb7b4c5) | joe_carrot | 2.5k | CC BY | тарелка отдельно → крутится через `LIFE.spin` |
| Радар (запас) | [Radar](https://sketchfab.com/3d-models/radar-bc37c812cb4e4177897a86f270fba9a1) | captaj0987 | — | CC BY | военный, стилизованный |

После утверждения: `assets/incoming/<код>/model.glb`, строки в `tools/models.config.mjs` (группы `fuelTruck`,
`baggageCart`, `fireTruck`, `mannequin`, `radar`), `npm run prep-models`, проверка на `/model-sheet.html`;
в шаблонах `poiScenes.ts` вызвать `mdl(c, '<группа>', …)` перед заглушкой (как танки и `wreck`).
