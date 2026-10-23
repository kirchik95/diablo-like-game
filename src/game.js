import { SPAWN, EXIT, SHRINE, HOUND_SPAWNS, moveBody, findPath, clearLine } from './world.js';
import { WRAITH_STATS, WRAITH_TIMINGS, BEETLE_STATS, BEETLE_TIMINGS, ADVENTURE_RULES } from './campaign.js';
import { createOverworld, DEFAULT_WORLD_SEED, getOverworldZone } from './overworld.js';
import { MONK_RULES } from './monk-combat.js';
import { approachTarget, crowdSeparation, firingAdjustment } from './enemy-steering.js';

const normalize = (x, y) => {
  const d = Math.hypot(x, y);
  return d > 0.001 ? [x / d, y / d] : [0, -1];
};

export function createGame() {
  return {
    phase: 'playing', time: 0, kills: 0, shrineUsed: false, events: [], effects: [], pickups: [],
    player: {
      ...SPAWN, radius: .23, hp: 100, maxHp: 100, dx: 0, dy: -1, moving: false,
      combo: 0, comboTimer: 0, attack: null, dashTime: 0, dashCooldown: 0,
      waveCooldown: 0, invulnerable: 0, hitFlash: 0, distance: 0,
      spirit: MONK_RULES.spirit.initial, maxSpirit: MONK_RULES.spirit.max,
    },
    enemies: HOUND_SPAWNS.map((p, id) => ({
      ...p, homeX: p.x, homeY: p.y, id, kind: 'hound', radius: .29,
      hp: MONK_RULES.enemyHp.hound, maxHp: MONK_RULES.enemyHp.hound,
      state: 'idle', timer: 0, attackCooldown: id * .17, dx: 0, dy: 1,
      hit: false, hitFlash: 0, path: [], repath: 0, distance: 0,
    })),
  };
}

function adventureEnemy(definition) {
  const hp = definition.kind === 'ritual' ? ADVENTURE_RULES.ritualHp : MONK_RULES.enemyHp[definition.kind];
  const radius = definition.kind === 'ritual' ? .45 : definition.kind === 'beetle' ? BEETLE_STATS.radius : .29;
  return {
    ...definition, homeX: definition.x, homeY: definition.y, radius,
    hp, maxHp: hp, state: definition.kind === 'ritual' ? 'sealed' : 'idle',
    ...(definition.kind === 'ritual' ? { sealed: true } : {}),
    ...(definition.kind === 'beetle' ? { exposed: false, breakImmunity: 0 } : {}),
    timer: 0, attackCooldown: 0, dx: 0, dy: 1, hit: false, hitFlash: 0, path: [], repath: 0, distance: 0,
  };
}

export function createAdventure(appearance = {}, { seed = DEFAULT_WORLD_SEED } = {}) {
  const game = createGame();
  game.appearance = { skin: appearance.skin ?? 'warm', hair: appearance.hair ?? 'shaved', sash: appearance.sash ?? 'wine' };
  game.adventure = { quest: 'outbound', secretFound: false, rewardCollected: false,
    visited: ['camp'], totalKills: 0, elapsed: 0 };
  game.world = createOverworld(seed);
  game.seed = game.world.seed;
  game.enemies = [...game.world.encounters,
    { ...game.world.ritual, id: 'court-ritual', kind: 'ritual', zoneId: 'courtyard' }].map(adventureEnemy);
  // Compatibility views share bodies; there are no per-area simulation snapshots.
  game._locations = Object.fromEntries(game.world.zones.map(zone => [zone.id, {
    enemies: game.enemies.filter(e => e.zoneId === zone.id),
    get kills() { return game.enemies.filter(e => e.zoneId === zone.id && e.kind !== 'ritual' && e.hp <= 0).length; },
    get shrineUsed() { return zone.id === 'road' && game.shrineUsed; },
  }]));
  game.locationId = getOverworldZone(game.world.spawn.x, game.world.spawn.y).id;
  game.locationRevision = 0;
  game.projectiles = []; game._nextProjectileId = 0;
  Object.assign(game.player, game.world.spawn);
  return game;
}

function interaction(game) {
  if (!game.adventure || game.phase !== 'playing' || game.player.hp <= 0) return null;
  const choices = [];
  if (game.world.secret && !game.adventure.secretFound) choices.push({ ...game.world.secret, type: 'secret' });
  if (game.world.reward && game.adventure.quest === 'return' && !game.adventure.rewardCollected) {
    choices.push({ ...game.world.reward, type: 'reward' });
  }
  return choices.filter(point => Math.hypot(point.x - game.player.x, point.y - game.player.y) <= ADVENTURE_RULES.interactionRadius
    && clearLine(game.player, point, .05, game.world))
    .sort((a, b) => Math.hypot(a.x - game.player.x, a.y - game.player.y) - Math.hypot(b.x - game.player.x, b.y - game.player.y))[0] ?? null;
}

