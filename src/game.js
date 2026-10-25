import { SPAWN, EXIT, SHRINE, HOUND_SPAWNS, moveBody, findPath, clearLine, isWalkable, warmNavigation } from './world.js';
import { WRAITH_STATS, WRAITH_TIMINGS, BEETLE_STATS, BEETLE_TIMINGS, ADVENTURE_RULES, CAMP_SUPPLIES } from './campaign.js';
import { createOverworld, DEFAULT_WORLD_SEED, getOverworldZone } from './overworld.js';
import { MONK_RULES } from './monk-combat.js';
import { approachTarget, crowdSeparation, firingAdjustment } from './enemy-steering.js';
import { createProgression, monsterLevelForZone, scaleMonsterDamage, scaleMonsterHp } from './progression.js';
import { RELICS, UNARMED_COMBO, WEAPON_FAMILIES, createInventory, rollRunLoot } from './items.js';
import { TECHNIQUE_SLOTS, beetleHit, canCast, createLoadout, unlockedSlots } from './skills.js';
import { emit } from './game-events.js';
import {
  awardXp, monkDamage, monkStats, setSkillCooldown, skillCooldown, skillParams, skillScale,
} from './run-progress.js';
import { claimCampSupplies, collectGroundItems, dropSiteLoot } from './inventory-actions.js';

const normXY = [0, -1];
const slideXY = [0, 0];
const beetleSolids = [];
const packIds = new Set();
const packTriggers = [];
const touched = [];
const stepPoint = { x: 0, y: 0 };
// Math.hypot is at least each absolute component, so a separated axis matches the compare.
const hypotLess = (x, y, limit) => Math.abs(x) >= limit || Math.abs(y) >= limit ? false : Math.hypot(x, y) < limit;
const hypotAtMost = (x, y, limit) => Math.abs(x) > limit || Math.abs(y) > limit ? false : Math.hypot(x, y) <= limit;
const hypotGreater = (x, y, limit) => Math.abs(x) > limit || Math.abs(y) > limit ? true : Math.hypot(x, y) > limit;
const hypotAtLeast = (x, y, limit) => Math.abs(x) >= limit || Math.abs(y) >= limit ? true : Math.hypot(x, y) >= limit;
const normalize = (x, y) => {
  const d = Math.hypot(x, y);
  if (!(d > 0.001)) { normXY[0] = 0; normXY[1] = -1; return normXY; }
  normXY[0] = x / d; normXY[1] = y / d;
  return normXY;
};
// Base hits at monster level 1; the zone's monster level scales them (§6.1). Any other
// melee body fights like a hound.
const MONSTER_DAMAGE = { hound: 16, wraith: WRAITH_STATS.shotDamage, beetle: BEETLE_STATS.slamDamage };
const monsterDamage = enemy => scaleMonsterDamage(MONSTER_DAMAGE[enemy.kind] ?? MONSTER_DAMAGE.hound, enemy.level ?? 1);
// Palms and reflected shots; the 8 px palm silhouette is a quarter unit wide.
const MONK_SHOT_RADIUS = .15;
const comboOf = family => family ? WEAPON_FAMILIES[family].combo : UNARMED_COMBO;
// Crane flight, the deflect stance and a whiffed stance's lockout stop strikes, the dash and techniques.
const busy = p => !!p.technique || p.lockout > 1e-9;

export function createGame() {
  return {
    phase: 'playing', time: 0, kills: 0, shrineUsed: false, events: [], effects: [], pickups: [],
    player: {
      ...SPAWN, radius: .23, hp: 100, maxHp: 100, dx: 0, dy: -1, moving: false,
      combo: 0, comboTimer: 0, attack: null, dashTime: 0, dashCooldown: 0,
      waveCooldown: 0, invulnerable: 0, hitFlash: 0, distance: 0,
      spirit: MONK_RULES.spirit.initial, maxSpirit: MONK_RULES.spirit.max,
      // cooldowns: seconds left per technique other than the wave. technique: the crane flight
      // or the deflect stance in progress, { id, t, duration, params, ... }. lockout: whiff seconds.
      // lastBreathCooldown: seconds until «Последний вздох» can trigger again.
      cooldowns: {}, technique: null, lockout: 0, lastBreathCooldown: 0,
    },
    // No saves in v1: a new run (createGame/createAdventure) starts all of this at level 1.
    // newTechniques: techniques learned without a free slot that the player has not slotted yet.
    progression: createProgression(), inventory: createInventory(), loadout: createLoadout(), newTechniques: [],
    groundItems: [], monkShots: [], _nextShotId: 0,
    enemies: HOUND_SPAWNS.map((p, id) => ({
      ...p, homeX: p.x, homeY: p.y, id, kind: 'hound', radius: .29,
      hp: MONK_RULES.enemyHp.hound, maxHp: MONK_RULES.enemyHp.hound,
      state: 'idle', timer: 0, attackCooldown: id * .17, dx: 0, dy: 1,
      hit: false, hitFlash: 0, path: [], repath: 0, distance: 0,
    })),
  };
}

// Monsters take the monster level of their zone (§6.1); the ritual source is not a monster.
function adventureEnemy(definition) {
  const ritual = definition.kind === 'ritual', level = ritual ? null : monsterLevelForZone(definition.zoneId);
  const hp = ritual ? ADVENTURE_RULES.ritualHp : scaleMonsterHp(MONK_RULES.enemyHp[definition.kind], level);
  const radius = ritual ? .45 : definition.kind === 'beetle' ? BEETLE_STATS.radius : .29;
  return {
    ...definition, homeX: definition.x, homeY: definition.y, radius, ...(ritual ? {} : { level }),
    hp, maxHp: hp, state: ritual ? 'sealed' : 'idle',
    ...(definition.kind === 'ritual' ? { sealed: true } : {}),
    ...(definition.kind === 'beetle' ? { exposed: false, breakImmunity: 0 } : {}),
    timer: 0, attackCooldown: 0, dx: 0, dy: 1, hit: false, hitFlash: 0, path: [], repath: 0, distance: 0,
  };
}

// Caches and shrines by id (world-expansion §6.2). A world without world.caches and world.shrines
// keeps its one cache, 'secret', and its one shrine, 'road-shrine'.
const cachesOf = world => world.caches ?? (world.secret ? [{ id: 'secret', ...world.secret }] : []);
const shrinesOf = world => world.shrines ?? (world.shrine ? [{ id: 'road-shrine', ...world.shrine }] : []);
// adventure.cachesFound and game.shrinesUsed exist only beside those arrays. Without them secretFound
// and shrineUsed alone hold the state, and game.adventure and the events stay as the simulation
// goldens hashed them.
const cacheFound = (game, id) => game.adventure.cachesFound?.includes(id) ?? (id === 'secret' && game.adventure.secretFound);
const shrineSpent = (game, id) => game.shrinesUsed?.includes(id) ?? (id === 'road-shrine' && game.shrineUsed);

