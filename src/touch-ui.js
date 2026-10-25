// Phone controls on screen (docs/design/mobile-touch.md): the floating stick, «Удар», «Шаг» and three
// technique buttons, «Монах», «Пауза» and «E», the aim circle with «Отмена», and the «Поверни телефон»
// and «Экран слишком мал» screens. TouchInput (touch.js) owns the fingers; this layer forwards touch
// pointer events to it and draws its state. It starts only on a touch device: a coarse pointer at
// start, or the first touch. A mouse-only desktop never sees it.
import './mobile.css';
import { getInteractionPrompt } from './game.js';
import { weaponCombo } from './items.js';
import { MONK_RULES } from './monk-combat.js';
import { unspentPoints } from './progression.js';
import { skillParams, slotStates } from './run-progress.js';
import { createLoadout } from './skills.js';
import { TOUCH_RULES, screenState } from './touch.js';

// Pixel art from the Paper page «Системы — Телефон», boards 01–05. The attack face takes --face.
const ATTACK_ART = `<path fill="#0D0A14" d="M16 0h8v1h-8zM12 1h4v1h-4zM24 1h4v1h-4zM10 2h3v1h-3zM27 2h3v1h-3zM9 3h2v1h-2zM16 3h8v1h-8zM29 3h2v1h-2zM7 4h2v1h-2zM13 4h3v1h-3zM24 4h3v1h-3zM31 4h2v1h-2zM6 5h2v1h-2zM11 5h2v1h-2zM27 5h2v1h-2zM32 5h2v1h-2zM5 6h2v1h-2zM10 6h1v1h-1zM29 6h1v1h-1zM33 6h2v1h-2zM4 7h2v1h-2zM8 7h2v1h-2zM30 7h2v1h-2zM34 7h2v1h-2zM4 8h1v1h-1zM7 8h2v1h-2zM31 8h2v1h-2zM35 8h1v1h-1zM3 9h1v1h-1zM7 9h1v1h-1zM32 9h1v1h-1zM36 9h1v1h-1zM2 10h2v1h-2zM6 10h1v1h-1zM33 10h1v1h-1zM36 10h2v1h-2zM2 11h1v1h-1zM5 11h1v1h-1zM34 11h1v1h-1zM37 11h1v1h-1zM1 12h2v1h-2zM5 12h1v1h-1zM34 12h1v1h-1zM37 12h2v1h-2zM1 13h1v1h-1zM4 13h1v1h-1zM35 13h1v1h-1zM38 13h1v1h-1zM1 14h1v1h-1zM4 14h1v1h-1zM35 14h1v1h-1zM38 14h1v1h-1zM1 15h1v1h-1zM4 15h1v1h-1zM35 15h1v1h-1zM38 15h1v1h-1zM0 16h1v1h-1zM3 16h1v1h-1zM36 16h1v1h-1zM39 16h1v1h-1zM0 17h1v1h-1zM3 17h1v1h-1zM36 17h1v1h-1zM39 17h1v1h-1zM0 18h1v1h-1zM3 18h1v1h-1zM36 18h1v1h-1zM39 18h1v1h-1zM0 19h1v1h-1zM3 19h1v1h-1zM36 19h1v1h-1zM39 19h1v1h-1zM0 20h1v1h-1zM3 20h1v1h-1zM36 20h1v1h-1zM39 20h1v1h-1zM0 21h1v1h-1zM3 21h1v1h-1zM36 21h1v1h-1zM39 21h1v1h-1zM0 22h1v1h-1zM3 22h1v1h-1zM36 22h1v1h-1zM39 22h1v1h-1zM0 23h1v1h-1zM3 23h1v1h-1zM36 23h1v1h-1zM39 23h1v1h-1zM1 24h1v1h-1zM4 24h1v1h-1zM35 24h1v1h-1zM38 24h1v1h-1zM1 25h1v1h-1zM4 25h1v1h-1zM35 25h1v1h-1zM38 25h1v1h-1zM1 26h1v1h-1zM4 26h1v1h-1zM35 26h1v1h-1zM38 26h1v1h-1zM1 27h2v1h-2zM5 27h1v1h-1zM34 27h1v1h-1zM37 27h2v1h-2zM2 28h1v1h-1zM5 28h1v1h-1zM34 28h1v1h-1zM37 28h1v1h-1zM2 29h2v1h-2zM6 29h1v1h-1zM33 29h1v1h-1zM36 29h2v1h-2zM3 30h1v1h-1zM7 30h1v1h-1zM32 30h1v1h-1zM36 30h1v1h-1zM4 31h1v1h-1zM7 31h2v1h-2zM31 31h2v1h-2zM35 31h1v1h-1zM4 32h2v1h-2zM8 32h2v1h-2zM30 32h2v1h-2zM34 32h2v1h-2zM5 33h2v1h-2zM10 33h1v1h-1zM29 33h1v1h-1zM33 33h2v1h-2zM6 34h2v1h-2zM11 34h2v1h-2zM27 34h2v1h-2zM32 34h2v1h-2zM7 35h2v1h-2zM13 35h3v1h-3zM24 35h3v1h-3zM31 35h2v1h-2zM9 36h2v1h-2zM16 36h8v1h-8zM29 36h2v1h-2zM10 37h3v1h-3zM27 37h3v1h-3zM12 38h4v1h-4zM24 38h4v1h-4zM16 39h8v1h-8z"/><path fill="#EF8E83" d="M16 1h8v1h-8zM13 2h13v1h-13zM11 3h5v1h-5zM24 3h1v1h-1zM9 4h4v1h-4zM8 5h3v1h-3zM7 6h3v1h-3zM6 7h2v1h-2zM5 8h2v1h-2zM4 9h3v1h-3zM4 10h2v1h-2zM3 11h2v1h-2zM3 12h2v1h-2zM2 13h2v1h-2zM2 14h2v1h-2zM3 15h1v1h-1z"/><path fill="#44394F" d="M26 2h1v1h-1zM25 3h4v1h-4zM27 4h4v1h-4zM29 5h3v1h-3zM30 6h3v1h-3zM32 7h2v1h-2zM33 8h2v1h-2zM33 9h3v1h-3zM34 10h2v1h-2zM35 11h2v1h-2zM35 12h2v1h-2zM36 13h2v1h-2zM36 14h2v1h-2zM2 15h1v1h-1zM36 15h2v1h-2zM1 16h2v1h-2zM37 16h2v1h-2zM1 17h2v1h-2zM37 17h2v1h-2zM1 18h2v1h-2zM37 18h2v1h-2zM1 19h2v1h-2zM37 19h2v1h-2zM1 20h2v1h-2zM37 20h2v1h-2zM1 21h2v1h-2zM37 21h2v1h-2zM1 22h2v1h-2zM38 22h1v1h-1zM1 23h2v1h-2zM2 24h2v1h-2zM2 25h2v1h-2zM2 26h2v1h-2zM3 27h2v1h-2zM3 28h2v1h-2zM4 29h2v1h-2zM4 30h3v1h-3zM5 31h2v1h-2zM6 32h2v1h-2zM7 33h3v1h-3zM8 34h3v1h-3zM9 35h2v1h-2z"/><path class="touch-face" d="M16 4h8v1h-8zM13 5h14v1h-14zM11 6h18v1h-18zM10 7h20v1h-20zM9 8h22v1h-22zM8 9h24v1h-24zM7 10h26v1h-26zM6 11h28v1h-28zM6 12h28v1h-28zM5 13h30v1h-30zM5 14h30v1h-30zM5 15h30v1h-30zM4 16h32v1h-32zM4 17h32v1h-32zM4 18h32v1h-32zM4 19h32v1h-32zM4 20h32v1h-32zM4 21h32v1h-32zM4 22h32v1h-32zM4 23h32v1h-32zM5 24h30v1h-30zM5 25h30v1h-30zM5 26h30v1h-30zM6 27h28v1h-28zM6 28h28v1h-28zM7 29h26v1h-26zM8 30h24v1h-24zM9 31h22v1h-22zM10 32h20v1h-20zM11 33h18v1h-18zM13 34h14v1h-14zM16 35h8v1h-8z"/><path fill="#130F1B" d="M37 22h1v1h-1zM37 23h2v1h-2zM36 24h2v1h-2zM36 25h2v1h-2zM36 26h2v1h-2zM35 27h2v1h-2zM35 28h2v1h-2zM34 29h2v1h-2zM33 30h3v1h-3zM33 31h2v1h-2zM32 32h2v1h-2zM30 33h3v1h-3zM29 34h3v1h-3zM11 35h2v1h-2zM27 35h4v1h-4zM11 36h5v1h-5zM24 36h5v1h-5zM13 37h14v1h-14zM16 38h8v1h-8z"/>`;
const STICK_BASE_ART = `<path fill="#0D0A14" d="M21 0h10v1h-10zM17 1h4v1h-4zM31 1h4v1h-4zM15 2h2v1h-2zM35 2h2v1h-2zM13 3h2v1h-2zM21 3h10v1h-10zM37 3h2v1h-2zM11 4h2v1h-2zM18 4h3v1h-3zM31 4h3v1h-3zM39 4h2v1h-2zM10 5h2v1h-2zM16 5h2v1h-2zM34 5h2v1h-2zM40 5h2v1h-2zM9 6h1v1h-1zM14 6h2v1h-2zM36 6h2v1h-2zM42 6h1v1h-1zM8 7h1v1h-1zM12 7h2v1h-2zM38 7h2v1h-2zM43 7h1v1h-1zM7 8h1v1h-1zM11 8h2v1h-2zM39 8h2v1h-2zM44 8h1v1h-1zM6 9h1v1h-1zM10 9h1v1h-1zM41 9h1v1h-1zM45 9h1v1h-1zM5 10h1v1h-1zM9 10h1v1h-1zM42 10h1v1h-1zM46 10h1v1h-1zM4 11h2v1h-2zM8 11h1v1h-1zM43 11h1v1h-1zM46 11h2v1h-2zM4 12h1v1h-1zM7 12h2v1h-2zM43 12h2v1h-2zM47 12h1v1h-1zM3 13h1v1h-1zM7 13h1v1h-1zM44 13h1v1h-1zM48 13h1v1h-1zM3 14h1v1h-1zM6 14h1v1h-1zM45 14h1v1h-1zM48 14h1v1h-1zM2 15h1v1h-1zM6 15h1v1h-1zM45 15h1v1h-1zM49 15h1v1h-1zM2 16h1v1h-1zM5 16h1v1h-1zM46 16h1v1h-1zM49 16h1v1h-1zM1 17h1v1h-1zM5 17h1v1h-1zM46 17h1v1h-1zM50 17h1v1h-1zM1 18h1v1h-1zM4 18h1v1h-1zM47 18h1v1h-1zM50 18h1v1h-1zM1 19h1v1h-1zM4 19h1v1h-1zM47 19h1v1h-1zM50 19h1v1h-1zM1 20h1v1h-1zM4 20h1v1h-1zM47 20h1v1h-1zM50 20h1v1h-1zM0 21h1v1h-1zM3 21h1v1h-1zM48 21h1v1h-1zM51 21h1v1h-1zM0 22h1v1h-1zM3 22h1v1h-1zM48 22h1v1h-1zM51 22h1v1h-1zM0 23h1v1h-1zM3 23h1v1h-1zM48 23h1v1h-1zM51 23h1v1h-1zM0 24h1v1h-1zM3 24h1v1h-1zM48 24h1v1h-1zM51 24h1v1h-1zM0 25h1v1h-1zM3 25h1v1h-1zM48 25h1v1h-1zM51 25h1v1h-1zM0 26h1v1h-1zM3 26h1v1h-1zM48 26h1v1h-1zM51 26h1v1h-1zM0 27h1v1h-1zM3 27h1v1h-1zM48 27h1v1h-1zM51 27h1v1h-1zM0 28h1v1h-1zM3 28h1v1h-1zM48 28h1v1h-1zM51 28h1v1h-1zM0 29h1v1h-1zM3 29h1v1h-1zM48 29h1v1h-1zM51 29h1v1h-1zM0 30h1v1h-1zM3 30h1v1h-1zM48 30h1v1h-1zM51 30h1v1h-1zM1 31h1v1h-1zM4 31h1v1h-1zM47 31h1v1h-1zM50 31h1v1h-1zM1 32h1v1h-1zM4 32h1v1h-1zM47 32h1v1h-1zM50 32h1v1h-1zM1 33h1v1h-1zM4 33h1v1h-1zM47 33h1v1h-1zM50 33h1v1h-1zM1 34h1v1h-1zM5 34h1v1h-1zM46 34h1v1h-1zM50 34h1v1h-1zM2 35h1v1h-1zM5 35h1v1h-1zM46 35h1v1h-1zM49 35h1v1h-1zM2 36h1v1h-1zM6 36h1v1h-1zM45 36h1v1h-1zM49 36h1v1h-1zM3 37h1v1h-1zM6 37h1v1h-1zM45 37h1v1h-1zM48 37h1v1h-1zM3 38h1v1h-1zM7 38h1v1h-1zM44 38h1v1h-1zM48 38h1v1h-1zM4 39h1v1h-1zM7 39h2v1h-2zM43 39h2v1h-2zM47 39h1v1h-1zM4 40h2v1h-2zM8 40h1v1h-1zM43 40h1v1h-1zM46 40h2v1h-2zM5 41h1v1h-1zM9 41h1v1h-1zM42 41h1v1h-1zM46 41h1v1h-1zM6 42h1v1h-1zM10 42h1v1h-1zM41 42h1v1h-1zM45 42h1v1h-1zM7 43h1v1h-1zM11 43h2v1h-2zM39 43h2v1h-2zM44 43h1v1h-1zM8 44h1v1h-1zM12 44h2v1h-2zM38 44h2v1h-2zM43 44h1v1h-1zM9 45h1v1h-1zM14 45h2v1h-2zM36 45h2v1h-2zM42 45h1v1h-1zM10 46h2v1h-2zM16 46h2v1h-2zM34 46h2v1h-2zM40 46h2v1h-2zM11 47h2v1h-2zM18 47h3v1h-3zM31 47h3v1h-3zM39 47h2v1h-2zM13 48h2v1h-2zM21 48h10v1h-10zM37 48h2v1h-2zM15 49h2v1h-2zM35 49h2v1h-2zM17 50h4v1h-4zM31 50h4v1h-4zM21 51h10v1h-10z"/><path fill="#6C6179" d="M21 1h10v1h-10zM17 2h17v1h-17zM15 3h6v1h-6zM31 3h2v1h-2zM13 4h5v1h-5zM12 5h4v1h-4zM10 6h4v1h-4zM9 7h3v1h-3zM8 8h3v1h-3zM7 9h3v1h-3zM6 10h3v1h-3zM6 11h2v1h-2zM5 12h2v1h-2zM4 13h3v1h-3zM4 14h2v1h-2zM3 15h3v1h-3zM3 16h2v1h-2zM2 17h3v1h-3zM2 18h2v1h-2zM2 19h2v1h-2z"/><path fill="#44394F" d="M34 2h1v1h-1zM33 3h4v1h-4zM34 4h5v1h-5zM36 5h4v1h-4zM38 6h4v1h-4zM40 7h3v1h-3zM41 8h3v1h-3zM42 9h3v1h-3zM43 10h3v1h-3zM44 11h2v1h-2zM45 12h2v1h-2zM45 13h3v1h-3zM46 14h2v1h-2zM46 15h3v1h-3zM47 16h2v1h-2zM47 17h3v1h-3zM48 18h2v1h-2zM48 19h2v1h-2zM2 20h2v1h-2zM48 20h2v1h-2zM1 21h2v1h-2zM49 21h2v1h-2zM1 22h2v1h-2zM49 22h2v1h-2zM1 23h2v1h-2zM49 23h2v1h-2zM1 24h2v1h-2zM49 24h2v1h-2zM1 25h2v1h-2zM49 25h2v1h-2zM1 26h2v1h-2zM49 26h2v1h-2zM1 27h2v1h-2zM49 27h2v1h-2zM1 28h2v1h-2zM49 28h2v1h-2zM1 29h2v1h-2zM1 30h2v1h-2zM2 31h2v1h-2zM2 32h2v1h-2zM2 33h2v1h-2zM2 34h3v1h-3zM3 35h2v1h-2zM3 36h3v1h-3zM4 37h2v1h-2zM4 38h3v1h-3zM5 39h2v1h-2zM6 40h2v1h-2zM6 41h3v1h-3zM7 42h3v1h-3zM8 43h3v1h-3zM9 44h3v1h-3zM10 45h4v1h-4zM12 46h2v1h-2zM13 47h1v1h-1z"/><path fill="#0D0A1473" d="M21 4h10v1h-10zM18 5h16v1h-16zM16 6h20v1h-20zM14 7h24v1h-24zM13 8h26v1h-26zM11 9h30v1h-30zM10 10h32v1h-32zM9 11h34v1h-34zM9 12h34v1h-34zM8 13h36v1h-36zM7 14h38v1h-38zM7 15h38v1h-38zM6 16h40v1h-40zM6 17h40v1h-40zM5 18h42v1h-42zM5 19h42v1h-42zM5 20h42v1h-42zM4 21h44v1h-44zM4 22h44v1h-44zM4 23h44v1h-44zM4 24h44v1h-44zM4 25h44v1h-44zM4 26h44v1h-44zM4 27h44v1h-44zM4 28h44v1h-44zM4 29h44v1h-44zM4 30h44v1h-44zM5 31h42v1h-42zM5 32h42v1h-42zM5 33h42v1h-42zM6 34h40v1h-40zM6 35h40v1h-40zM7 36h38v1h-38zM7 37h38v1h-38zM8 38h36v1h-36zM9 39h34v1h-34zM9 40h34v1h-34zM10 41h32v1h-32zM11 42h30v1h-30zM13 43h26v1h-26zM14 44h24v1h-24zM16 45h20v1h-20zM18 46h16v1h-16zM21 47h10v1h-10z"/><path fill="#130F1B" d="M49 29h2v1h-2zM49 30h2v1h-2zM48 31h2v1h-2zM48 32h2v1h-2zM48 33h2v1h-2zM47 34h3v1h-3zM47 35h2v1h-2zM46 36h3v1h-3zM46 37h2v1h-2zM45 38h3v1h-3zM45 39h2v1h-2zM44 40h2v1h-2zM43 41h3v1h-3zM42 42h3v1h-3zM41 43h3v1h-3zM40 44h3v1h-3zM38 45h4v1h-4zM14 46h2v1h-2zM36 46h4v1h-4zM14 47h4v1h-4zM34 47h5v1h-5zM15 48h6v1h-6zM31 48h6v1h-6zM17 49h18v1h-18zM21 50h10v1h-10z"/>`;
const STICK_KNOB_ART = `<path fill="#0D0A14" d="M8 0h6v1h-6zM5 1h3v1h-3zM14 1h3v1h-3zM4 2h2v1h-2zM16 2h2v1h-2zM3 3h1v1h-1zM18 3h1v1h-1zM2 4h1v1h-1zM19 4h1v1h-1zM1 5h2v1h-2zM19 5h2v1h-2zM1 6h1v1h-1zM20 6h1v1h-1zM1 7h1v1h-1zM20 7h1v1h-1zM0 8h1v1h-1zM21 8h1v1h-1zM0 9h1v1h-1zM21 9h1v1h-1zM0 10h1v1h-1zM21 10h1v1h-1zM0 11h1v1h-1zM21 11h1v1h-1zM0 12h1v1h-1zM21 12h1v1h-1zM0 13h1v1h-1zM21 13h1v1h-1zM1 14h1v1h-1zM20 14h1v1h-1zM1 15h1v1h-1zM20 15h1v1h-1zM1 16h2v1h-2zM19 16h2v1h-2zM2 17h1v1h-1zM19 17h1v1h-1zM3 18h1v1h-1zM18 18h1v1h-1zM4 19h2v1h-2zM16 19h2v1h-2zM5 20h3v1h-3zM14 20h3v1h-3zM8 21h6v1h-6z"/><path fill="#B4AABA" d="M8 1h6v1h-6zM6 2h2v1h-2zM4 3h2v1h-2zM3 4h2v1h-2zM3 5h1v1h-1zM2 6h1v1h-1zM2 7h1v1h-1z"/><path fill="#6C6179" d="M8 2h8v1h-8zM6 3h12v1h-12zM5 4h14v1h-14zM4 5h15v1h-15zM3 6h17v1h-17zM3 7h17v1h-17zM1 8h20v1h-20zM1 9h20v1h-20zM1 10h20v1h-20zM1 11h20v1h-20zM1 12h19v1h-19zM1 13h19v1h-19zM2 14h17v1h-17zM2 15h17v1h-17zM3 16h15v1h-15zM3 17h14v1h-14zM4 18h12v1h-12zM8 19h6v1h-6z"/><path fill="#44394F" d="M20 12h1v1h-1zM20 13h1v1h-1zM19 14h1v1h-1zM19 15h1v1h-1zM18 16h1v1h-1zM17 17h2v1h-2zM16 18h2v1h-2zM6 19h2v1h-2zM14 19h2v1h-2zM8 20h6v1h-6z"/><path fill="#85798F" d="M9 9h4v4H9z"/>`;
const MONK_ART = '<path fill="#B4AABA" d="M4 0h4v1H4zM3 1h6v3H3zM4 4h4v1H4zM5 5h2v1H5zM2 6h8v1H2zM1 7h10v4H1z"/><path fill="#EEE0CE" d="M4 0h3v1H4zM3 1h2v2H3zM2 6h3v1H2zM1 7h2v1H1z"/><path fill="#9D4E5C" d="M5 7h2v4H5z"/>';
const PAUSE_ART = '<path fill="#EEE0CE" d="M3 2h2v8H3zM7 2h2v8H7z"/><path fill="#B4AABA" d="M4 3h1v7H4zM8 3h1v7H8z"/>';
const HAND_ART = '<path fill="#E5B66E" d="M3 2h1v5H3zM5 1h1v6H5zM7 2h1v5H7zM9 3h1v5H9zM1 6h1v2H1zM2 7h1v2H2zM3 7h7v2H3zM3 9h6v1H3zM4 10h4v1H4z"/><path fill="#FFDF9F" d="M3 2h1v1H3zM5 1h1v1H5zM7 2h1v1H7zM9 3h1v1H9zM1 6h1v1H1z"/><path fill="#8F734F" d="M4 10h4v1H4zM8 9h1v1H8z"/>';
const CROSS_ART = '<path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h2v2H2zM1 4h1v1H1zM0 5h1v1H0zM5 0h1v1H5zM4 1h1v1H4zM4 4h1v1H4zM5 5h1v1H5z"/>';
// A dimmed phone upright, the phone lying with two orbs and the experience line, an amber turn arrow.
const ROTATE_ART = '<path fill="#44394F" d="M14 0h16v28H14z"/><path fill="#211A2B" d="M15 1h14v26H15z"/><path fill="#44394F" d="M20 2h4v1h-4z"/><path fill="#0D0A14" d="M5 13h30v17H5z"/><path fill="#6C6179" d="M6 14h28v15H6z"/><path fill="#85798F" d="M6 14h28v1H6z"/><path fill="#2C2437" d="M8 16h24v11H8z"/><path fill="#EF8E83" d="M9 17h3v3H9z"/><path fill="#6DD6CB" d="M28 17h3v3h-3z"/><path fill="#E5B66E" d="M13 18h14v1H13z"/><path fill="#EEE0CE" d="M19 22h2v3h-2z"/><path fill="#E5B66E" d="M29 1h4v1h-4zM33 2h2v1h-2zM35 3h1v1h-1zM36 4h1v2h-1zM37 6h1v4h-1zM35 9h5v1h-5zM36 10h3v1h-3zM37 11h1v1h-1z"/><path fill="#FFDF9F" d="M29 1h4v1h-4z"/>';

