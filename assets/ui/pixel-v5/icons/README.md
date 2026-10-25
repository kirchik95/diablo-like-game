# Пиксельные значки умений и предметов

20 значков в палитре HUD. Рисунок — 14×14 пикселей. Пиксель рисунка равен единице HUD `--u`.

Скрипт обводит каждый силуэт контуром 1 пиксель цвета `--night`. Цвета берутся только из токенов `src/styles.css`.

## Файлы

У каждого значка 4 файла: `@1x`, `@2x`, `@3x`, `@4x`. Число — пиксели картинки на один пиксель рисунка. Увеличение идёт без сглаживания.

| Файл | Размер |
| --- | --- |
| `имя@1x.png` | 14×14 |
| `имя@2x.png` | 28×28 |
| `имя@3x.png` | 42×42 |
| `имя@4x.png` | 56×56 |

Выбирай файл с числом `--u` × `devicePixelRatio`. Если такого файла нет, бери ближайший меньший и увеличивай без сглаживания (`image-rendering: pixelated`).

## Значки

| Значок | Данные | Рисунок |
| --- | --- | --- |
| `skill-combo-bare` | `SKILLS.combo`, без оружия | Кулак |
| `skill-combo-knuckles` | `SKILLS.combo`, кастеты | Кулак с кастетом |
| `skill-combo-staff` | `SKILLS.combo`, посох | Кулак сжимает посох |
| `skill-dash` | `SKILLS.dash` | Бегущий монах и следы рывка |
| `skill-wave` | `SKILLS.wave` | Огонь духа в кольце |
| `skill-palm` | `SKILLS.palm` | Открытая ладонь духа, коралловая середина |
| `skill-crane` | `SKILLS.crane` | Журавль с поднятыми крыльями над кольцом приземления |
| `skill-deflect` | `SKILLS.deflect` | Скрещённые предплечья, искра, дуга духа |
| `skill-bell` | `SKILLS.bell` | Бронзовый колокол, звук, пунктирный круг |
| `skill-mantra` | `SKILLS.mantra` | Кольцо чёток вокруг знака духа |
| `skill-seven-strikes` | `SKILLS.sevenStrikes` | Семь лучей вокруг кораллового удара |
| `lock` | закрытый слот или умение | Замок цвета `--dim` |
| `weapon-novice-knuckles` | `WEAPON_BASES['novice-knuckles']` | Железные кастеты, деревянная рукоять |
| `weapon-bronze-knuckles` | `WEAPON_BASES['bronze-knuckles']` | Бронзовые кастеты |
| `weapon-pilgrim-knuckles` | `WEAPON_BASES['pilgrim-knuckles']` | Тёмные кастеты с шипами, коралловая рукоять |
| `weapon-novice-staff` | `WEAPON_BASES['novice-staff']` | Простой посох с обмотками |
| `weapon-ash-staff` | `WEAPON_BASES['ash-staff']` | Светлый посох с железными концами |
| `weapon-pilgrim-staff` | `WEAPON_BASES['pilgrim-staff']` | Тёмный посох с янтарным кольцом и лентой |
| `relic-quiet-thunder` | `RELICS['quiet-thunder']` | Кастеты с искрами духа |
| `relic-crane-neck` | `RELICS['crane-neck']` | Посох с головой журавля |

Рамки редкости рисует CSS. В значках их нет.

## Манифест

`manifest.json` связывает данные игры со значками:

- `skills` — id из `SKILLS`. Для `combo` стоит значок без оружия.
- `combo` — значок серии по семейству оружия: `bare`, `knuckles`, `staff`.
- `weapons` — id из `WEAPON_BASES`.
- `relics` — id из `RELICS`.
- `lock` — значок замка.
- `icons` — вид, id, файлы и размеры каждого значка.
- `files` — SHA-256 каждого PNG.

## Обзорный лист

`contact-sheet.png` показывает все значки. Верхний ряд — умения и замок. Нижний ряд — оружие и реликвии. Порядок записан в `contactSheet.rows`.

Под каждым значком 4 вида:

1. 4× на фоне слота умения.
2. 2× на фоне ячейки сумки.
3. 2× при прозрачности 35%: закрыто или мало духа.
4. 1× на фоне ячейки сумки.

## Пересборка и проверка

```sh
python3 -B scripts/build-icon-assets.py
python3 -B scripts/build-icon-assets.py --verify-only
node --test tests/icon-assets.test.js
```

Рисунки заданы ASCII-картами в скрипте. Режим `--verify-only` сверяет файлы и не пишет их. Тест сверяет хэши и размеры. Ещё он проверяет, что у каждого id из `SKILLS`, `WEAPON_BASES` и `RELICS` есть значок.