// §6.1: the prompt and the notice of each cache.
export const CACHE_TEXT = Object.freeze({
  secret: Object.freeze({ prompt: 'E — открыть тайник', notice: 'Найден тайник забытой тропы' }),
  'cemetery-cache': Object.freeze({ prompt: 'E — открыть реликварий', notice: 'Найден реликварий старого кладбища' }),
  'orchard-cache': Object.freeze({ prompt: 'E — открыть тайник садовника', notice: 'Найден тайник садовника' }),
});
const cacheText = id => CACHE_TEXT[id] ?? CACHE_TEXT.secret;

// «Тайники N из M» in the run summary.
export function cacheProgress(game) {
  const caches = cachesOf(game.world);
  return { found: caches.filter(cache => cacheFound(game, cache.id)).length, total: caches.length };
}

export function createAdventure(appearance = {}, { seed = DEFAULT_WORLD_SEED } = {}) {
  const game = createGame();
  game.appearance = { skin: appearance.skin ?? 'warm', hair: appearance.hair ?? 'shaved', sash: appearance.sash ?? 'wine' };
  game.world = createOverworld(seed);
  game.seed = game.world.seed;
  game.adventure = { quest: 'outbound', secretFound: false, ...(game.world.caches && { cachesFound: [] }), rewardCollected: false,
    visited: ['camp'], totalKills: 0, elapsed: 0 };
  if (game.world.shrines) game.shrinesUsed = [];
  game.enemies = [...game.world.encounters,
    { ...game.world.ritual, id: 'court-ritual', kind: 'ritual', zoneId: 'courtyard' }].map(adventureEnemy);
  // Compatibility views share bodies; there are no per-area simulation snapshots.
  game._locations = Object.fromEntries(game.world.zones.map(zone => [zone.id, {
    enemies: game.enemies.filter(e => e.zoneId === zone.id),
    get kills() { return game.enemies.filter(e => e.zoneId === zone.id && e.kind !== 'ritual' && e.hp <= 0).length; },
    get shrineUsed() { return shrineSpent(game, `${zone.id}-shrine`); },
  }]));
  game.locationId = getOverworldZone(game.world.spawn.x, game.world.spawn.y).id;
  game.locationRevision = 0;
  game.projectiles = []; game._nextProjectileId = 0;
  // Every drop is rolled now from the run seed (§3.5); lootClaimed lists the sites already given.
  game.loot = rollRunLoot(game.seed); game.lootClaimed = [];
  Object.assign(game.player, game.world.spawn);
  warmGameNavigation(game);
  return game;
}

// Radii that search for a path. The ritual source never does. Order is the encounter order.
export function warmGameNavigation(game) {
  const radii = [];
  for (const enemy of game?.enemies ?? []) {
    if (enemy.kind === 'ritual' || radii.includes(enemy.radius)) continue;
    radii.push(enemy.radius);
  }
  warmNavigation(game?.world, radii);
}

function interaction(game) {
  if (!game.adventure || game.phase !== 'playing' || game.player.hp <= 0) return null;
  const choices = [], camp = game.world.zones?.find(zone => zone.id === 'camp');
  if (camp && game.loot && !game.lootClaimed.includes('camp-supplies')) {
    choices.push({ x: CAMP_SUPPLIES.x + camp.offset.x, y: CAMP_SUPPLIES.y + camp.offset.y, type: 'supplies' });
  }
  for (const cache of cachesOf(game.world)) if (!cacheFound(game, cache.id)) choices.push({ ...cache, type: 'secret' });
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
  return target.type === 'secret' ? cacheText(target.id).prompt : target.type === 'supplies' ? 'E — взять припасы'
    : 'E — получить янтарную бусину';
}

// The side zones' own objective until the source falls. The orchard opens from the courtyard, so the quest
// is 'ritual' there. No compass words: this camera shows west up-right and east down-left, so the way out
// names the road or the courtyard.
const SIDE_OBJECTIVES = Object.freeze({
  cemetery: Object.freeze({ cache: 'cemetery-cache', title: 'Старое кладбище',
    copy: 'Необязательное место. Реликварий спрятан среди могил.', found: 'Реликварий открыт. Путь к монастырю — назад к дороге.' }),
  orchard: Object.freeze({ cache: 'orchard-cache', title: 'Сад обители',
    copy: 'Необязательное место. Тайник садовника — у дальней стены.', found: 'Тайник открыт. Путь к источнику — назад во двор.' }),
});

export function getObjective(game) {
  if (!game.adventure) return { title: 'Очисти дорогу', copy: `Гончие: ${game.kills} / ${game.enemies.length}` };
  const quest = game.adventure.quest;
  if (quest === 'complete') return { title: 'Янтарная бусина', copy: 'Источник разрушен. Награда получена — путь завершён.' };
  if (quest === 'return') return { title: 'Вернись к огню', copy: 'Источник разрушен. Вернись в лагерь и получи янтарную бусину.' };
  const side = SIDE_OBJECTIVES[game.locationId];
  if (side) return { title: side.title, copy: cacheFound(game, side.cache) ? side.found : side.copy };
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
    // A cache id is its loot site id (§6.3).
    const listed = !!game.world.caches;
    if (listed) (game.adventure.cachesFound ??= []).push(target.id);
    if (target.id === 'secret') game.adventure.secretFound = true;
    const oldHp = game.player.hp;
    game.player.hp = Math.min(game.player.maxHp, oldHp + ADVENTURE_RULES.cacheHeal);
    emit(game, 'secret', target.x, target.y, { amount: game.player.hp - oldHp, ...(listed && { cache: target.id }) });
    awardXp(game, 'secret', target);
    dropSiteLoot(game, target.id, target);
  } else if (target.type === 'supplies') {
    claimCampSupplies(game, target);
  } else {
    game.adventure.rewardCollected = true; game.adventure.quest = 'complete'; game.phase = 'victory';
    emit(game, 'reward', target.x, target.y, { amount: 1, item: 'amber-bead' });
    emit(game, 'victory', target.x, target.y);
  }
  return true;
}

// The courtyard guards hold the seal; courtyard wanderers do not.
function openRitual(game) {
  if (!game.adventure) return;
  const ritual = game.enemies.find(e => e.kind === 'ritual');
  if (ritual?.sealed && !game.enemies.some(e => e.zoneId === 'courtyard' && e.kind !== 'ritual' && !e.wander && e.hp > 0)) {
    ritual.sealed = false; ritual.state = 'idle';
    emit(game, 'ritual-open', ritual.x, ritual.y, { id: ritual.id });
  }
}

