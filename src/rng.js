/**
 * Deterministic RNG so the city looks identical on every run.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1337) {
    this.reset(seed);
  }
  reset(seed = 1337) {
    this.next = mulberry32(seed);
    return this;
  }
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}