// The 29u orb of the phone (board 01, §4.1): 1u outline, 2u ring, 1u glass edge and 21 rows of glass.
const ORB_GLASS = 'M11 4h7v1h-7zM9 5h11v1H9zM8 6h13v1H8zM7 7h15v1H7zM6 8h17v1H6zM5 9h19v2H5zM4 11h21v7H4zM5 18h19v2H5zM6 20h17v1H6zM7 21h15v1H7zM8 22h13v1H8zM9 23h11v1H9zM11 24h7v1h-7z';
const ORB_SHADE = 'M23 9h1v2h-1zM23 11h2v6h-2zM22 17h3v1h-3zM22 18h2v1h-2zM21 19h3v1h-3zM20 20h3v1h-3zM19 21h3v1h-3zM8 22h1v1H8zM17 22h4v1h-4zM9 23h11v1H9zM11 24h7v1h-7z';
const ORB_GLINT = 'M10 7h2v1h-2zM9 8h2v1H9zM8 9h1v1H8zM7 10h2v1H7z';
const ORB_OUTLINE = 'M11 0h7v1h-7zM8 1h3v1H8zM18 1h3v1h-3zM6 2h2v1H6zM21 2h2v1h-2zM5 3h2v1H5zM11 3h7v1h-7zM22 3h2v1h-2zM4 4h1v1H4zM9 4h2v1H9zM18 4h2v1h-2zM24 4h1v1h-1zM3 5h1v1H3zM7 5h2v1H7zM20 5h2v1h-2zM25 5h1v1h-1zM2 6h2v1H2zM6 6h2v1H6zM21 6h2v1h-2zM25 6h2v1h-2zM2 7h1v1H2zM5 7h2v1H5zM22 7h2v1h-2zM26 7h1v1h-1zM1 8h1v1H1zM5 8h1v1H5zM23 8h1v1h-1zM27 8h1v1h-1zM1 9h1v2H1zM4 9h1v2H4zM24 9h1v2h-1zM27 9h1v2h-1zM0 11h1v7H0zM3 11h1v7H3zM25 11h1v7h-1zM28 11h1v7h-1zM1 18h1v3H1zM4 18h1v2H4zM24 18h1v2h-1zM27 18h1v3h-1zM5 20h1v1H5zM23 20h1v1h-1zM2 21h1v1H2zM5 21h2v1H5zM22 21h2v1h-2zM26 21h1v1h-1zM2 22h2v1H2zM6 22h2v1H6zM21 22h2v1h-2zM25 22h2v1h-2zM3 23h1v1H3zM7 23h2v1H7zM20 23h2v1h-2zM25 23h1v1h-1zM4 24h1v1H4zM9 24h2v1H9zM18 24h2v1h-2zM24 24h1v1h-1zM5 25h2v1H5zM11 25h7v1h-7zM22 25h2v1h-2zM6 26h2v1H6zM21 26h2v1h-2zM8 27h3v1H8zM18 27h3v1h-3zM11 28h7v1h-7z';
const ORB_RING_TOP = 'M11 1h7v1h-7zM8 2h10v1H8zM7 3h4v1H7zM5 4h4v1H5zM4 5h3v1H4zM4 6h2v1H4zM3 7h2v1H3zM2 8h3v1H2zM2 9h2v2H2z';
const ORB_RING_SIDE = 'M18 2h3v1h-3zM18 3h4v1h-4zM20 4h4v1h-4zM22 5h3v1h-3zM23 6h2v1h-2zM24 7h2v1h-2zM24 8h3v1h-3zM25 9h2v2h-2zM1 11h2v7H1zM26 11h2v5h-2zM2 18h2v2H2zM2 20h3v1H2zM3 21h2v1H3zM4 22h2v1H4zM4 23h3v1H4zM5 24h4v1H5zM7 25h1v1H7z';
const ORB_RING_LOW = 'M26 16h2v2h-2zM25 18h2v2h-2zM24 20h3v1h-3zM24 21h2v1h-2zM23 22h2v1h-2zM22 23h3v1h-3zM20 24h4v1h-4zM8 25h3v1H8zM18 25h4v1h-4zM8 26h13v1H8zM11 27h7v1h-7z';
export const ORB_ROWS = 21;
const ORB_FLOOR = 25;
// Liquid rows: round(21 × value / max), at least one above 0 (§4.1).
export const orbRows = (value, max) => value > 0 && max > 0 ? Math.max(1, Math.round(ORB_ROWS * Math.min(value, max) / max)) : 0;
// The orb drawing for this many rows; the light top row shows only below the brim.
export const orbArt = (kind, rows) => `<clipPath id="touch-${kind}-level"><rect x="0" y="${ORB_FLOOR - rows}" width="29" height="${rows}" /></clipPath>`
  + `<clipPath id="touch-${kind}-glass"><path d="${ORB_GLASS}" /></clipPath>`
  + `<path class="orb-empty" d="${ORB_GLASS}" />`
  + `<g clip-path="url(#touch-${kind}-level)"><path class="orb-liquid" d="${ORB_GLASS}" /><path class="orb-shade" d="${ORB_SHADE}" /></g>`
  + `<rect class="orb-surface" x="0" y="${ORB_FLOOR - rows}" width="29" height="${rows > 0 && rows < ORB_ROWS ? 1 : 0}" clip-path="url(#touch-${kind}-glass)" />`
  + `<path class="orb-glint" d="${ORB_GLINT}" /><path class="ring-outline" d="${ORB_OUTLINE}" /><path class="ring-top" d="${ORB_RING_TOP}" />`
  + `<path class="ring-side" d="${ORB_RING_SIDE}" /><path class="ring-low" d="${ORB_RING_LOW}" />`;