// The equipped weapon's series (§3.2); bare hands keep MONK_RULES.combo. An armed attack
// records its weapon family and relic, and every attack records the item part of its strike
// (gear: weapon power, combo damage and spirit affixes), so an equip during the swing never changes it.
export function startAttack(game, dx, dy) {
  const p = game.player;
  if (game.phase !== 'playing' || p.attack || p.dashTime > 0 || busy(p)) return false;
  [p.dx, p.dy] = normalize(dx, dy);
  const weapon = game.inventory?.equipped.weapon ?? null, combo = comboOf(weapon?.family), stats = monkStats(game);
  const index = p.comboTimer > 0 && p.combo < combo.strikes ? p.combo : 0;
  p.attack = { index, age: 0, struck: false, dx: p.dx, dy: p.dy,
    gear: { weaponPower: stats.weaponPower, comboDamage: stats.comboDamage, spiritPerStrike: stats.spiritPerStrike },
    ...(weapon ? { weapon: weapon.family, strikes: combo.strikes, ...(weapon.relic ? { relic: weapon.relic } : {}) } : {}) };
  p.combo = (index + 1) % combo.strikes;
  p.comboTimer = combo.resetTime;
  emit(game, 'swing', p.x, p.y, { dx: p.dx, dy: p.dy, index, strength: index === combo.strikes - 1 ? 'heavy' : 'light',
    source: 'combo', ...(weapon ? { weapon: weapon.family } : {}) });
  return true;
}

// With charges the cooldown is recharge debt: the dash stays ready while one charge remains.
export function startDash(game, dx, dy) {
  const p = game.player;
  if (game.phase !== 'playing' || busy(p)) return false;
  const params = skillParams(game, 'dash');
  if (p.dashCooldown > (params.charges - 1) * params.cooldown + 1e-9) return false;
  [p.dx, p.dy] = normalize(dx, dy);
  p.dashTime = params.duration;
  p.dashCooldown = params.charges > 1 ? p.dashCooldown + params.cooldown : params.cooldown;
  p.dashHits = new Set(); p.dashSpirit = 0;
  p.attack = null;
  emit(game, 'dash', p.x, p.y, { dx: p.dx, dy: p.dy });
  return true;
}

// An exposed shell takes every hit in full and keeps its stun timer. Otherwise beetleHit (§2.4)
// decides: a shell-breaking hit breaks it, except during breakImmunity; any other hit from inside
// the front arc, seen from origin, is blocked. Dash and wave break; options name other rules.
function beetleGuard(enemy, dx, dy, source, origin, { shell = 'block', deflectedSlam = false,
  shellBreak = source === 'dash' || source === 'wave' } = {}) {
  if (enemy.exposed) return 'exposed';
  const ox = origin ? origin.x - enemy.x : 0, oy = origin ? origin.y - enemy.y : 0;
  const [sx, sy] = Math.hypot(ox, oy) > .001 ? normalize(ox, oy) : [-dx, -dy];
  const { blocked, breaks } = beetleHit({ shell, shellBreak }, { front: sx * enemy.dx + sy * enemy.dy >= BEETLE_STATS.guardDot,
    breakImmune: enemy.breakImmunity > 0, deflectedSlam });
  return breaks ? 'break' : blocked ? 'block' : 'open';
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
// options: beetleGuard rules; openShell multiplies a shell hit that is not blocked («Пробой»);
// stun replaces the stun time of a hound or wraith.
function hitEnemy(game, enemy, damage, dx, dy, knockback, source, strength = 'light', origin = null, options = {}) {
  if (enemy.hp <= 0 || enemy.sealed) return false;
  const guard = enemy.kind === 'beetle' ? beetleGuard(enemy, dx, dy, source, origin, options) : null;
  const blocked = guard === 'block';
  if (blocked) { damage = Math.round(damage * BEETLE_STATS.blockDamage); knockback *= BEETLE_STATS.blockKnockback; }
  else if (guard && options.openShell) damage = Math.round(damage * options.openShell);
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.hitFlash = .16;
  let broke = false;
  if (guard) broke = reactBeetle(enemy, guard);
  else {
    enemy.state = enemy.hp > 0 ? (enemy.kind === 'ritual' ? 'idle' : 'stunned') : 'dead';
    enemy.timer = options.stun ?? (enemy.kind === 'wraith' ? WRAITH_TIMINGS.stunned : .38);
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
        game.pickups.push({ id: `health-${game.kills}`, x: enemy.x, y: enemy.y, amount: monkStats(game).pickupHeal });
      }
    }
    emit(game, 'death', enemy.x, enemy.y, { id: enemy.id });
    if (enemy.kind === 'ritual') sourceDestroyed(game, enemy);
    else monsterKilled(game, enemy);
  }
  return blocked ? 'blocked' : 'hit';
}

// §4.1, §3.5: experience for the kill, kill effects of items and the path, and when the last
// monster of a pack falls, the pack bonus and its item where that monster died. Wanderers give
// monster experience only: no pack bonus, notice or item.
function monsterKilled(game, enemy) {
  const p = game.player, stats = monkStats(game);
  awardXp(game, enemy.kind, enemy, enemy.level ?? 1);
  if (stats.hpPerKill > 0) p.hp = Math.min(p.maxHp, p.hp + stats.hpPerKill);
  if (stats.killSpirit > 0) p.spirit = Math.min(p.maxSpirit, p.spirit + stats.killSpirit);
  if (enemy.packId && !enemy.wander && !game.enemies.some(e => e.packId === enemy.packId && e.hp > 0)) {
    emit(game, 'pack-cleared', enemy.x, enemy.y, { packId: enemy.packId });
    awardXp(game, 'pack', enemy);
    dropSiteLoot(game, enemy.packId, enemy);
  }
  // The burst comes after the pack check: when it kills a pack's last monster, only that
  // monster's own call clears the pack, so a pack is cleared exactly once.
  if (enemy.mark) explodeMark(game, enemy);
}

// The source item lands on free ground beside the plinth, on the monk's side.
function sourceDestroyed(game, source) {
  awardXp(game, 'ritual', source);
  const p = game.player, [dx, dy] = normalize(p.x - source.x, p.y - source.y);
  const beside = { x: source.x + dx * (source.radius + .3), y: source.y + dy * (source.radius + .3) };
  dropSiteLoot(game, source.id, isWalkable(beside.x, beside.y, .1, game.world) ? beside : { x: p.x, y: p.y });
}

