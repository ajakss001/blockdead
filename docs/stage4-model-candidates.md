# Этап 4: кандидаты моделей (Sketchfab)

Установлены (A1–A4 в `assets/incoming`): Low Poly Passenger Aircraft, Low Poly Plane, Simple Fighter Jet,
Bell Huey. Транспортник — пока заглушка.

Сейчас в игре — лоу-поли заглушки (самолёты, истребители, транспортник, военный вертолёт) и уже установленные
модели (танк, БТР, грузовики, спасательный вертолёт). Ниже — бесплатные модели, лицензия по данным страницы
Sketchfab (перед скачиванием проверить ещё раз). Условия: CC0 или CC BY, без логотипов авиакомпаний и
реальных опознавательных знаков (звёзды, флаги, бортовые номера — если есть, перекрасим через `recolor`/атлас).
NC (некоммерческие) и «Free Standard» не подходят — отмечены и не рекомендуются.

| Роль | Модель | Автор | Треуг. | Лицензия | Замечание |
|---|---|---|---|---|---|
| Авиалайнер | [Low Poly Passenger Aircraft](https://sketchfab.com/3d-models/low-poly-passenger-aircraft-7d651b801e13415da422a10be8c94495) | Crimexix | 2.7k | CC BY | лучший кандидат: «generic» лайнер |
| Лёгкий самолёт | [Low Poly Plane](https://sketchfab.com/3d-models/low-poly-plane-76230052903540e9aeb46b7db35329e4) | scailman | 1.7k | CC BY | детали разделены |
| Лёгкий самолёт (запас) | [Low-poly Stylized Aircraft](https://sketchfab.com/3d-models/low-poly-stylized-aircraft-80fcb20141b74e39bd01d137f33e2aaa) | mithgarden.studio | 1.0k | CC BY | стилизованный |
| Истребитель | [Simple Fighter Jet Game Asset](https://sketchfab.com/3d-models/simple-fighter-jet-game-asset-4c1100fc396146a7a2672af4f21f44c4) | Jackson.Charles | 0.7k | CC BY | без реального прототипа — предпочтительно |
| Истребитель (запас) | [fighter jet (low poly)](https://sketchfab.com/3d-models/fighter-jet-low-poly-53ec24261fd54e9e80eb18a2b5b99df9) | reeledzin | 2.9k | CC BY | «по мотивам» F-14 |
| Истребители (пак) | [Low poly Fighter Jets](https://sketchfab.com/3d-models/low-poly-fighter-jets-71505a45880c40eebe964c6e3c4bdc11) | Ikram | 1.8k + 2.0k | CC BY | общий атлас; проверить эмблемы |
| Транспортник | [Airplanes Pack (KC-390)](https://sketchfab.com/3d-models/airplanes-pack-bf8c3a2de7924cabbb5d1d8f0b6662c7) | lucascsar | 3.4k (пак) | CC BY | в паке есть транспортник и вертолёт |
| Транспортник (запас) | [YC-130](https://sketchfab.com/3d-models/yc-130prototype-of-c-130-11d237757851434ab5cb853db80376bb) | KOG_THORNS | 12.9k | CC BY | тяжеловат, упростим до ~4k |
| Военный вертолёт | [Bell Huey helicopter](https://sketchfab.com/3d-models/bell-huey-helicopter-755d8518a06e41b19752c1b54c0da588) | Duane's Mind | 2.0k | CC BY | простой, популярный |
| Военный вертолёт (запас) | [Helicopter Low-Poly (Army)](https://sketchfab.com/3d-models/helicopter-low-poly-f92215936dcf4618a9d5d5ce86b7e2f4) | Srijan Basu | 1.7k | CC BY | в архиве FBX/BLEND — нужен GLB |
| Ударный вертолёт | [AH-64 Apache Low Poly](https://sketchfab.com/3d-models/ah-64-apache-attack-helicopter-low-poly-34986214decd4b3db90e91f12e624d78) | A Certain Duck | 3.9k | CC BY | проверить маркировку |
| Багажная тележка | [Airport Trolley](https://sketchfab.com/3d-models/airport-trolley-52004467bc784365aa31e4ede5b78f48) | assetfactory | 7k | Free Standard | **не подходит по лицензии** |
| Топливозаправщик | [Stormworks Airport Refueling Truck](https://sketchfab.com/3d-models/stormworks-airport-refueling-truck-a204cf81cde14dbb9d6bde6adbc58045) | AdyDuby | 266k | CC BY | слишком тяжёлый, только после сильного упрощения |

Не подходят: [LowPoly Cessna 158](https://sketchfab.com/3d-models/lowpoly-cessna-158-aircraft-a24ebddc8bfa4a4ab4b417f35c282721) (CC BY-NC),
[Low Poly Airplane by Kerem Biçer](https://sketchfab.com/3d-models/low-poly-airplane-08d851cb976742d8bc5eb9424b9cd2fb) (Free Standard),
[Low-Poly F-16 by Caelin](https://sketchfab.com/3d-models/low-poly-f-16-fighting-falcon-f175493965f545bfa975575846151216) (NoAI-тег).

После утверждения: положить `model.glb` в `assets/incoming/<код>/`, добавить строки в `tools/models.config.mjs`
(группы `airliner`, `lightplane`, `fighter`, `transport`, `heliMil`), `npm run prep-models`, проверить на
`/model-sheet.html`; шаблоны `poiBig.ts` переключатся на модели так же, как танки (заглушка — запасной вариант).