export function getInteractionPrompt(game) {
  const target = interaction(game);
  if (!target) return '';
  return target.type === 'secret' ? 'E — открыть тайник' : 'E — получить янтарную бусину';
}

export function getObjective(game) {
  if (!game.adventure) return { title: 'Очисти дорогу', copy: `Гончие: ${game.kills} / ${game.enemies.length}` };
  const quest = game.adventure.quest;
  if (quest === 'complete') return { title: 'Янтарная бусина', copy: 'Источник разрушен. Награда получена — путь завершён.' };
  if (quest === 'return') return { title: 'Вернись к огню', copy: 'Источник разрушен. Вернись в лагерь и получи янтарную бусину.' };
  if (quest === 'ritual') {
    const sealed = game.enemies.some(e => e.kind === 'ritual' && e.sealed);
    return { title: sealed ? 'Разорви печать' : 'Погаси источник',
      copy: game.locationId !== 'courtyard' ? 'Вернись во двор монастыря и погаси источник.'
        : sealed ? 'Победи стражей монастыря, чтобы открыть источник для ударов.' : 'Разрушь открытый источник ударами или духовной волной.' };
  }
  return { title: 'Дорога к монастырю', copy: 'Пройди разбитую дорогу. Боковая тропа скрывает тайник и святилище.' };
}

export function interact(game) {
  const target = interaction(game);
  if (!target) return false;
  if (target.type === 'secret') {
    game.adventure.secretFound = true;
    const oldHp = game.player.hp;
    game.player.hp = Math.min(game.player.maxHp, oldHp + ADVENTURE_RULES.cacheHeal);
    emit(game, 'secret', target.x, target.y, { amount: game.player.hp - oldHp });
  } else {
    game.adventure.rewardCollected = true; game.adventure.quest = 'complete'; game.phase = 'victory';
    emit(game, 'reward', target.x, target.y, { amount: 1, item: 'amber-bead' });
    emit(game, 'victory', target.x, target.y);
  }
  return true;
}

function openRitual(game) {
  if (!game.adventure) return;
  const ritual = game.enemies.find(e => e.kind === 'ritual');
  if (ritual?.sealed && !game.enemies.some(e => e.zoneId === 'courtyard' && e.kind !== 'ritual' && e.hp > 0)) {
    ritual.sealed = false; ritual.state = 'idle';
    emit(game, 'ritual-open', ritual.x, ritual.y, { id: ritual.id });
  }
}

function emit(game, type, x, y, extra = {}) {
  const event = { type, x, y, ...extra };
  game.events.push(event);
  game.effects.push({ ...event, age: 0, life: type === 'death' ? 1.2 : type === 'damage' ? .7 : .5 });
}

export function startAttack(game, dx, dy) {
  const p = game.player;
  if (game.phase !== 'playing' || p.attack || p.dashTime > 0) return false;
  [p.dx, p.dy] = normalize(dx, dy);
  const index = p.comboTimer > 0 ? p.combo : 0;
  p.attack = { index, age: 0, struck: false, dx: p.dx, dy: p.dy };
  p.combo = (index + 1) % 3;
  p.comboTimer = MONK_RULES.combo.resetTime;
  emit(game, 'swing', p.x, p.y, { dx: p.dx, dy: p.dy, index, strength: index === 2 ? 'heavy' : 'light', source: 'combo' });
  return true;
}

export function startDash(game, dx, dy) {
  const p = game.player;
  if (game.phase !== 'playing' || p.dashCooldown > 0) return false;
  [p.dx, p.dy] = normalize(dx, dy);
  p.dashTime = MONK_RULES.dash.duration;
  p.dashCooldown = MONK_RULES.dash.cooldown;
  p.dashHits = new Set();
  p.attack = null;
  emit(game, 'dash', p.x, p.y, { dx: p.dx, dy: p.dy });
  return true;
}

// An exposed shell takes every hit in full and keeps its stun timer. Otherwise dash and wave
// break it, except during breakImmunity; any other hit from inside the front arc is blocked.
function beetleGuard(enemy, dx, dy, source, origin) {
  if (enemy.exposed) return 'exposed';
  if ((source === 'dash' || source === 'wave') && !(enemy.breakImmunity > 0)) return 'break';
  const ox = origin ? origin.x - enemy.x : 0, oy = origin ? origin.y - enemy.y : 0;
  const [sx, sy] = Math.hypot(ox, oy) > .001 ? normalize(ox, oy) : [-dx, -dy];
  return sx * enemy.dx + sy * enemy.dy >= BEETLE_STATS.guardDot ? 'block' : 'open';
}