// The wave reads its modifier (§2.6): heavy, vortex (pulls first) or calm (heals per monster hit).
export function startWave(game) {
  const p = game.player, params = skillParams(game, 'wave');
  if (game.phase !== 'playing' || p.waveCooldown > 1e-9 || p.dashTime > 0 || busy(p) || p.spirit < params.cost) return false;
  p.waveCooldown = params.cooldown;
  p.spirit -= params.cost;
  p.attack = null;
  if (params.pullRadius > 0) pullEnemies(game, params);
  emit(game, 'wave', p.x, p.y, { source: 'wave', strength: 'heavy' });
  let hits = 0;
  for (const enemy of game.enemies) {
    const d = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    if (d <= params.radius && clearLine(p, enemy, .05, game.world)) {
      const [dx, dy] = normalize(enemy.x - p.x, enemy.y - p.y);
      if (hitEnemy(game, enemy, monkDamage(game, params.damage, 'technique', enemy), dx, dy, params.knockback,
        'wave', 'heavy', p) && enemy.kind !== 'ritual') hits++;
    }
  }
  if (params.healPerHit > 0 && hits) {
    const oldHp = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + Math.min(params.healCap, params.healPerHit * hits));
    emit(game, 'wave-heal', p.x, p.y, { amount: p.hp - oldHp });
  }
  openRitual(game);
  return true;
}

// «Вихревая волна»: living monsters in pullRadius walk to pullTo from the monk, with collision.
function pullEnemies(game, params) {
  const p = game.player;
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (e.hp <= 0 || e.kind === 'ritual' || d <= params.pullTo || d > params.pullRadius || !clearLine(p, e, .05, game.world)) continue;
    const [dx, dy] = normalize(p.x - e.x, p.y - e.y), travel = d - params.pullTo;
    if (e.kind === 'beetle') moveShell(game, e, dx * travel, dy * travel);
    else moveEnemy(game, e, dx * travel, dy * travel);
  }
}

// Returns 'hit', 'deflected', 'airborne' (the crane flight passes over every attack) or 'ignored'.
// shot: the wraith projectile that reached the monk, so a deflect can send it back.
function damagePlayer(game, enemy, amount = MONSTER_DAMAGE.hound, shot = null) {
  const p = game.player;
  if (game.phase !== 'playing' || inSafeArea(game, p)) return 'ignored';
  if (p.technique?.id === 'deflect') { deflectAttack(game, enemy, shot); return 'deflected'; }
  if (p.technique?.id === 'crane') return 'airborne';
  if (p.invulnerable > 0 || p.dashTime > 0) return 'ignored';
  const stats = game.progression ? monkStats(game) : null;
  if (stats) amount = Math.round(amount * stats.damageTaken);
  p.hp = Math.max(0, p.hp - amount);
  p.invulnerable = .55;
  p.hitFlash = .22;
  emit(game, 'hurt', p.x, p.y);
  emit(game, 'damage', p.x, p.y, { amount, enemy: false });
  moveBody(p, enemy.dx * .18, enemy.dy * .18, game.world);
  if (p.hp === 0) { game.phase = 'defeat'; p.attack = null; emit(game, 'defeat', p.x, p.y); }
  else if (stats?.lastBreath) lastBreath(game, stats.lastBreath);
  return 'hit';
}

// «Последний вздох» (§4.5): a hit that leaves the monk alive below hpBelow of his maximum
// health gives `invulnerable` seconds instead of the usual hit grace, once per `cooldown`.
function lastBreath(game, rule) {
  const p = game.player;
  if ((p.lastBreathCooldown ?? 0) > 1e-9 || p.hp >= p.maxHp * rule.hpBelow) return;
  p.invulnerable = Math.max(p.invulnerable, rule.invulnerable);
  p.lastBreathCooldown = rule.cooldown;
  emit(game, 'last-breath', p.x, p.y, { invulnerable: rule.invulnerable, cooldown: rule.cooldown });
}

// Slot casting. RMB, Q and F cast the technique the loadout puts there (§2.1). Returns
// { ok, skill } or { ok: false, skill, reason } with reason 'locked', 'empty', 'phase',
// 'spirit', 'cooldown', 'busy' (dash, flight, stance, lockout) or 'unavailable' (not in v1).
export function useSlot(game, slot, aimX = game.player.dx, aimY = game.player.dy) {
  const p = game.player, skill = game.loadout?.slots[slot] ?? null;
  const fail = reason => ({ ok: false, skill, reason });
  if (!TECHNIQUE_SLOTS.includes(slot) || !unlockedSlots(game.progression?.level ?? 1).includes(slot)) return fail('locked');
  if (!skill) return fail('empty');
  if (game.phase !== 'playing') return fail('phase');
  if (!CASTS[skill]) return fail('unavailable');
  const params = skillParams(game, skill), cooldown = skillCooldown(game, skill);
  if (p.spirit < params.cost) return fail('spirit');
  if (!canCast(game.loadout, slot, { spirit: p.spirit, cooldowns: { [skill]: cooldown }, dashing: p.dashTime > 0,
    scale: { ...skillScale(game), damage: 1 } })) return fail(cooldown > 1e-9 ? 'cooldown' : 'busy');
  if (busy(p)) return fail('busy');
  return CASTS[skill](game, params, aimX, aimY) ? { ok: true, skill } : fail('busy');
}

// Every technique interrupts the current strike, as the wave does (§2.3).
function spend(game, skill, params, cooldown = params.cooldown) {
  const p = game.player;
  p.spirit -= params.cost; p.attack = null;
  setSkillCooldown(game, skill, skillCooldown(game, skill) + cooldown);
}

// «Ладонь духа»: palms fly from the monk toward the aim; a fan spreads them ±spreadDegrees.
function castPalm(game, params, aimX, aimY) {
  const p = game.player;
  spend(game, 'palm', params);
  [p.dx, p.dy] = normalize(aimX, aimY);
  const spread = params.spreadDegrees * Math.PI / 180;
  for (let i = 0; i < params.projectiles; i++) {
    const angle = (i - (params.projectiles - 1) / 2) * spread, cos = Math.cos(angle), sin = Math.sin(angle);
    game.monkShots.push({ id: `palm-${game._nextShotId++}`, kind: 'palm', x: p.x, y: p.y,
      dx: p.dx * cos - p.dy * sin, dy: p.dx * sin + p.dy * cos, radius: MONK_SHOT_RADIUS, speed: params.speed,
      range: params.range, travelled: 0, damage: params.damage, knockback: params.knockback, pierce: params.pierce,
      hits: [], mark: params.markDuration > 0
        ? { t: params.markDuration, radius: params.explosionRadius, damage: params.explosionDamage } : null });
  }
  emit(game, 'palm', p.x, p.y, { dx: p.dx, dy: p.dy, count: params.projectiles });
  return true;
}

