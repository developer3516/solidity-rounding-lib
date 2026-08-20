const { expect } = require('chai');
const { ethers } = require('hardhat');

const MAX = 2n ** 256n - 1n;
const WAD = 10n ** 18n;
const DOWN = 0n;
const UP = 1n;

/** Exact integer square root in BigInt — an independent oracle. */
function refSqrt(n) {
  if (n < 2n) return n;

  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

const refSqrtUp = (n) => {
  const root = refSqrt(n);
  return root * root === n ? root : root + 1n;
};

/** Deterministic PRNG, so a random failure reproduces from the seed. */
function makeRandom(seed) {
  let state = BigInt(seed) || 1n;
  const MASK = (1n << 64n) - 1n;

  const next = () => {
    state ^= (state << 13n) & MASK;
    state ^= state >> 7n;
    state ^= (state << 17n) & MASK;
    state &= MASK;
    return state;
  };

  return (bits = 256) => {
    let value = 0n;
    for (let i = 0; i < 4; i += 1) value = (value << 64n) | next();
    return bits >= 256 ? value : value & ((1n << BigInt(bits)) - 1n);
  };
}

describe('Sqrt', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('SqrtHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                              FLOOR SQRT
  //////////////////////////////////////////////////////////////*/

  describe('floorSqrt', () => {
    it('handles the small cases exactly', async () => {
      for (const [x, expected] of [[0n, 0n], [1n, 1n], [2n, 1n], [3n, 1n], [4n, 2n], [8n, 2n], [9n, 3n]]) {
        expect(await harness.floorSqrt(x), `sqrt(${x})`).to.equal(expected);
      }
    });

    it('is exact on perfect squares', async () => {
      for (const root of [1n, 2n, 7n, 999n, 10n ** 9n, 2n ** 64n, 2n ** 127n]) {
        expect(await harness.floorSqrt(root * root), `root=${root}`).to.equal(root);
      }
    });

    it('lands just below on one less than a perfect square', async () => {
      // The band Newton is most likely to get wrong, since it converges from
      // above and can land one too high.
      for (const root of [2n, 7n, 999n, 10n ** 9n, 2n ** 64n, 2n ** 127n]) {
        expect(await harness.floorSqrt(root * root - 1n), `root=${root}`).to.equal(root - 1n);
      }
    });

    it('stays put on one more than a perfect square', async () => {
      for (const root of [1n, 7n, 999n, 10n ** 9n, 2n ** 64n]) {
        expect(await harness.floorSqrt(root * root + 1n), `root=${root}`).to.equal(root);
      }
    });

    it('handles the top of the range', async () => {
      // floor(sqrt(2**256 - 1)) is 2**128 - 1.
      expect(await harness.floorSqrt(MAX)).to.equal(2n ** 128n - 1n);
      expect(await harness.floorSqrt(2n ** 255n)).to.equal(refSqrt(2n ** 255n));
    });

    it('walks the first few hundred integers without a single miss', async () => {
      // Cheap, and it covers the seed and the first iteration where an
      // off-by-one is easiest to introduce.
      for (let x = 0n; x < 300n; x += 1n) {
        expect(await harness.floorSqrt(x), `x=${x}`).to.equal(refSqrt(x));
      }
    });

    it('is monotonic', async () => {
      let previous = 0n;
      for (const x of [0n, 1n, 100n, WAD, 2n ** 128n, 2n ** 200n, MAX]) {
        const root = await harness.floorSqrt(x);
        expect(root).to.be.greaterThanOrEqual(previous);
        previous = root;
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                        DIFFERENTIAL FUZZING
  //////////////////////////////////////////////////////////////*/

  describe('differential vs BigInt reference', () => {
    it('matches across every magnitude', async () => {
      const random = makeRandom(0x5417);
      const widths = [1, 4, 16, 32, 64, 100, 128, 200, 255, 256];

      for (let i = 0; i < 200; i += 1) {
        const x = random(widths[i % widths.length]);

        expect(await harness.floorSqrt(x), `floorSqrt(${x})`).to.equal(refSqrt(x));
      }
    });

    it('matches the ceiling too', async () => {
      const random = makeRandom(0xce11);

      for (let i = 0; i < 100; i += 1) {
        const x = random([8, 64, 128, 200, 256][i % 5]);

        expect(await harness.sqrt(x, UP), `sqrtUp(${x})`).to.equal(refSqrtUp(x));
      }
    });

    it('satisfies root**2 <= x < (root+1)**2 for every sample', async () => {
      // The definition, checked directly rather than against another
      // implementation of the same idea.
      const random = makeRandom(0xdef);

      for (let i = 0; i < 100; i += 1) {
        const x = random([16, 64, 128, 256][i % 4]);
        const root = await harness.floorSqrt(x);

        expect(root * root, `x=${x}`).to.be.lessThanOrEqual(x);
        if (root < 2n ** 128n - 1n) {
          expect((root + 1n) * (root + 1n), `x=${x}`).to.be.greaterThan(x);
        }
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                             DIRECTION
  //////////////////////////////////////////////////////////////*/

  describe('direction', () => {
    it('rounds up only when the root is not exact', async () => {
      expect(await harness.sqrt(9n, UP)).to.equal(3n);
      expect(await harness.sqrt(10n, UP)).to.equal(4n);
      expect(await harness.sqrt(10n, DOWN)).to.equal(3n);
    });

    it('leaves zero and one alone in both directions', async () => {
      for (const x of [0n, 1n]) {
        expect(await harness.sqrt(x, DOWN)).to.equal(x);
        expect(await harness.sqrt(x, UP)).to.equal(x);
      }
    });

    it('keeps the two within one of each other', async () => {
      for (const x of [2n, 999n, WAD, WAD + 1n, 2n ** 200n + 7n]) {
        const gap = (await harness.sqrt(x, UP)) - (await harness.sqrt(x, DOWN));
        expect(gap).to.be.oneOf([0n, 1n], `x=${x}`);
      }
    });

    it('does not overflow when the ceiling is taken at the very top', async () => {
      // sqrt(MAX) is not exact, so Up adds one — and 2**128 has plenty of room.
      expect(await harness.sqrt(MAX, UP)).to.equal(2n ** 128n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          GEOMETRIC MEAN
  //////////////////////////////////////////////////////////////*/

  describe('geometricMean', () => {
    it('is the root of the product for ordinary reserves', async () => {
      expect(await harness.geometricMean(4n, 9n, DOWN)).to.equal(6n);
      expect(await harness.geometricMean(1000n * WAD, 1000n * WAD, DOWN)).to.equal(1000n * WAD);
    });

    it('rounds down, so a first LP mint never issues what was not deposited', async () => {
      // On an empty pool the ceiling would hand the first provider a fraction
      // of a token nobody put in — and that fraction is the entire pool.
      expect(await harness.geometricMean(2n, 3n, DOWN)).to.equal(2n); // sqrt(6) = 2.449
      expect(await harness.geometricMean(2n, 3n, UP)).to.equal(3n);
    });

    it('is symmetric in its arguments', async () => {
      expect(await harness.geometricMean(7n * WAD, 13n * WAD, DOWN)).to.equal(
        await harness.geometricMean(13n * WAD, 7n * WAD, DOWN),
      );
    });

    it('is zero when either reserve is', async () => {
      expect(await harness.geometricMean(0n, 10n ** 30n, DOWN)).to.equal(0n);
    });

    it('matches the reference on lopsided reserves', async () => {
      const pairs = [
        [1n, MAX / 2n],
        [10n ** 6n, 10n ** 30n],
        [3n, 10n ** 40n],
        [2n ** 127n, 2n],
      ];

      for (const [a, b] of pairs) {
        expect(await harness.geometricMean(a, b, DOWN), `${a},${b}`).to.equal(refSqrt(a * b));
      }
    });

    it('reverts rather than lying when the product exceeds 256 bits', async () => {
      // The root would fit; the intermediate cannot. Better to say so than to
      // return a number that looks plausible.
      await expect(harness.geometricMean(2n ** 200n, 2n ** 200n, DOWN)).to.be.reverted;
    });
  });

  describe('geometricMeanScaled', () => {
    it('survives reserves the naive product cannot', async () => {
      // a * b is 10**80, past 256 bits, so the naive form reverts. Dividing
      // by 10**10 inside the 512-bit intermediate lands the quotient back in
      // range and the root comes out.
      const a = 10n ** 40n;
      const b = 10n ** 40n;
      const d = 10n ** 10n;

      await expect(harness.naiveGeometricMean(a, b)).to.be.reverted;
      expect(await harness.geometricMeanScaled(a, b, d, DOWN)).to.equal(refSqrt((a * b) / d));
    });

    it('still reverts when even the quotient will not fit', async () => {
      // The honest limitation: the 512-bit intermediate holds the product,
      // but the *result* of the division still has to be a uint256. A
      // denominator of 1 divides nothing and changes nothing.
      await expect(harness.geometricMeanScaled(10n ** 40n, 10n ** 40n, 1n, DOWN)).to.be.reverted;
    });

    it('divides inside the intermediate, keeping precision', async () => {
      // sqrt(a * b / WAD) is not sqrt(a*b) / sqrt(WAD) in integer arithmetic.
      const a = 3n * WAD;
      const b = 7n * WAD;

      expect(await harness.geometricMeanScaled(a, b, WAD, DOWN)).to.equal(refSqrt((a * b) / WAD));
    });

    it('brings a product back into range that would otherwise overflow', async () => {
      const a = 2n ** 200n;
      const b = 2n ** 200n;

      // a * b is 2**400 — far past 256 bits. Dividing by 2**200 inside the
      // 512-bit intermediate lands it back in range.
      await expect(harness.geometricMean(a, b, DOWN)).to.be.reverted;
      expect(await harness.geometricMeanScaled(a, b, 2n ** 200n, DOWN)).to.equal(refSqrt(2n ** 200n));
    });

    it('reverts on a zero denominator', async () => {
      await expect(harness.geometricMeanScaled(1n, 1n, 0n, DOWN)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                                LOG2
  //////////////////////////////////////////////////////////////*/

  describe('log2', () => {
    it('reports the index of the highest set bit', async () => {
      expect(await harness.log2(0n)).to.equal(0n);
      expect(await harness.log2(1n)).to.equal(0n);
      expect(await harness.log2(2n)).to.equal(1n);
      expect(await harness.log2(3n)).to.equal(1n);
      expect(await harness.log2(255n)).to.equal(7n);
      expect(await harness.log2(256n)).to.equal(8n);
      expect(await harness.log2(MAX)).to.equal(255n);
    });

    it('matches the bit length across every power of two', async () => {
      for (let i = 0n; i < 256n; i += 1n) {
        expect(await harness.log2(1n << i), `2**${i}`).to.equal(i);
      }
    });
  });
});