// Ordinary strikes never stagger the shell; only a guard break stuns it. Returns true on a break.
function reactBeetle(enemy, guard) {
  if (enemy.hp <= 0) { enemy.state = 'dead'; enemy.exposed = false; return false; }
  if (guard === 'break') {
    enemy.state = 'stunned'; enemy.exposed = true; enemy.timer = BEETLE_TIMINGS.exposed;
    return true;
  }
  if (enemy.state === 'idle') enemy.state = 'chase';
  return false;
}

// Returns false when nothing was hit, 'blocked' when a shell blocked the hit, otherwise 'hit'.
function hitEnemy(game, enemy, damage, dx, dy, knockback, source, strength = 'light', origin = null) {
  if (enemy.hp <= 0 || enemy.sealed) return false;
  const guard = enemy.kind === 'beetle' ? beetleGuard(enemy, dx, dy, source, origin) : null;
  const blocked = guard === 'block';
  if (blocked) { damage = Math.round(damage * BEETLE_STATS.blockDamage); knockback *= BEETLE_STATS.blockKnockback; }
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.hitFlash = .16;
  let broke = false;
  if (guard) broke = reactBeetle(enemy, guard);
  else {
    enemy.state = enemy.hp > 0 ? (enemy.kind === 'ritual' ? 'idle' : 'stunned') : 'dead';
    enemy.timer = enemy.kind === 'wraith' ? WRAITH_TIMINGS.stunned : .38;
  }
  if (enemy.packId) enemy.active = true;
  if (enemy.kind === 'beetle') moveShell(game, enemy, dx * knockback, dy * knockback);
  else if (enemy.kind !== 'ritual') moveEnemy(game, enemy, dx * knockback, dy * knockback);
  emit(game, 'damage', enemy.x, enemy.y, { amount: damage, enemy: true, source, strength, ...(blocked ? { blocked } : {}) });
  emit(game, blocked ? 'block' : 'impact', enemy.x, enemy.y, { id: enemy.id, dx, dy, source, strength });
  if (broke) emit(game, 'guard-break', enemy.x, enemy.y, { id: enemy.id, dx, dy, source });
  if (enemy.hp === 0) {
    if (enemy.kind === 'ritual') {
      game.adventure.quest = 'return';
      emit(game, 'ritual-destroyed', enemy.x, enemy.y, { id: enemy.id });
    } else {
      game.kills++;
      if (game.adventure) game.adventure.totalKills++;
      if (game.kills % MONK_RULES.pickup.every === 0) {
        game.pickups.push({ id: `health-${game.kills}`, x: enemy.x, y: enemy.y, amount: MONK_RULES.pickup.amount });
      }
    }
    emit(game, 'death', enemy.x, enemy.y, { id: enemy.id });
  }
  return blocked ? 'blocked' : 'hit';
}

export function startWave(game) {
  const p = game.player;
  if (game.phase !== 'playing' || p.waveCooldown > 1e-9 || p.dashTime > 0 || p.spirit < MONK_RULES.wave.cost) return false;
  p.waveCooldown = MONK_RULES.wave.cooldown;
  p.spirit -= MONK_RULES.wave.cost;
  p.attack = null;
  emit(game, 'wave', p.x, p.y, { source: 'wave', strength: 'heavy' });
  for (const enemy of game.enemies) {
    const d = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    if (d <= MONK_RULES.wave.radius && clearLine(p, enemy, .05, game.world)) {
      const [dx, dy] = normalize(enemy.x - p.x, enemy.y - p.y);
      hitEnemy(game, enemy, MONK_RULES.wave.damage, dx, dy, MONK_RULES.wave.knockback, 'wave', 'heavy', p);
    }
  }
  openRitual(game);
  return true;
}

function damagePlayer(game, enemy, amount = 16) {
  const p = game.player;
  if (p.invulnerable > 0 || p.dashTime > 0 || game.phase !== 'playing' || inSafeArea(game, p)) return;
  p.hp = Math.max(0, p.hp - amount);
  p.invulnerable = .55;
  p.hitFlash = .22;
  emit(game, 'hurt', p.x, p.y);
  emit(game, 'damage', p.x, p.y, { amount, enemy: false });
  moveBody(p, enemy.dx * .18, enemy.dy * .18, game.world);
  if (p.hp === 0) { game.phase = 'defeat'; p.attack = null; emit(game, 'defeat', p.x, p.y); }
}

const PACK_RULES = { aggro: 7, alert: 12, active: 24, leash: 14, playerLeash: 18, returnSpeed: 2.2 };
function inSafeArea(game, body, radius = 0) {
  const area = game.world?.safeArea;
  return !!area && body.y + radius >= area.minY && body.y - radius <= area.maxY;
}