// «Прыжок журавля»: the landing is the last walkable point of the aim line, minRange to range
// away. The flight moves the monk on the ground; a renderer lifts the sprite by technique.t.
function castCrane(game, params, aimX, aimY) {
  const p = game.player, [dx, dy] = normalize(aimX, aimY);
  const reach = Math.min(params.range, Math.max(params.minRange, Math.hypot(aimX, aimY)));
  const steps = Math.ceil(reach / .1);
  let to = { x: p.x, y: p.y };
  for (let i = 1; i <= steps; i++) {
    const point = { x: p.x + dx * reach * i / steps, y: p.y + dy * reach * i / steps };
    if (!isWalkable(point.x, point.y, p.radius, game.world) || !clearLine(p, point, p.radius, game.world)) break;
    to = point;
  }
  spend(game, 'crane', params);
  [p.dx, p.dy] = [dx, dy];
  p.technique = { id: 'crane', t: 0, duration: params.flightTime, params, fromX: p.x, fromY: p.y, toX: to.x, toY: to.y };
  emit(game, 'crane', p.x, p.y, { toX: to.x, toY: to.y, duration: params.flightTime, radius: params.radius });
  return true;
}

// «Отражение»: a stance of `window` seconds. It may start during the dash and ends it.
// The cooldown starts when the window closes (see updateStance).
function castDeflect(game, params) {
  const p = game.player;
  spend(game, 'deflect', params, 0);
  p.dashTime = 0;
  p.technique = { id: 'deflect', t: 0, duration: params.window, params, success: false };
  emit(game, 'deflect', p.x, p.y, { dx: p.dx, dy: p.dy, window: params.window });
  return true;
}

const CASTS = { wave: game => startWave(game), palm: castPalm, crane: castCrane, deflect: castDeflect };

function updateCrane(game, dt) {
  const p = game.player, flight = p.technique, ox = p.x, oy = p.y;
  flight.t = Math.min(flight.duration, flight.t + dt);
  const f = flight.duration > 0 ? flight.t / flight.duration : 1;
  p.x = flight.fromX + (flight.toX - flight.fromX) * f;
  p.y = flight.fromY + (flight.toY - flight.fromY) * f;
  p.distance += Math.hypot(p.x - ox, p.y - oy);
  if (flight.t < flight.duration - 1e-9) return;
  p.technique = null;
  // The monk never lands inside a shell: he steps out along the line from its centre.
  for (const e of game.enemies) {
    const d = Math.hypot(p.x - e.x, p.y - e.y), contact = p.radius + e.radius;
    if (e.kind !== 'beetle' || e.hp <= 0 || d >= contact) continue;
    const [nx, ny] = d > 1e-6 ? normalize(p.x - e.x, p.y - e.y) : [-p.dx, -p.dy];
    moveBody(p, nx * (contact - d + 1e-3), ny * (contact - d + 1e-3), game.world);
  }
  const land = { x: p.x, y: p.y }, params = flight.params;
  emit(game, 'crane-land', land.x, land.y, { radius: params.radius });
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - land.x, e.y - land.y);
    if (d > params.radius || !clearLine(land, e, .05, game.world)) continue;
    const [dx, dy] = d > 1e-6 ? normalize(e.x - land.x, e.y - land.y) : [p.dx, p.dy];
    hitEnemy(game, e, monkDamage(game, params.damage, 'technique', e), dx, dy, params.knockback, 'crane', 'heavy', land,
      { shell: params.shell, shellBreak: params.shellBreak });
  }
  openRitual(game);
}

// The window closes after `duration`. A stance that deflected nothing leaves a whiff lockout.
function updateStance(game, dt) {
  const p = game.player, stance = p.technique;
  stance.t += dt;
  if (stance.t < stance.duration - 1e-9) return;
  p.technique = null;
  setSkillCooldown(game, 'deflect', stance.params.cooldown);
  if (!stance.success) {
    p.lockout = stance.params.whiffLockout;
    emit(game, 'deflect-whiff', p.x, p.y, { lockout: p.lockout });
  }
}

// A hit inside the window deals no damage. The first success of a stance gives spirit; every
// deflected attack is answered: a melee attacker (or every monster in riposteRadius) takes the
// riposte and the stun, a deflected beetle slam breaks the shell, and a shot flies back.
function deflectAttack(game, attacker, shot) {
  const p = game.player, stance = p.technique, params = stance.params;
  if (!stance.success) {
    stance.success = true;
    p.spirit = Math.min(p.maxSpirit, p.spirit + params.spiritOnSuccess);
    if (params.resetsDash) p.dashCooldown = 0;
  }
  emit(game, 'deflect-success', p.x, p.y, { kind: shot ? 'shot' : attacker.kind, id: shot ? shot.id : attacker.id });
  if (shot) {
    const owner = game.enemies.find(e => e.id === shot.owner && e.hp > 0);
    const [dx, dy] = owner ? normalize(owner.x - p.x, owner.y - p.y) : [-shot.dx, -shot.dy];
    game.monkShots.push({ id: `reflected-${game._nextShotId++}`, kind: 'reflected', x: p.x, y: p.y, dx, dy,
      radius: shot.radius, speed: WRAITH_STATS.shotSpeed, range: WRAITH_STATS.shotSpeed * WRAITH_STATS.shotLife,
      travelled: 0, damage: params.reflectDamage, knockback: .2, pierce: false, hits: [], mark: null });
    return;
  }
  const targets = params.riposteRadius > 0
    ? game.enemies.filter(e => e.kind !== 'ritual' && e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= params.riposteRadius
      && clearLine(p, e, .05, game.world))
    : [attacker];
  if (!targets.includes(attacker)) targets.push(attacker);
  for (const e of targets) {
    const [dx, dy] = normalize(e.x - p.x, e.y - p.y);
    hitEnemy(game, e, monkDamage(game, params.damage, 'technique', e), dx, dy, MONK_RULES.combo.knockback[2], 'deflect',
      'heavy', p, { shellBreak: params.shellBreak, deflectedSlam: e === attacker && e.kind === 'beetle' && e.state === 'slam',
        stun: params.stun });
  }
}

