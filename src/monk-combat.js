const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Shared simulation/presentation contract. Durations are seconds, distances world units.
export const MONK_RULES = freeze({
  moveSpeed: 5.4,
  attackMoveMultiplier: .65,
  combo: {
    damage: [24, 30, 48], duration: [.22, .24, .31], hitTime: [.09, .11, .16],
    range: [1.5, 1.6, 1.9], dot: [.2, .05, -.1], knockback: [.16, .22, .55], resetTime: .85,
  },
  // A strike that only meets a blocking shell earns perBlockedStrike instead of perStrike.
  spirit: { max: 100, initial: 60, perStrike: 12, perBlockedStrike: 4 },
  wave: { cost: 40, cooldown: 1.2, radius: 3.4, damage: 72, knockback: .9 },
  dash: { speed: 16, duration: .2, cooldown: 1.2, damage: 32, knockback: .15 },
  enemyHp: { hound: 64, wraith: 76, beetle: 160 },
  pickup: { every: 4, amount: 18, radius: .85 },
});