function moveEnemy(game, enemy, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .12));
  for (let i = 0; i < steps; i++) {
    if (enemy.packId && inSafeArea(game, { y: enemy.y + dy / steps }, enemy.radius)) break;
    moveBody(enemy, dx / steps, dy / steps, game.world);
  }
}

// Removes the part of a step that would carry `body` deeper into a solid circle, so the body
// slides along it. A body already inside may always move outward or along the edge.
function slideAround(body, sx, sy, solid, contact) {
  const ox = body.x - solid.x, oy = body.y - solid.y, distance = Math.hypot(ox, oy);
  if (distance < 1e-6 || Math.hypot(ox + sx, oy + sy) >= contact) return [sx, sy];
  const nx = ox / distance, ny = oy / distance, inward = sx * nx + sy * ny;
  return inward < 0 ? [sx - nx * inward, sy - ny * inward] : [sx, sy];
}

// True when a move from (ox, oy) ended deeper inside the solid circle, e.g. after a wall slide.
function movedDeeper(body, ox, oy, solid, contact) {
  const after = Math.hypot(body.x - solid.x, body.y - solid.y);
  return after < contact && after < Math.hypot(ox - solid.x, oy - solid.y) - 1e-9;
}

// The shell is solid both ways: a beetle walk or knockback slides along the monk and never
// ends deeper inside him. Short steps keep a long knockback from tunnelling through him.
function moveShell(game, enemy, dx, dy) {
  const p = game.player, contact = enemy.radius + p.radius;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .12));
  for (let i = 0; i < steps; i++) {
    const [sx, sy] = slideAround(enemy, dx / steps, dy / steps, p, contact);
    const ox = enemy.x, oy = enemy.y;
    moveEnemy(game, enemy, sx, sy);
    if (movedDeeper(enemy, ox, oy, p, contact)) { enemy.x = ox; enemy.y = oy; }
  }
}

// Living beetles are solid for the monk's walk; hounds, wraiths and the dash pass through.
// Bodies never push the monk, so only his own walkable steps can move him.
function movePlayer(game, dx, dy) {
  const p = game.player, solids = game.enemies.filter(e => e.kind === 'beetle' && e.hp > 0);
  if (!solids.length) { moveBody(p, dx, dy, game.world); return; }
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .12));
  for (let i = 0; i < steps; i++) {
    let sx = dx / steps, sy = dy / steps;
    for (const e of solids) [sx, sy] = slideAround(p, sx, sy, e, p.radius + e.radius);
    const ox = p.x, oy = p.y;
    moveBody(p, sx, sy, game.world);
    // A wall slide can still turn the step into a shell; then this sub-step is cancelled.
    if (solids.some(e => movedDeeper(p, ox, oy, e, p.radius + e.radius))) { p.x = ox; p.y = oy; }
  }
}

function activatePacks(game) {
  if (!game.world?.safeArea || inSafeArea(game, game.player)) return;
  const triggers = game.enemies.filter(e => e.packId && e.hp > 0 && !e.returning
    && Math.hypot(e.x - game.player.x, e.y - game.player.y) < PACK_RULES.aggro
    && clearLine(e, game.player, .05, game.world));
  for (const trigger of triggers) for (const e of game.enemies) {
    if (e.hp <= 0 || e.active || e.returning || e.packId !== trigger.packId
      || Math.hypot(e.x - trigger.x, e.y - trigger.y) > PACK_RULES.alert) continue;
    e.active = true;
    if (e.state === 'idle') e.state = 'chase';
    emit(game, 'alert', e.x, e.y, { id: e.id, packId: e.packId });
  }
}

function returnOrSleep(game, e, dt, separation) {
  if (!e.packId || !game.world?.safeArea) return false;
  if (!e.active && !e.returning) return true;
  const homeDistance = Math.hypot(e.x - e.homeX, e.y - e.homeY);
  if (inSafeArea(game, game.player) || homeDistance > PACK_RULES.leash
    || Math.hypot(game.player.x - e.homeX, game.player.y - e.homeY) > PACK_RULES.playerLeash
    || Math.hypot(e.x - game.player.x, e.y - game.player.y) > PACK_RULES.active) e.returning = true;
  if (!e.returning) return false;
  // Finish the committed action before returning; separation must never slide a telegraph.
  if (e.state !== 'chase' && e.state !== 'idle') return false;
  // Return on foot with the same collision as combat. Never restore HP or teleport.
  e.state = 'chase';
  if (homeDistance < 1e-6) {
    e.active = false; e.returning = false; e.state = 'idle';
    e.timer = 0; e.attackCooldown = .5; e.path = []; e.repath = 0;
  } else {
    // A shell keeps its slow turn on the way home and, as in chase, shuffles until it faces home.
    // Other monsters face home at once.
    const [hx, hy] = normalize(e.homeX - e.x, e.homeY - e.y);
    let speed = PACK_RULES.returnSpeed;
    if (e.kind === 'beetle') {
      turnToward(e, { x: e.homeX, y: e.homeY }, BEETLE_STATS.turnRate * dt);
      speed *= Math.max(BEETLE_STATS.minTurnSpeed, hx * e.dx + hy * e.dy);
    } else [e.dx, e.dy] = [hx, hy];
    const weight = Math.max(0, Math.min(1, (homeDistance - .35) / .85));
    chase(game, e, { x: e.homeX, y: e.homeY }, dt, speed,
      separation && { x: separation.x * weight, y: separation.y * weight });
  }
  return true;
}