// Palms and reflected shots stop at walls and scenery like wraith shots. A palm hits the first
// monster it touches (all of them when piercing); a blocking shell front stops any palm. A shot
// starts inside the monk, so a body whose centre lies behind it is never touched.
function updateMonkShots(game, dt) {
  if (!game.monkShots?.length) return;
  const list = game.monkShots;
  let w = 0;
  for (let n = 0; n < list.length; n++) {
    const shot = list[n];
    const distance = Math.min(shot.speed * dt, shot.range - shot.travelled), steps = Math.max(1, Math.ceil(distance / .1));
    let spent = false;
    for (let i = 0; i < steps && !spent; i++) {
      stepPoint.x = shot.x + shot.dx * distance / steps; stepPoint.y = shot.y + shot.dy * distance / steps;
      if (!clearLine(shot, stepPoint, shot.radius, game.world)) { spent = true; break; }
      const sx = stepPoint.x - shot.x, sy = stepPoint.y - shot.y, length2 = sx * sx + sy * sy;
      let hits = 0;
      for (const e of game.enemies) {
        const along = length2 ? Math.max(0, Math.min(1, ((e.x - shot.x) * sx + (e.y - shot.y) * sy) / length2)) : 0;
        const gap = Math.hypot(e.x - shot.x - sx * along, e.y - shot.y - sy * along) - e.radius - shot.radius;
        if (!(gap <= 0 && e.hp > 0 && !e.sealed && !shot.hits.includes(e.id)
          && (e.x - shot.x) * shot.dx + (e.y - shot.y) * shot.dy >= 0)) continue;
        const slot = touched[hits] ??= { e: null, along: 0, gap: 0 };
        slot.e = e; slot.along = along; slot.gap = gap;
        hits++;
      }
      touched.length = hits;
      touched.sort((a, b) => a.along - b.along);
      for (let t = 0; t < touched.length; t++) {
        const e = touched[t].e;
        const from = { x: shot.x, y: shot.y };
        const result = hitEnemy(game, e, monkDamage(game, shot.damage, 'technique', e), shot.dx, shot.dy, shot.knockback,
          shot.kind === 'palm' ? 'palm' : 'deflect', 'light', from);
        shot.hits.push(e.id);
        if (shot.mark && result === 'hit' && e.hp > 0 && e.kind !== 'ritual') e.mark = { ...shot.mark };
        if (!shot.pierce || result === 'blocked') { spent = true; break; }
      }
      if (spent) break;
      shot.x = stepPoint.x; shot.y = stepPoint.y; shot.travelled += distance / steps;
    }
    if (!spent && shot.travelled < shot.range - 1e-9) list[w++] = shot;
    else emit(game, 'shot-fade', shot.x, shot.y, { id: shot.id, kind: shot.kind });
  }
  list.length = w;
}

// «Взрывная ладонь»: a monster that dies marked bursts and hits the others around it.
function explodeMark(game, enemy) {
  const mark = enemy.mark;
  enemy.mark = null;
  emit(game, 'palm-burst', enemy.x, enemy.y, { id: enemy.id, radius: mark.radius });
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - enemy.x, e.y - enemy.y);
    if (e === enemy || d > mark.radius || !clearLine(enemy, e, .05, game.world)) continue;
    const [dx, dy] = normalize(e.x - enemy.x, e.y - enemy.y);
    hitEnemy(game, e, monkDamage(game, mark.damage, 'technique', e), dx, dy, .3, 'palm', 'heavy', enemy);
  }
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
  if (distance < 1e-6 || hypotAtLeast(ox + sx, oy + sy, contact)) { slideXY[0] = sx; slideXY[1] = sy; return slideXY; }
  const nx = ox / distance, ny = oy / distance, inward = sx * nx + sy * ny;
  if (inward < 0) { slideXY[0] = sx - nx * inward; slideXY[1] = sy - ny * inward; }
  else { slideXY[0] = sx; slideXY[1] = sy; }
  return slideXY;
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
  const p = game.player;
  beetleSolids.length = 0;
  for (const e of game.enemies) if (e.kind === 'beetle' && e.hp > 0) beetleSolids.push(e);
  const solids = beetleSolids;
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

const packScratch = new WeakMap();
function packMembers(enemies) {
  let scratch = packScratch.get(enemies);
  if (!scratch) {
    scratch = { prev: [], members: [] };
    packScratch.set(enemies, scratch);
  }
  const { prev, members } = scratch;
  let same = prev.length === enemies.length;
  for (let i = 0; same && i < enemies.length; i++) if (prev[i] !== enemies[i]) same = false;
  if (!same) {
    members.length = 0;
    for (const enemy of enemies) if (enemy.packId) members.push(enemy);
    prev.length = 0;
    for (const enemy of enemies) prev.push(enemy);
  }
  return members;
}

function activatePacks(game) {
  if (!game.world?.safeArea || inSafeArea(game, game.player)) return;
  // Awake packs cannot emit another alert. Find packs with a sleeping member
  // before doing any of the expensive visibility tests; preserve trigger order.
  const members = packMembers(game.enemies);
  packIds.clear();
  for (const e of members) if (e.hp > 0 && !e.active && !e.returning) packIds.add(e.packId);
  if (!packIds.size) return;
  packTriggers.length = 0;
  const px = game.player.x, py = game.player.y;
  for (const e of members) {
    if (!packIds.has(e.packId) || e.hp <= 0 || e.returning) continue;
    if (!hypotLess(e.x - px, e.y - py, PACK_RULES.aggro) || !clearLine(e, game.player, .05, game.world)) continue;
    packTriggers.push(e);
  }
  for (const trigger of packTriggers) for (const e of members) {
    if (e.hp <= 0 || e.active || e.returning || e.packId !== trigger.packId
      || hypotGreater(e.x - trigger.x, e.y - trigger.y, PACK_RULES.alert)) continue;
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
    || hypotGreater(game.player.x - e.homeX, game.player.y - e.homeY, PACK_RULES.playerLeash)
    || hypotGreater(e.x - game.player.x, e.y - game.player.y, PACK_RULES.active)) e.returning = true;
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
  const p = game.player, params = skillParams(game, 'dash'), duration = Math.min(dt, p.dashTime);
  const steps = Math.max(1, Math.ceil(params.speed * duration / .1));
  p.dashHits ??= new Set();
  for (let i = 0; i < steps; i++) {
    const from = { x: p.x, y: p.y };
    moveBody(p, p.dx * params.speed * duration / steps, p.dy * params.speed * duration / steps, game.world);
    const dx = p.x - from.x, dy = p.y - from.y, length2 = dx * dx + dy * dy;
    for (const e of game.enemies) {
      if (e.hp <= 0 || e.sealed || p.dashHits.has(e.id)) continue;
      const t = length2 ? Math.max(0, Math.min(1, ((e.x - from.x) * dx + (e.y - from.y) * dy) / length2)) : 0;
      const contact = { x: from.x + dx * t, y: from.y + dy * t };
      if (hypotAtMost(e.x - contact.x, e.y - contact.y, p.radius + e.radius) && clearLine(contact, e, .05, game.world)) {
        p.dashHits.add(e.id);
        const result = hitEnemy(game, e, monkDamage(game, params.damage, 'dash', e), p.dx, p.dy, params.knockback,
          'dash', 'heavy', contact);
        // «Шаг духа»: spirit per monster struck, up to spiritCap per dash. The ritual source is no monster.
        if (result && e.kind !== 'ritual' && params.spiritPerHit > 0) {
          const gain = Math.min(params.spiritPerHit, params.spiritCap - (p.dashSpirit ?? 0));
          if (gain > 0) { p.dashSpirit = (p.dashSpirit ?? 0) + gain; p.spirit = Math.min(p.maxSpirit, p.spirit + gain); }
        }
      }
    }
  }
  p.dashTime = Math.max(0, p.dashTime - duration);
  if (p.dashTime < 1e-9) p.dashTime = 0;
}