const pixelSvg = (className, size, body) =>
  `<svg class="${className}" viewBox="0 0 ${size}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${body}</svg>`;
const spriteIcon = id => pixelSvg('touch-icon', '24 24', `<use href="#icon-${id}" />`);
const TECHNIQUE_BUTTONS = ['space', 'rmb', 'q', 'f'];
const SLOT_LEVEL = { space: 1, rmb: 1, q: 2, f: 4 };
// Buttons and dialogs keep their own touches: the cluster sees only touches on the game itself.
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="dialog"], [role="alertdialog"]';
// The only boxes a finger scrolls (mobile.css, pan-y): the start and pause panel's text, and the «Монах» sheet.
const SCROLLERS = '.intro-scroll, .monk-content';
// update() runs with every HUD tick and render() with every finger: a value that did not change is not
// written again, so an idle layer dirties no style or layout.
const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const setAttr = (element, name, value) => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
const setStyle = (element, name, value) => { if (element.style[name] !== value) element.style[name] = value; };

export const isCoarse = win => !!win?.matchMedia?.('(pointer: coarse)')?.matches;
export const isIos = nav => /iP(hone|od|ad)/.test(nav?.userAgent ?? '') || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
export const isAndroid = nav => /Android/i.test(nav?.userAgent ?? '');
export const isStandalone = win => win?.navigator?.standalone === true
  || !!win?.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)')?.matches;