function trackArea(game) {
  if (!game.adventure) return;
  const zone = getOverworldZone(game.player.x, game.player.y);
  if (zone.id === game.locationId) return;
  const from = game.locationId;
  game.locationId = zone.id;
  if (!game.adventure.visited.includes(zone.id)) game.adventure.visited.push(zone.id);
  if (zone.id === 'courtyard' && game.adventure.quest === 'outbound') game.adventure.quest = 'ritual';
  emit(game, 'area-enter', game.player.x, game.player.y, { from, to: zone.id, title: zone.title });
}

function updateDash(game, dt) {
  const p = game.player, duration = Math.min(dt, p.dashTime);
  const steps = Math.max(1, Math.ceil(MONK_RULES.dash.speed * duration / .1));
  p.dashHits ??= new Set();
  for (let i = 0; i < steps; i++) {
    const from = { x: p.x, y: p.y };
    moveBody(p, p.dx * MONK_RULES.dash.speed * duration / steps, p.dy * MONK_RULES.dash.speed * duration / steps, game.world);
    const dx = p.x - from.x, dy = p.y - from.y, length2 = dx * dx + dy * dy;
    for (const e of game.enemies) {
      if (e.hp <= 0 || e.sealed || p.dashHits.has(e.id)) continue;
      const t = length2 ? Math.max(0, Math.min(1, ((e.x - from.x) * dx + (e.y - from.y) * dy) / length2)) : 0;
      const contact = { x: from.x + dx * t, y: from.y + dy * t };
      if (Math.hypot(e.x - contact.x, e.y - contact.y) <= p.radius + e.radius && clearLine(contact, e, .05, game.world)) {
        p.dashHits.add(e.id);
        hitEnemy(game, e, MONK_RULES.dash.damage, p.dx, p.dy, MONK_RULES.dash.knockback, 'dash', 'heavy', contact);
      }
    }
  }
  p.dashTime = Math.max(0, p.dashTime - duration);
  if (p.dashTime < 1e-9) p.dashTime = 0;
}

function collectPickups(game) {
  const p = game.player;
  game.pickups = game.pickups.filter(pickup => {
    if (Math.hypot(pickup.x - p.x, pickup.y - p.y) > MONK_RULES.pickup.radius || !clearLine(p, pickup, .05, game.world)) return true;
    const oldHp = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + pickup.amount);
    emit(game, 'pickup', pickup.x, pickup.y, { id: pickup.id, amount: p.hp - oldHp, source: 'pickup' });
    emit(game, 'heal', p.x, p.y, { amount: p.hp - oldHp, source: 'pickup' });
    return false;
  });
}

function chase(game, enemy, target, dt, speed, separation) {
  let waypoint = target;
  if (!clearLine(enemy, target, enemy.radius, game.world)) {
    enemy.repath -= dt;
    if (enemy.repath <= 0 && game._pathBudget > 0) {
      game._pathBudget--;
      enemy.path = findPath(enemy, target, enemy.radius, game.world).slice(1); enemy.repath = .5;
    }
    if (enemy.path.length) {
      while (enemy.path.length > 1 && clearLine(enemy, enemy.path[1], enemy.radius, game.world)) enemy.path.shift();
      if (Math.hypot(enemy.path[0].x - enemy.x, enemy.path[0].y - enemy.y) < .22) enemy.path.shift();
      if (enemy.path.length) waypoint = enemy.path[0];
    }
  }
  let dx = waypoint.x - enemy.x, dy = waypoint.y - enemy.y;
  const distance = Math.hypot(dx, dy), travel = Math.min(speed, dt > 0 ? distance / dt : 0);
  if (distance > 1e-8) { dx *= travel / distance; dy *= travel / distance; }
  else { dx = 0; dy = 0; }
  dx += separation?.x ?? 0; dy += separation?.y ?? 0;
  const velocity = Math.hypot(dx, dy);
  if (velocity > speed) { dx *= speed / velocity; dy *= speed / velocity; }
  const ox = enemy.x, oy = enemy.y;
  if (enemy.kind === 'beetle') moveShell(game, enemy, dx * dt, dy * dt);
  else moveEnemy(game, enemy, dx * dt, dy * dt);
  enemy.distance += Math.hypot(enemy.x - ox, enemy.y - oy);
}