// The heal is read when the monk takes the pickup, so «Второе дыхание» also works on pickups that
// fell before it was taken. pickup.amount keeps the value at the drop for the renderer.
function collectPickups(game) {
  const p = game.player, list = game.pickups;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const pickup = list[i];
    if (hypotGreater(pickup.x - p.x, pickup.y - p.y, MONK_RULES.pickup.radius) || !clearLine(p, pickup, .05, game.world)) {
      list[w++] = pickup; continue;
    }
    const oldHp = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + (game.progression ? monkStats(game).pickupHeal : pickup.amount));
    emit(game, 'pickup', pickup.x, pickup.y, { id: pickup.id, amount: p.hp - oldHp, source: 'pickup' });
    emit(game, 'heal', p.x, p.y, { amount: p.hp - oldHp, source: 'pickup' });
  }
  list.length = w;
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
  const p = game.player;
  enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
  if (enemy.state === 'idle') {
    if (hypotLess(p.x - enemy.x, p.y - enemy.y, WRAITH_STATS.aggroRange)) { enemy.state = 'chase'; emit(game, 'alert', enemy.x, enemy.y); }
    return;
  }
  const distance = Math.hypot(p.x - enemy.x, p.y - enemy.y);
  if (enemy.state === 'stunned' || enemy.state === 'recover') {
    enemy.timer -= dt;
    if (enemy.timer <= 1e-9) { enemy.state = 'chase'; enemy.attackCooldown = .25; }
    return;
  }
  if (enemy.state === 'windup') {
    enemy.timer -= dt;
    if (enemy.timer <= 1e-9) {
      const shot = { id: `shot-${game._nextProjectileId++}`, x: enemy.x, y: enemy.y,
        dx: enemy.dx, dy: enemy.dy, radius: WRAITH_STATS.shotRadius, life: WRAITH_STATS.shotLife,
        owner: enemy.id, damage: monsterDamage(enemy) };
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
  const list = game.projectiles, p = game.player;
  let w = 0;
  for (let n = 0; n < list.length; n++) {
    const shot = list[n];
    shot.life -= dt;
    if (shot.life <= 0) continue;
    const distance = WRAITH_STATS.shotSpeed * dt, steps = Math.max(1, Math.ceil(distance / .1));
    let spent = false;
    for (let i = 0; i < steps; i++) {
      stepPoint.x = shot.x + shot.dx * distance / steps; stepPoint.y = shot.y + shot.dy * distance / steps;
      if (inSafeArea(game, stepPoint) || !clearLine(shot, stepPoint, shot.radius, game.world)) { spent = true; break; }
      // Segment/circle contact covers the gaps between samples even at coarse dt.
      const sx = stepPoint.x - shot.x, sy = stepPoint.y - shot.y, length2 = sx * sx + sy * sy;
      const along = length2 ? Math.max(0, Math.min(1, ((p.x - shot.x) * sx + (p.y - shot.y) * sy) / length2)) : 0;
      // A shot passes under the crane flight; a deflect stance sends it back as a monk shot.
      if (hypotAtMost(p.x - shot.x - sx * along, p.y - shot.y - sy * along, p.radius + shot.radius)
        && damagePlayer(game, shot, shot.damage ?? WRAITH_STATS.shotDamage, shot) !== 'airborne') { spent = true; break; }
      shot.x = stepPoint.x; shot.y = stepPoint.y;
    }
    if (!spent) list[w++] = shot;
  }
  list.length = w;
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
  const p = game.player;
  e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  if (e.state === 'idle') {
    if (hypotLess(p.x - e.x, p.y - e.y, BEETLE_STATS.aggroRange)) { e.state = 'chase'; emit(game, 'alert', e.x, e.y); }
    return;
  }
  const distance = Math.hypot(p.x - e.x, p.y - e.y);
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
    if (!e.hit && slamReaches(game, e, p)) { e.hit = true; damagePlayer(game, e, monsterDamage(e)); }
    // A deflected slam has already broken the shell.
    if (e.state !== 'slam') return;
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
  if (e.mark && (e.mark.t -= dt) <= 0) e.mark = null;
  if (e.kind === 'beetle') e.breakImmunity = Math.max(0, (e.breakImmunity ?? 0) - dt);
  if (e.hp <= 0 || e.kind === 'ritual') return;
  if (returnOrSleep(game, e, dt, separation)) return;
  if (e.kind === 'wraith') { updateWraith(game, e, dt, separation); return; }
  if (e.kind === 'beetle') { updateBeetle(game, e, dt, separation); return; }
  const p = game.player;
  e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  if (e.state === 'idle') {
    if (hypotLess(p.x - e.x, p.y - e.y, 4.5)) { e.state = 'chase'; emit(game, 'alert', e.x, e.y); }
    return;
  }
  const distance = Math.hypot(p.x - e.x, p.y - e.y);
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
      if (!e.hit && Math.hypot(p.x - e.x, p.y - e.y) < .68) { e.hit = true; damagePlayer(game, e, monsterDamage(e)); }
      // A deflect riposte stops the leap where it landed.
      if (e.state !== 'leap') return;
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

// One strike of the series at its hit moment. Spirit is per strike: one unblocked victim earns
// the full amount, only blocks earn less. Weapon specials and relics act on the same strike.
function strikeCombo(game, a, combo) {
  const p = game.player, stats = monkStats(game), gear = a.gear ?? stats, finisher = a.index === combo.strikes - 1;
  const special = a.weapon ? WEAPON_FAMILIES[a.weapon].special : null, relic = a.relic ? RELICS[a.relic] : null;
  const strength = finisher ? 'heavy' : 'light', range = combo.range[a.index], arc = combo.dot[a.index];
  // A dot of −1 is the full circle, so a target straight behind is inside it too.
  const reaches = body => {
    const d = Math.hypot(body.x - p.x, body.y - p.y);
    const dot = d > .001 ? ((body.x - p.x) * a.dx + (body.y - p.y) * a.dy) / d : 1;
    return d < range && (arc <= -1 || dot > arc) && clearLine(p, body, .05, game.world);
  };
  const strikeDamage = e => monkDamage(game, combo.damage[a.index], 'combo', e, { finisher, gear });
  const pierce = special?.id === 'pierce' && a.index === special.strikeIndex ? { openShell: special.openShellMultiplier } : {};
  let gain = 0;
  const victims = [];
  for (const e of game.enemies) {
    if (!reaches(e)) continue;
    const result = hitEnemy(game, e, strikeDamage(e), a.dx, a.dy, combo.knockback[a.index], 'combo', strength, p, pierce);
    if (!result) continue;
    victims.push(e);
    gain = Math.max(gain, result === 'blocked' ? stats.blockedStrikeSpirit : combo.spiritPerStrike + gear.spiritPerStrike);
  }
  if (gain) p.spirit = Math.min(p.maxSpirit, p.spirit + gain);
  // «Сбивание»: the staff arc destroys wraith shots inside it.
  if (special?.destroysProjectiles && game.projectiles?.length) {
    game.projectiles = game.projectiles.filter(shot => {
      if (!reaches(shot)) return true;
      emit(game, 'shot-destroyed', shot.x, shot.y, { id: shot.id, source: 'staff' });
      return false;
    });
  }
  if (relic?.strikeIndex !== a.index) return;
  // «Журавлиная шея»: a small wave without spirit and without a shell break.
  if (relic.wave) {
    emit(game, 'relic-wave', p.x, p.y, { relic: relic.id, radius: relic.wave.radius });
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > relic.wave.radius || !clearLine(p, e, .05, game.world)) continue;
      const [dx, dy] = normalize(e.x - p.x, e.y - p.y);
      hitEnemy(game, e, monkDamage(game, relic.wave.damage, 'combo', e, { gear }), dx, dy, .3, 'relic', 'light', p);
    }
  }
  // «Тихий гром»: the strike jumps from its nearest victim to the nearest other monsters.
  const first = victims.filter(e => e.kind !== 'ritual')
    .sort((m, n) => Math.hypot(m.x - p.x, m.y - p.y) - Math.hypot(n.x - p.x, n.y - p.y))[0];
  if (relic.chain && first) {
    const chained = game.enemies.filter(e => e !== first && e.kind !== 'ritual' && e.hp > 0 && !victims.includes(e)
      && Math.hypot(e.x - first.x, e.y - first.y) <= relic.chain.radius && clearLine(first, e, .05, game.world))
      .sort((m, n) => Math.hypot(m.x - first.x, m.y - first.y) - Math.hypot(n.x - first.x, n.y - first.y))
      .slice(0, relic.chain.targets);
    for (const e of chained) {
      const [dx, dy] = normalize(e.x - first.x, e.y - first.y);
      emit(game, 'relic-chain', first.x, first.y, { relic: relic.id, from: first.id, to: e.id });
      hitEnemy(game, e, Math.round(strikeDamage(e) * relic.chain.damageFraction), dx, dy, combo.knockback[a.index],
        'relic', 'light', first);
    }
  }
}