// «E — взять припасы» → «Взять припасы»: the touch button has no key names (§5).
export const promptVerb = prompt => {
  const verb = (prompt ?? '').replace(/^E\s*[—–:-]\s*/, '');
  return verb && verb[0].toUpperCase() + verb.slice(1);
};

// Android Chrome after the first touch (§11.5, question 10): full screen without the navigation
// bar, then the landscape lock. Call it from a touch pointerup: a touch pointerdown is not a user
// activation. Resolves true when the page went full screen. iPhone Safari has neither API.
export function enterFullscreen(doc, win) {
  const root = doc?.documentElement;
  if (!root || doc.fullscreenElement || typeof root.requestFullscreen !== 'function') return Promise.resolve(false);
  let request;
  try { request = root.requestFullscreen({ navigationUI: 'hide' }); } catch { return Promise.resolve(false); }
  return Promise.resolve(request).then(async () => {
    try { await win?.screen?.orientation?.lock?.('landscape'); } catch { /* A browser without the lock keeps the rotate screen. */ }
    return true;
  }, () => false);
}

export class TouchUI {
  // touch is the TouchInput. getGame returns the run. onPause pauses a running game and does nothing
  // otherwise: «Пауза», a turn to portrait and a too small screen call it. onScreen hears 'play',
  // 'rotate' and 'small'. onActivate runs once when the layer starts (main.js swaps the labels).
  // onBack hears the system «назад» of Android (question 11).
  constructor({ touch, doc = globalThis.document, win = globalThis.window, getGame = () => null,
    onPause = () => {}, onScreen = () => {}, onActivate = () => {}, onBack = () => {} } = {}) {
    Object.assign(this, { touch, doc, win, getGame, onPause, onScreen, onActivate, onBack });
    this.active = false; this.attached = false; this.screen = null; this.fullscreenTried = false; this.backArmed = false;
    this.slots = {}; this.slotParts = {}; this.parts = {}; this.orbs = {};
    // Individual translation keeps the pixel-snapped control faces out of layout.
    this.translates = !!win?.CSS?.supports?.('translate', '1px 1px');
  }