function updateWraith(game, enemy, dt, separation) {
  const p = game.player, distance = Math.hypot(p.x - enemy.x, p.y - enemy.y);
  enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
  if (enemy.state === 'idle') {
    if (distance < WRAITH_STATS.aggroRange) { enemy.state = 'chase'; emit(game, 'alert', enemy.x, enemy.y); }
    return;
  }
  if (enemy.state === 'stunned' || enemy.state === 'recover') {
    enemy.timer -= dt;
    if (enemy.timer <= 1e-9) { enemy.state = 'chase'; enemy.attackCooldown = .25; }
    return;
  }
  if (enemy.state === 'windup') {
    enemy.timer -= dt;
    if (enemy.timer <= 1e-9) {
      const shot = { id: `shot-${game._nextProjectileId++}`, x: enemy.x, y: enemy.y,
        dx: enemy.dx, dy: enemy.dy, radius: WRAITH_STATS.shotRadius, life: WRAITH_STATS.shotLife };
      game.projectiles.push(shot);
      emit(game, 'shot', shot.x, shot.y, { id: shot.id, dx: shot.dx, dy: shot.dy });
      enemy.state = 'recover'; enemy.timer = WRAITH_TIMINGS.recover;
    }
    return;
  }
  [enemy.dx, enemy.dy] = normalize(p.x - enemy.x, p.y - enemy.y);
  const canShoot = clearLine(enemy, p, WRAITH_STATS.shotRadius, game.world);
  if (distance <= WRAITH_STATS.attackRange && canShoot && enemy.attackCooldown <= 0) {
    enemy.state = 'windup'; enemy.timer = WRAITH_TIMINGS.windup;
    emit(game, 'windup', enemy.x, enemy.y, { id: enemy.id, kind: 'wraith', dx: enemy.dx, dy: enemy.dy });
    return;
  }
  const target = distance > WRAITH_STATS.attackRange || !canShoot
    ? approachTarget(enemy, p, game.world) : firingAdjustment(enemy, p, separation, game.world);
  chase(game, enemy, target, dt, WRAITH_STATS.speed, separation);
}

function updateProjectiles(game, dt) {
  if (!game.projectiles) return;
  const active = [], p = game.player;
  for (const shot of game.projectiles) {
    shot.life -= dt;
    if (shot.life <= 0) continue;
    const distance = WRAITH_STATS.shotSpeed * dt, steps = Math.max(1, Math.ceil(distance / .1));
    let spent = false;
    for (let i = 0; i < steps; i++) {
      const next = { x: shot.x + shot.dx * distance / steps, y: shot.y + shot.dy * distance / steps };
      if (inSafeArea(game, next) || !clearLine(shot, next, shot.radius, game.world)) { spent = true; break; }
      // Segment/circle contact covers the gaps between samples even at coarse dt.
      const sx = next.x - shot.x, sy = next.y - shot.y, length2 = sx * sx + sy * sy;
      const along = length2 ? Math.max(0, Math.min(1, ((p.x - shot.x) * sx + (p.y - shot.y) * sy) / length2)) : 0;
      if (Math.hypot(p.x - shot.x - sx * along, p.y - shot.y - sy * along) <= p.radius + shot.radius) {
        damagePlayer(game, shot, WRAITH_STATS.shotDamage); spent = true; break;
      }
      shot.x = next.x; shot.y = next.y;
    }
    if (!spent) active.push(shot);
  }
  game.projectiles = active;
}

// Rotate the facing toward a point by at most maxTurn radians.
function turnToward(e, target, maxTurn) {
  if (Math.hypot(target.x - e.x, target.y - e.y) < 1e-6) return;
  const [tx, ty] = normalize(target.x - e.x, target.y - e.y);
  const angle = Math.atan2(e.dx * ty - e.dy * tx, e.dx * tx + e.dy * ty);
  if (Math.abs(angle) <= maxTurn) { e.dx = tx; e.dy = ty; return; }
  const turn = Math.sign(angle) * maxTurn, cos = Math.cos(turn), sin = Math.sin(turn);
  [e.dx, e.dy] = normalize(e.dx * cos - e.dy * sin, e.dx * sin + e.dy * cos);
}

function slamReaches(game, e, p) {
  const distance = Math.hypot(p.x - e.x, p.y - e.y);
  if (distance > BEETLE_STATS.slamRange || !clearLine(e, p, .05, game.world)) return false;
  return distance < e.radius * .5 || ((p.x - e.x) * e.dx + (p.y - e.y) * e.dy) / distance >= BEETLE_STATS.slamDot;
}