export function updateGame(game, input, dt) {
  if (game.phase !== 'playing') return;
  dt = Math.min(Math.max(dt, 0), .05);
  game.time += dt;
  if (game.adventure) game.adventure.elapsed += dt;
  const effects = game.effects;
  let liveEffects = 0;
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    effect.age += dt;
    if (effect.age < effect.life) effects[liveEffects++] = effect;
  }
  effects.length = liveEffects;
  const p = game.player;
  for (const k of ['dashCooldown', 'waveCooldown', 'invulnerable', 'hitFlash', 'comboTimer']) p[k] = Math.max(0, p[k] - dt);
  for (const id in p.cooldowns) p.cooldowns[id] = Math.max(0, p.cooldowns[id] - dt);
  if (p.lockout > 0) p.lockout = Math.max(0, p.lockout - dt);
  if (p.lastBreathCooldown > 0) p.lastBreathCooldown = Math.max(0, p.lastBreathCooldown - dt);
  const ox = p.x, oy = p.y;
  if (p.technique?.id === 'crane') {
    updateCrane(game, dt);
  } else if (p.dashTime > 0) {
    updateDash(game, dt);
  } else {
    // The deflect stance roots the monk; he still turns to the aim.
    const rooted = p.technique?.id === 'deflect';
    let mx = rooted ? 0 : input.moveX || 0, my = rooted ? 0 : input.moveY || 0;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const speed = MONK_RULES.moveSpeed * (p.attack ? comboOf(p.attack.weapon).attackMoveMultiplier : 1);
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
    const a = p.attack, combo = comboOf(a.weapon);
    a.age += dt;
    if (!a.struck && a.age + 1e-9 >= combo.hitTime[a.index]) {
      a.struck = true;
      strikeCombo(game, a, combo);
    }
    if (a.age + 1e-9 >= combo.duration[a.index]) p.attack = null;
  }
  updateMonkShots(game, dt);
  game._pathBudget = 3;
  activatePacks(game);
  const separation = crowdSeparation(game.enemies);
  for (const e of game.enemies) updateEnemy(game, e, dt, separation.get(e.id));
  if (game.phase !== 'playing') return;
  updateProjectiles(game, dt);
  if (game.phase !== 'playing') return;
  openRitual(game);
  collectPickups(game);
  if (p.technique?.id !== 'crane') collectGroundItems(game);
  trackArea(game);
  if (p.technique?.id === 'deflect') updateStance(game, dt);
  // Each shrine heals once per run, only a wounded monk (§6.1).
  const listed = !!game.world?.shrines;
  for (const shrine of game.world ? shrinesOf(game.world) : [{ id: 'road-shrine', ...SHRINE }]) {
    if (shrineSpent(game, shrine.id) || !(p.hp < p.maxHp) || hypotAtLeast(p.x - shrine.x, p.y - shrine.y, .85)) continue;
    if (listed) (game.shrinesUsed ??= []).push(shrine.id);
    if (shrine.id === 'road-shrine') game.shrineUsed = true;
    p.hp = Math.min(p.maxHp, p.hp + 40);
    emit(game, 'heal', p.x, p.y, { source: 'shrine', ...(listed && { shrine: shrine.id }) });
  }
  if (!game.adventure && game.kills === game.enemies.length && Math.hypot(p.x - EXIT.x, p.y - EXIT.y) < .9) {
    game.phase = 'victory';
    emit(game, 'victory', p.x, p.y);
  }
}