  // Below 380 px of height a loot line would cover techniques 2 and 3: it joins the notices (§2.4).
  get compactLoot() { return this.active && this.viewport().height < 380; }

  // Under «Поверни телефон» and «Экран слишком мал» nothing may start or resume the run (§11.2).
  get blocked() { return this.active && !!this.screen && this.screen !== 'play'; }

  // Starts at once on a coarse pointer, otherwise on the first touch.
  attach() {
    if (this.attached) return this;
    this.attached = true;
    if (isCoarse(this.win)) this.activate();
    else {
      this.waitForTouch = event => {
        if (event.pointerType !== 'touch') return;
        this.win.removeEventListener('pointerdown', this.waitForTouch, true);
        this.activate();
        this.route('down', event);
      };
      this.win.addEventListener('pointerdown', this.waitForTouch, true);
    }
    return this;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.doc.documentElement.classList.add('touch-ui');
    this.build();
    // The capture phase sees every finger first; buttons and dialogs keep theirs (gameSurface).
    const options = { capture: true, passive: false };
    this.win.addEventListener('pointerdown', event => this.route('down', event), options);
    this.win.addEventListener('pointermove', event => this.route('move', event), options);
    this.win.addEventListener('pointerup', event => this.route('up', event), options);
    this.win.addEventListener('pointercancel', event => this.route('cancel', event), options);
    // Safari ignores preventDefault on pointer events: only a non-passive touchmove stops the page from
    // scrolling, pulling to refresh (a reload loses the WebGL context) and pinching. The scrollers keep theirs.
    this.win.addEventListener('touchmove', event => { if (!this.scroller(event.target)) event.preventDefault(); }, options);
    this.win.addEventListener('gesturestart', event => event.preventDefault());
    for (const type of ['resize', 'orientationchange']) this.win.addEventListener(type, () => this.relayout());
    // iPhone Safari's toolbars resize and move the visible part without a window resize.
    for (const type of ['resize', 'scroll']) this.win.visualViewport?.addEventListener?.(type, () => this.relayout());
    // A call, the shade or another tab (§10.7): every finger lets go; main.js pauses on its own.
    this.win.addEventListener('blur', () => this.release());
    this.doc.addEventListener('visibilitychange', () => { if (this.doc.hidden) this.release(); });
    // «Назад» spends the history entry that a touch armed: «Монах» closes or the game pauses, the page stays.
    this.win.addEventListener('popstate', () => {
      if (!this.backArmed) return;
      this.backArmed = false;
      this.release();
      this.onBack();
    });
    this.relayout();
    this.update();
    this.onActivate();
  }