function updateBeetle(game, e, dt, separation) {
  const p = game.player, distance = Math.hypot(p.x - e.x, p.y - e.y);
  e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  if (e.state === 'idle') {
    if (distance < BEETLE_STATS.aggroRange) { e.state = 'chase'; emit(game, 'alert', e.x, e.y); }
    return;
  }
  // Facing stays locked through stun and every committed attack state.
  if (e.state === 'stunned' || e.state === 'recover') {
    e.timer -= dt;
    if (e.timer <= 1e-9) {
      if (e.exposed) e.breakImmunity = BEETLE_TIMINGS.breakImmunity;
      e.state = 'chase'; e.exposed = false; e.attackCooldown = BEETLE_TIMINGS.cooldown;
    }
    return;
  }
  if (e.state === 'windup') {
    e.timer -= dt;
    if (e.timer <= 1e-9) {
      e.state = 'slam'; e.timer = BEETLE_TIMINGS.slam; e.hit = false;
      emit(game, 'slam', e.x, e.y, { id: e.id, dx: e.dx, dy: e.dy });
    }
    return;
  }
  if (e.state === 'slam') {
    if (!e.hit && slamReaches(game, e, p)) { e.hit = true; damagePlayer(game, e, BEETLE_STATS.slamDamage); }
    e.timer -= dt;
    if (e.timer <= 1e-9) { e.state = 'recover'; e.timer = BEETLE_TIMINGS.recover; }
    return;
  }
  // The slow turn is the counterplay: a monk who circles fast enough reaches the open back.
  const lineOfSight = clearLine(e, p, .05, game.world);
  const facingTarget = lineOfSight || !e.path.length ? p : e.path[0];
  turnToward(e, facingTarget, BEETLE_STATS.turnRate * dt);
  const toPlayer = distance > 1e-6 ? ((p.x - e.x) * e.dx + (p.y - e.y) * e.dy) / distance : 1;
  if (distance < BEETLE_STATS.attackRange && toPlayer >= BEETLE_STATS.attackDot && e.attackCooldown <= 0 && lineOfSight) {
    e.state = 'windup'; e.timer = BEETLE_TIMINGS.windup;
    emit(game, 'windup', e.x, e.y, { id: e.id, kind: 'beetle', dx: e.dx, dy: e.dy });
    return;
  }
  const target = distance > BEETLE_STATS.holdRange ? approachTarget(e, p, game.world) : e;
  const [fx, fy] = normalize(facingTarget.x - e.x, facingTarget.y - e.y);
  // A beetle walks forward at full speed and shuffles slowly while it still turns.
  const alignment = Math.max(BEETLE_STATS.minTurnSpeed, fx * e.dx + fy * e.dy);
  chase(game, e, target, dt, BEETLE_STATS.speed * alignment, separation);
}

function updateEnemy(game, e, dt, separation) {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  if (e.kind === 'beetle') e.breakImmunity = Math.max(0, (e.breakImmunity ?? 0) - dt);
  if (e.hp <= 0 || e.kind === 'ritual') return;
  if (returnOrSleep(game, e, dt, separation)) return;
  if (e.kind === 'wraith') { updateWraith(game, e, dt, separation); return; }
  if (e.kind === 'beetle') { updateBeetle(game, e, dt, separation); return; }
  const p = game.player;
  e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  const distance = Math.hypot(p.x - e.x, p.y - e.y);
  if (e.state === 'idle') {
    if (distance < 4.5) { e.state = 'chase'; emit(game, 'alert', e.x, e.y); }
    return;
  }
  if (e.state === 'stunned' || e.state === 'recover') {
    e.timer -= dt;
    if (e.timer <= 0) { e.state = 'chase'; e.attackCooldown = .25; }
    return;
  }
  if (e.state === 'windup') {
    e.timer -= dt;
    if (e.timer <= 0) { e.state = 'leap'; e.timer = .27; e.hit = false; emit(game, 'leap', e.x, e.y); }
    return;
  }
  if (e.state === 'leap') {
    e.timer -= dt;
    // Short steps keep the hit volume continuous even when the render rate drops.
    const steps = Math.max(1, Math.ceil(9 * dt / .12));
    for (let i = 0; i < steps; i++) {
      moveEnemy(game, e, e.dx * 9 * dt / steps, e.dy * 9 * dt / steps);
      if (!e.hit && Math.hypot(p.x - e.x, p.y - e.y) < .68) { e.hit = true; damagePlayer(game, e); }
    }
    if (e.timer <= 0) { e.state = 'recover'; e.timer = .7; }
    return;
  }
  [e.dx, e.dy] = normalize(p.x - e.x, p.y - e.y);
  // A larger hound only needs to reach its hit radius, not occupy the monk's
  // exact position when the monk is standing close to a column or an edge.
  const contact = { x: p.x - e.dx * Math.min(.5, distance), y: p.y - e.dy * Math.min(.5, distance) };
  const canReachContact = clearLine(e, contact, e.radius, game.world);
  if (distance < 2.15 && e.attackCooldown <= 0 && canReachContact) {
    e.state = 'windup';
    e.timer = .55;
    emit(game, 'windup', e.x, e.y, { dx: e.dx, dy: e.dy });
    return;
  }
  const target = distance > .85 || !canReachContact ? approachTarget(e, p, game.world) : e;
  chase(game, e, target, dt, 1.75, separation);
}

