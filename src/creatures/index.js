import { WHELP } from './whelp.js';
import { SPITTER } from './spitter.js';
import { GOLEM } from './golem.js';
import { DRAGON } from './dragon.js';

/**
 * The four archetypes. Each one owns its rig, its shared geometry, its skin
 * sheet and its animation; src/enemies.js owns the manager, the AI plumbing
 * and everything main.js talks to.
 */
export const ARCHETYPES = {
  whelp: WHELP,
  spitter: SPITTER,
  golem: GOLEM,
  boss: DRAGON,
};

export { WHELP, SPITTER, GOLEM, DRAGON };
