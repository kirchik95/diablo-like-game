# HD-2D: host и бюджеты

HD-2D меняет только изображение. Babylon.js, пиксельные атласы, nearest sampling,
решётка размещения спрайтов, picking и правила игры сохраняются.
**HD off = today's frame.** Все отключённые модули обязаны восстановить исходные
материалы, настройки камеры и сцены, отсоединить post-process и освободить свои RT.
Проверка: точный RGBA pixel diff пяти зон при 844×390 DPR3 и 1174×769 DPR1.

## Подключение

`src/hd2d/index.js` содержит пустую статическую registry `effects`. При слиянии:

```js
import * as bloom from './bloom.js';
export const effects = Object.freeze([bloom]);
```

Каждый модуль экспортирует `id`, `order`, `install(ctx)`. Контекст:
`{ scene, engine, camera, renderer, tier }`.
`renderer.world` — построенное представление мира, `renderer.world.data` — его данные,
`renderer.assets` — атласы, `renderer.monk` / `renderer.hounds` — спрайты,
`renderer.polish.lights` — stage-0 LightPack.
`install` вызывается один раз после построения мира, stage-0 polish и камеры, включая
исходный tier. Он возвращает `setTier(tier)`, `update(dt,time)`, `dispose()` и
необязательный `onWorld(renderer)`. `onWorld` перепривязывает ресурсы после нового
забега / continue; install повторно не вызывается. Модуль не меняет игру.

Порядок установки и update: normals 5 → terrain 10 → water 20 → lights 30 →
shadows 40 → particles 50 → atmos 60 → bloom 80 → dof 90.
Post-process прикрепляются в том же порядке. Освобождение — в обратном.
Host вызывается один раз перед `scene.render()`, после stage-0 polish и обновления
спрайтов. `dt` и `time` принадлежат presentation clock; пауза останавливает его.
Активный список пересобирается только при смене tier. Кадровый путь не выделяет память.
Когда registry пуста или все модули off, Renderer проверяет один cached boolean и не
вызывает host.update. Off-модули всё равно получают onWorld и dispose.

Встроенный `probe` экспортируется для тестов и диагностики. В registry его нет.
Он не рисует, не создаёт материалов, render targets или обработчиков ввода.

## Качество и настройки

`off | low | high`. Телефон (Android/iPhone/iPod) или coarse pointer: low.
Остальные устройства: high. Настройка не меняется автоматически в ходе игры.
Приоритет: default устройства → сохранённый `ritual-hd` → URL этой вкладки.
Storage содержит JSON `{ "tier": "low", "overrides": { "bloom": "off" } }`.
Простой сохранённый `off`, `low`, `high` также читается. Ошибка storage не мешает игре.

`?hd=off`, `?hd=low`, `?hd=high` сбрасывают overrides.
`?hd=bloom:high,dof:off` наследует общий tier и меняет перечисленные эффекты.
Неверные токены игнорируются; последний корректный токен одного id побеждает.
Неизвестный корректный id хранится для будущего модуля, но сам ничего не запускает.
URL не записывается в storage. Выбор кнопки «Выкл / Низко / Высоко» очищает overrides,
сразу обновляет host и сохраняет выбор; URL перечитывается только при загрузке.
При overrides подсказка группы настроек сообщает об отдельных эффектах через URL.

«Графика» по-прежнему независимо включает stage-0 propShade/lightPools/zoneGrade.
«HD-2D» задаёт только новую registry. Поэтому HD off сохраняет текущий вид при том же
состоянии «Графики». Отключение обеих опций убирает обе группы эффектов.
В этой поставке registry пуста: low/high визуально совпадают с off.

## Бюджеты телефона

Цель: все шесть bench3-сцен, CPU ×4, p50 FPS ≥59, frame p95 ≤17.5 ms,
не больше одного кадра >33 ms за 8 s. A/B, два раунда, общий bench.lock.
CPU ниже — предлагаемые потолки на реальном телефоне на кадр, а не измерения
неподключённых модулей. Реальные расходы каждый владелец подтверждает отдельно.

| Модуль | Low CPU ms | Low extra passes | Low RT максимум | High: ориентир |
|---|---:|---:|---|---|
| normals | 0.02 | 0 | нет, только локальные карты | те же passes, карты выше детализацией |
| terrain | 0.05 | 0 | нет | больше геометрии, без отдельного RT |
| water | 0.05 | 0 | нет, без realtime reflection | максимум один half-world RT при обосновании |
| lights | 0.10 | 0 | нет, ограниченный uniform pack | больше источников, без light-per-pass |
| shadows | 0.04 | 0 | нет, baked field | максимум один half-world RT при обосновании |
| particles | 0.05 | 0 | нет, один атлас, ограниченный pool | больше частиц в том же draw batch |
| atmos | 0.04 | 0 | нет, grade в существующем проходе | максимум один half-world RT при обосновании |
| bloom | 0.04 | ≤4 | threshold + blur ping-pong ≤half-world | больше радиус, world-resolution composite |
| dof | 0.00 | 0 | low по умолчанию без blur | ≤3 passes, depth ≤world, blur ≤half-world |
| host | ≤0.01 | 0 | нет | тот же host |
| всего Low | ≤0.40 | ≤4 | только world / half-world | общий GPU-бюджет проверяется после слияния |

Текущая поставка host: **0 extra passes, 0 extra draw calls, 0 RT, 0 B texture memory**
во всех tiers. Она не создаёт никаких Babylon GPU-ресурсов.
При стандартной решётке world RT: телефон 633×292, desktop 587×384.
Half-world округляется вверх: телефон 317×146, desktop 294×192.
Один RGBA8 half-world target телефона = 185128 B без mipmaps; full-world = 739344 B.
Нельзя использовать 2532×1170 device framebuffer для каждого post effect.
Не менять nearest фильтрацию исходных атласов ради post-process.
Не включать общесценовый antialiasing, TAA или motion blur.
Проверять края DOF отдельно: deliberate blur на дальнем / ближнем плане допустим,
центральный игровой план остаётся резким.

## Проверка и bench

Тесты: `node --test tests/hd2d.test.js`.
Полный suite: `node --test --test-concurrency=1`.
Scratch wrapper и инструкция: `scratchpad/hd/hd-core/bench-hd.mjs` и `bench-hd.md`.
Они не входят в игру или production bundle. Эффекты сравниваются с HD off при той же
stage-0 настройке и фиксированном seed. Скриншот / замер всегда несёт buildId.
M4 Max и CPU ×4 не имитируют GPU телефона; passes/RT/draws/texture memory обязательны.