export function updateGame(game, input, dt) {
  if (game.phase !== 'playing') return;
  dt = Math.min(Math.max(dt, 0), .05);
  game.time += dt;
  if (game.adventure) game.adventure.elapsed += dt;
  for (const effect of game.effects) effect.age += dt;
  game.effects = game.effects.filter(effect => effect.age < effect.life);
  const p = game.player;
  for (const k of ['dashCooldown', 'waveCooldown', 'invulnerable', 'hitFlash', 'comboTimer']) p[k] = Math.max(0, p[k] - dt);
  const ox = p.x, oy = p.y;
  if (p.dashTime > 0) {
    updateDash(game, dt);
  } else {
    let mx = input.moveX || 0, my = input.moveY || 0;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const speed = MONK_RULES.moveSpeed * (p.attack ? MONK_RULES.attackMoveMultiplier : 1);
    movePlayer(game, mx * speed * dt, my * speed * dt);
    // A running monk faces the travel heading, so the run cycle never plays backwards;
    // a standing monk turns to the aim. Attacks still lock facing to their own aim.
    if (!p.attack && Math.hypot(p.x - ox, p.y - oy) > .001) [p.dx, p.dy] = normalize(mx, my);
    else if (!p.attack && (input.aimX || input.aimY)) [p.dx, p.dy] = normalize(input.aimX, input.aimY);
    if (input.attack && !p.attack) startAttack(game, input.aimX ?? p.dx, input.aimY ?? p.dy);
  }
  p.moving = Math.hypot(p.x - ox, p.y - oy) > .001;
  p.distance += Math.hypot(p.x - ox, p.y - oy);
  if (p.attack) {
    const a = p.attack;
    a.age += dt;
    if (!a.struck && a.age + 1e-9 >= MONK_RULES.combo.hitTime[a.index]) {
      a.struck = true;
      // Spirit is per strike: one unblocked victim earns the full amount, only blocks earn less.
      let gain = 0;
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        const dot = d > .001 ? ((e.x - p.x) * a.dx + (e.y - p.y) * a.dy) / d : 1;
        if (d < MONK_RULES.combo.range[a.index] && dot > MONK_RULES.combo.dot[a.index] && clearLine(p, e, .05, game.world)) {
          const result = hitEnemy(game, e, MONK_RULES.combo.damage[a.index], a.dx, a.dy, MONK_RULES.combo.knockback[a.index],
            'combo', a.index === 2 ? 'heavy' : 'light', p);
          if (result) gain = Math.max(gain, result === 'blocked' ? MONK_RULES.spirit.perBlockedStrike : MONK_RULES.spirit.perStrike);
        }
      }
      if (gain) p.spirit = Math.min(p.maxSpirit, p.spirit + gain);
    }
    if (a.age + 1e-9 >= MONK_RULES.combo.duration[a.index]) p.attack = null;
  }
  game._pathBudget = 3;
  activatePacks(game);
  const separation = crowdSeparation(game.enemies);
  for (const e of game.enemies) updateEnemy(game, e, dt, separation.get(e.id));
  if (game.phase !== 'playing') return;
  updateProjectiles(game, dt);
  if (game.phase !== 'playing') return;
  openRitual(game);
  collectPickups(game);
  trackArea(game);
  const shrine = game.world ? game.world.shrine : SHRINE;
  if (shrine && !game.shrineUsed && p.hp < p.maxHp && Math.hypot(p.x - shrine.x, p.y - shrine.y) < .85) {
    game.shrineUsed = true;
    p.hp = Math.min(p.maxHp, p.hp + 40);
    emit(game, 'heal', p.x, p.y, { source: 'shrine' });
  }
  if (!game.adventure && game.kills === game.enemies.length && Math.hypot(p.x - EXIT.x, p.y - EXIT.y) < .9) {
    game.phase = 'victory';
    emit(game, 'victory', p.x, p.y);
  }
}