  build() {
    const h = (tag, props = {}, ...children) => {
      const element = this.doc.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') element.className = value;
        else if (key === 'text') element.textContent = value;
        else if (key === 'html') element.innerHTML = value;
        else element.setAttribute(key, value === true ? '' : value);
      }
      element.append(...children.filter(Boolean));
      return element;
    };
    const pips = className => h('span', { class: `touch-pips ${className}`, 'aria-hidden': 'true' });
    const parts = this.parts;
    parts.stick = h('div', { class: 'touch-stick', 'aria-hidden': 'true' },
      parts.stickBase = h('span', { class: 'touch-stick-base', html: pixelSvg('', '52 52', STICK_BASE_ART) }),
      parts.stickKnob = h('span', { class: 'touch-stick-knob', html: pixelSvg('', '22 22', STICK_KNOB_ART) }));
    parts.aim = h('div', { class: 'touch-aim', 'aria-hidden': 'true', hidden: true },
      parts.aimCircle = h('i', { class: 'touch-aim-circle' }),
      parts.aimLine = h('i', { class: 'touch-aim-line' }),
      parts.aimFinger = h('i', { class: 'touch-aim-finger' }));
    parts.attack = h('div', { class: 'touch-attack', 'data-slot': 'lmb', 'aria-hidden': 'true' },
      h('span', { class: 'touch-ring', html: pixelSvg('', '40 40', ATTACK_ART) }),
      h('span', { class: 'touch-attack-icon', html: spriteIcon('combo') }),
      parts.comboPips = pips('touch-combo'));
    this.slots.lmb = parts.attack;
    for (const slot of TECHNIQUE_BUTTONS) {
      const own = this.slotParts[slot] = {};
      this.slots[slot] = h('div', { class: 'touch-slot', 'data-slot': slot, 'aria-hidden': 'true' },
        h('div', { class: 'touch-well' },
          own.icon = h('span', { class: 'touch-icon-holder' }),
          own.shade = h('i', { class: 'touch-shade' }),
          own.cooldown = h('span', { class: 'touch-cooldown' })),
        h('span', { class: 'touch-lock', html: pixelSvg('', '12 12', '<use href="#icon-lock" />') }),
        own.unlock = h('span', { class: 'touch-unlock' }),
        h('i', { class: 'touch-blank' }),
        h('i', { class: 'touch-new' }),
        own.cost = h('span', { class: 'touch-cost' }),
        slot === 'space' ? (parts.chargePips = pips('touch-charges')) : null);
    }
    parts.interact = h('button', { class: 'touch-interact', type: 'button', hidden: true },
      h('span', { class: 'touch-interact-icon', html: pixelSvg('', '12 12', HAND_ART) }),
      parts.interactCopy = h('span', { class: 'touch-interact-copy' }));
    parts.cancel = h('div', { class: 'touch-cancel', 'aria-hidden': 'true', hidden: true },
      h('span', { class: 'touch-cancel-icon', html: pixelSvg('', '6 6', CROSS_ART) }), h('span', { text: 'Отмена' }));
    parts.monk = h('button', { class: 'touch-monk', type: 'button', 'aria-label': 'Монах' },
      h('span', { class: 'touch-system-icon', html: pixelSvg('', '12 12', MONK_ART) }),
      parts.monkDot = h('i', { class: 'touch-dot', hidden: true }));
    parts.pause = h('button', { class: 'touch-pause', type: 'button', 'aria-label': 'Пауза' },
      h('span', { class: 'touch-system-icon', html: pixelSvg('', '12 12', PAUSE_ART) }));
    parts.play = h('div', { class: 'touch-play' }, parts.stick, parts.aim,
      h('div', { class: 'touch-cluster' }, parts.attack, ...TECHNIQUE_BUTTONS.map(slot => this.slots[slot])),
      parts.interact, parts.cancel, h('div', { class: 'touch-system' }, parts.monk, parts.pause));
    const screen = (className, title, copy, hint) => h('section', { class: `touch-screen ${className}`, role: 'alertdialog',
      'aria-modal': 'true', 'aria-label': title, hidden: true },
    h('div', { class: 'touch-screen-panel' },
      className === 'touch-rotate' ? h('span', { class: 'touch-screen-art', html: pixelSvg('', '40 32', ROTATE_ART) }) : null,
      h('div', { class: 'touch-screen-copy' }, h('h2', { text: title }), h('p', { text: copy })),
      hint ? h('hr') : null, hint ? h('small', { text: hint }) : null));
    parts.rotate = screen('touch-rotate', 'Поверни телефон',
      '«Ночной ритуал» идёт только горизонтально. Игра на паузе и ждёт тебя.',
      'Экран не поворачивается? Сними блокировку поворота: на iPhone — в Пункте управления, на Android — в шторке.');
    parts.small = screen('touch-small', 'Экран слишком мал',
      'Игре нужно хотя бы 568 × 320 точек. Игра на паузе.', 'Закрой лишние панели браузера или открой игру на устройстве побольше.');
    parts.probe = h('i', { class: 'touch-safe', 'aria-hidden': 'true' });
    // The orbs move to the top corners (§4.1) at 29u; the desktop orbs hide on the phone.
    const orb = (kind, label) => {
      const own = this.orbs[kind] = { rows: null };
      return own.element = h('div', { class: `touch-orb touch-orb-${kind}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0' },
        own.art = h('span', { class: 'touch-orb-art', 'aria-hidden': 'true' }),
        h('span', { class: 'touch-orb-plate' }, own.value = h('b'), own.max = h('i')));
    };
    parts.hud = h('div', { class: 'touch-hud' }, orb('health', 'Здоровье'), orb('spirit', 'Дух'));
    parts.layer = h('div', { class: 'touch-layer' }, parts.hud, parts.play, parts.probe);
    // A tap beside the open map closes it. The screens and this closer stand outside the layer:
    // the pause menu (z 7) must not cover them.
    parts.mapClose = h('button', { class: 'touch-map-close', type: 'button', 'aria-label': 'Закрыть карту' });
    this.doc.body.append(parts.layer, parts.mapClose, parts.rotate, parts.small);
    parts.mapClose.addEventListener('click', () => this.showMap(false));
    const pauseMenu = this.doc.getElementById('pause-controls');
    if (pauseMenu) {
      // The map lives in the pause menu on the phone (question 15); the sound is a switch in «Настройки».
      parts.mapButton = h('button', { class: 'touch-tool', type: 'button', text: 'Карта' });
      parts.mapButton.addEventListener('click', () => this.showMap(!this.doc.body.classList.contains('touch-map')));
      const extras = [h('div', { class: 'touch-tools' }, parts.mapButton)];
      // iPhone Safari cannot go full screen from the page: the pause menu explains the home screen (question 10).
      if (isIos(this.win.navigator) && !isStandalone(this.win)) {
        extras.push(parts.homeHint = h('div', { class: 'touch-home-hint' }, h('b', { text: 'На экран «Домой»' }),
          h('span', { text: 'Так игра откроется на весь экран: в Safari нажми «Поделиться», затем «На экран „Домой“».' })));
      }
      // First in the legend: its last paragraph keeps the full-width tips row.
      pauseMenu.prepend(...extras);
    }
    // «E», «Монах» and «Пауза» act on the touch (§6). A click without a pointer is the keyboard.
    const press = (button, act) => {
      button.addEventListener('pointerdown', event => {
        event.preventDefault?.();
        button.classList.add('pressed');
        act();
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, () => button.classList.remove('pressed'));
      button.addEventListener('click', event => { if (event.detail === 0) act(); });
    };
    press(parts.interact, () => this.touch.tap('interact'));
    press(parts.monk, () => this.touch.tap('panel:next'));
    press(parts.pause, () => { this.release(); this.onPause(); });
  }

  // Safe-area insets in CSS px, read from a probe padded with env(safe-area-inset-*).
  safeInsets() {
    const style = this.win.getComputedStyle?.(this.parts.probe);
    const read = name => parseFloat(style?.[name]) || 0;
    return { top: read('paddingTop'), right: read('paddingRight'), bottom: read('paddingBottom'), left: read('paddingLeft') };
  }

  // The visible part of the page in CSS px. iPhone Safari's toolbars cover the bottom of the layout
  // viewport that innerHeight reads; render.js sizes the world from the same visualViewport.
  viewport() {
    const visual = this.win.visualViewport, dpr = this.win.devicePixelRatio || 1;
    const offset = value => Math.round((value ?? 0) * dpr) / dpr;
    return { width: visual?.width ?? this.win.innerWidth, height: visual?.height ?? this.win.innerHeight,
      left: offset(visual?.offsetLeft), top: offset(visual?.offsetTop) };
  }

  unitPx() {
    return parseFloat(this.win.getComputedStyle?.(this.doc.documentElement)?.getPropertyValue?.('--u')) || TOUCH_RULES.u;
  }

  // The screen changed: the rotate or small screen, then the cluster in place.
  relayout() {
    if (!this.active) return;
    const { width, height, left, top } = this.viewport(), state = screenState({ width, height });
    // Read inherited units and safe-area padding before changing the layer's geometry.
    const safe = this.safeInsets(), u = this.unitPx();
    // The layer covers the visible part only, so the thumbs never sit under the toolbar.
    if (this.win.visualViewport) {
      Object.assign(this.parts.layer.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        right: 'auto', bottom: 'auto' });
    }
    this.parts.rotate.hidden = state !== 'rotate';
    this.parts.small.hidden = state !== 'small';
    if (state !== this.screen) {
      this.screen = state;
      // A turn to portrait pauses at once and lets every finger go (§11.2); the turn back keeps the pause.
      if (state !== 'play') { this.release(); this.onPause(); }
      this.onScreen(state);
    }
    const layout = this.touch.resize({ width, height, safe, u });
    for (const [slot, button] of Object.entries(layout.buttons)) {
      const style = this.slots[slot].style;
      style.left = `${Math.round(button.x - button.size / 2)}px`;
      style.top = `${Math.round(button.y - button.size / 2)}px`;
    }
    // «E»: its right edge 6u left of «Шаг», its bottom on the bottom of «Шаг» (§4.2).
    const dash = layout.buttons.space, interact = this.parts.interact.style;
    interact.right = `${Math.round(width - (dash.x - dash.size / 2 - 6 * layout.u))}px`;
    interact.bottom = `${Math.round(height - (dash.y + dash.size / 2))}px`;
    const chip = layout.cancel, cancel = this.parts.cancel.style;
    Object.assign(cancel, { left: `${Math.round(chip.left)}px`, top: `${Math.round(chip.top)}px`,
      width: `${chip.width}px`, height: `${chip.height}px` });
    this.render();
  }

  // Every finger lets go; an open map closes with the menu change that called this.
  release() {
    this.touch.clear();
    if (!this.active) return;
    this.showMap(false);
    this.render();
  }

  // The map over the pause menu (question 15). The minimap sizes its canvas on resize, so main.js refits it.
  showMap(open) {
    if (!this.active) return;
    const was = this.doc.body.classList.contains('touch-map');
    this.doc.body.classList.toggle('touch-map', open);
    this.parts.mapButton?.setAttribute('aria-pressed', String(open));
    if (open && !was) this.win.dispatchEvent(new Event('resize'));
  }

  // Android «назад» skips history entries made without a user gesture, so a touch arms one (question 11).
  armBack() {
    if (this.backArmed || typeof this.win.history?.pushState !== 'function') return;
    this.win.history.pushState({ touchBack: true }, '');
    this.backArmed = true;
  }

  // The held technique and rule A's target for Renderer.setTouchView (§8); null without the layer
  // or while the keyboard or the pad is the device in use.
  aimView() {
    return this.active && this.touch.device === 'touch' ? { preview: this.touch.preview, markedTarget: this.touch.markedTarget } : null;
  }

  // A touch pointer event from the window. Only touches that start on the game reach TouchInput, in the
  // coordinates of the layer, which moves with the visible part.
  route(type, event) {
    if (!this.active || event.pointerType !== 'touch') return;
    const { left, top } = this.viewport();
    const point = { pointerId: event.pointerId, x: event.clientX - left, y: event.clientY - top };
    if (type === 'down') {
      if (!this.gameSurface(event.target)) return;
      if (this.touch.pointerDown(point)) event.preventDefault?.();
    } else if (type === 'move') {
      this.touch.pointerMove(point);
      if (!this.scroller(event.target)) event.preventDefault?.();
    } else if (type === 'up') {
      this.touch.pointerUp(point);
      this.armBack();
      if (!this.fullscreenTried && isAndroid(this.win.navigator)) {
        this.fullscreenTried = true;
        enterFullscreen(this.doc, this.win);
      }
    } else this.touch.clear();
    this.render();
  }

  gameSurface(target) { return !target?.closest?.(INTERACTIVE); }
  scroller(target) { return !!target?.closest?.(SCROLLERS); }

  // The stick, the pressed buttons and the aim circle. Pointer events call it; update() too.
  render() {
    const layout = this.touch.layout;
    if (!this.active || !layout) return;
    const u = layout.u, parts = this.parts, view = this.touch.stickView;
    parts.stick.classList.toggle('held', view.held);
    const place = (element, x, y, size, translate = this.translates) => {
      const left = Math.round(x - size / 2), top = Math.round(y - size / 2);
      if (translate) setStyle(element, 'translate', `${left}px ${top}px`);
      else {
        setStyle(element, 'left', `${left}px`);
        setStyle(element, 'top', `${top}px`);
      }
    };
    place(parts.stickBase, view.baseX, view.baseY, TOUCH_RULES.stickBase * u);
    place(parts.stickKnob, view.baseX + view.knobX, view.baseY + view.knobY, TOUCH_RULES.stickKnob * u);
    const pressed = this.touch.pressed;
    for (const [slot, element] of Object.entries(this.slots)) element.classList.toggle('pressed', pressed.has(slot));
    const aim = this.touch.aiming;
    setHidden(parts.aim, !aim);
    setHidden(parts.cancel, !aim);
    parts.cancel.classList.toggle('over', !!aim?.cancel);
    if (!aim) return;
    // Dashed curves retain their original rasterization at the edge pixels.
    place(parts.aimCircle, aim.buttonX, aim.buttonY, TOUCH_RULES.aimRadius * 2 * u, false);
    place(parts.aimFinger, aim.x, aim.y, TOUCH_RULES.stickKnob * u, false);
    const dx = aim.x - aim.buttonX, dy = aim.y - aim.buttonY;
    Object.assign(parts.aimLine.style, { left: `${Math.round(aim.buttonX)}px`, top: `${Math.round(aim.buttonY - u / 2)}px`,
      width: `${Math.round(Math.hypot(dx, dy))}px`, transform: `rotate(${Math.atan2(dy, dx)}rad)` });
    parts.aimLine.hidden = aim.cancel;
  }

  // Slot states, series pips, «E» and the «Монах» dot (§4, §5.2 states). main.js calls it with the HUD.
  // newSkills holds techniques not cast since they were learned; newItems counts unseen bag items.
  update(game = this.getGame(), { newSkills = new Set(), newItems = 0 } = {}) {
    if (!this.active || !game) return;
    const view = game.loadout ? game : { ...game, loadout: createLoadout() };
    const p = game.player, spirit = p?.spirit ?? MONK_RULES.spirit.initial;
    // The same readings as the desktop orbs: a living monk never reads 0 health.
    if (p) {
      this.updateOrb('health', Math.ceil(p.hp), p.maxHp, { low: p.hp < 35 });
      this.updateOrb('spirit', Math.floor(spirit), p.maxSpirit ?? MONK_RULES.spirit.max, { drained: spirit < 1 });
    }
    for (const state of slotStates(view)) {
      if (state.slot === 'lmb') continue;
      const element = this.slots[state.slot], own = this.slotParts[state.slot], { skill, locked } = state;
      const params = skill ? skillParams(view, skill) : null;
      element.classList.toggle('locked', locked);
      element.classList.toggle('empty', !locked && !skill);
      element.classList.toggle('new', !locked && !!skill && newSkills.has(skill));
      element.classList.toggle('insufficient', !locked && !!params && params.cost > spirit);
      if (skill && own.skill !== skill) { own.icon.innerHTML = spriteIcon(skill); own.skill = skill; }
      setText(own.unlock, locked ? `ур. ${SLOT_LEVEL[state.slot]}` : '');
      setText(own.cost, !locked && params?.cost ? String(params.cost) : '');
      // With charges the cooldown is recharge debt: the slot waits only when no charge is left.
      // The shade scales from the bottom (mobile.css), which repaints without a layout.
      const wait = params ? Math.max(0, state.cooldown - (params.charges - 1) * params.cooldown) : 0;
      const share = params?.cooldown > 0 ? String(Math.min(1, wait / params.cooldown)) : '0';
      if (own.shade.style.getPropertyValue('--shade') !== share) own.shade.style.setProperty('--shade', share);
      setText(own.cooldown, wait > .05 ? wait.toFixed(1) : '');
      if (state.slot === 'space') {
        const charges = params?.charges ?? 1, left = params ? charges - Math.ceil(state.cooldown / params.cooldown - 1e-9) : 0;
        this.fillPips(this.parts.chargePips, charges < 2 ? 0 : charges, i => i < left);
      }
    }
    // Series pips under «Удар»: 3 for the staff and bare hands, 4 for knuckles.
    const strikes = weaponCombo(game.inventory?.equipped?.weapon ?? null).strikes;
    this.fillPips(this.parts.comboPips, strikes, i => !!p?.attack && i <= p.attack.index);
    const verb = game.phase === 'playing' ? promptVerb(getInteractionPrompt(game)) : '';
    setHidden(this.parts.interact, !verb);
    setText(this.parts.interactCopy, verb);
    setHidden(this.parts.monkDot, !((game.progression ? unspentPoints(game.progression) : 0) > 0 || newItems > 0));
    this.render();
  }

  updateOrb(kind, value, max, { low = false, drained = false } = {}) {
    const own = this.orbs[kind], rows = orbRows(value, max);
    if (own.rows !== rows) { own.art.innerHTML = pixelSvg('', '29 29', orbArt(kind, rows)); own.rows = rows; }
    own.element.classList.toggle('low', low);
    own.element.classList.toggle('drained', drained);
    setAttr(own.element, 'aria-valuenow', String(value));
    setAttr(own.element, 'aria-valuemax', String(max));
    setText(own.value, String(value));
    setText(own.max, ` / ${max}`);
  }

  fillPips(holder, count, on) {
    if (holder.children.length !== count) holder.replaceChildren(...Array.from({ length: count }, () => this.doc.createElement('i')));
    setHidden(holder, count === 0);
    [...holder.children].forEach((pip, i) => pip.classList.toggle('on', on(i)));
  }
}
