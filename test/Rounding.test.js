const { expect } = require('chai');
const { ethers } = require('hardhat');

const MAX = 2n ** 256n - 1n;
const DOWN = 0n;
const UP = 1n;

/*//////////////////////////////////////////////////////////////
                        REFERENCE MODEL
//////////////////////////////////////////////////////////////*/

// JS BigInt is arbitrary precision, so it is a genuinely independent oracle
// for the contract's 512-bit arithmetic — not a reimplementation of the same
// algorithm that would share its bugs.
const refMulDivDown = (x, y, d) => (x * y) / d;
const refMulDivUp = (x, y, d) => ((x * y) % d === 0n ? (x * y) / d : (x * y) / d + 1n);

/**
 * Deterministic PRNG (xorshift128+ style, seeded) so a random failure is
 * reproducible from the seed alone rather than being a one-off in CI.
 */
function makeRandom(seed) {
  let state = BigInt(seed) || 1n;
  const MASK = (1n << 64n) - 1n;

  const next64 = () => {
    state ^= (state << 13n) & MASK;
    state ^= state >> 7n;
    state ^= (state << 17n) & MASK;
    state &= MASK;
    return state;
  };

  /** A uniformly random 256-bit value, assembled from four 64-bit draws. */
  return (bits = 256) => {
    let value = 0n;
    for (let i = 0; i < 4; i += 1) value = (value << 64n) | next64();
    return bits >= 256 ? value : value & ((1n << BigInt(bits)) - 1n);
  };
}

describe('Rounding', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('RoundingHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                          DIRECTION HELPERS
  //////////////////////////////////////////////////////////////*/

  describe('opposite', () => {
    it('flips the direction', async () => {
      expect(await harness.opposite(DOWN)).to.equal(UP);
      expect(await harness.opposite(UP)).to.equal(DOWN);
    });

    it('is an involution', async () => {
      expect(await harness.opposite(await harness.opposite(DOWN))).to.equal(DOWN);
      expect(await harness.opposite(await harness.opposite(UP))).to.equal(UP);
    });
  });

  /*//////////////////////////////////////////////////////////////
                                DIV
  //////////////////////////////////////////////////////////////*/

  describe('divDown', () => {
    it('truncates a non-exact quotient', async () => {
      expect(await harness.divDown(7n, 2n)).to.equal(3n);
      expect(await harness.divDown(1n, 3n)).to.equal(0n);
    });

    it('returns the exact quotient when the division is exact', async () => {
      expect(await harness.divDown(8n, 2n)).to.equal(4n);
    });

    it('handles a zero numerator', async () => {
      expect(await harness.divDown(0n, 5n)).to.equal(0n);
    });

    it('reverts on a zero denominator', async () => {
      await expect(harness.divDown(1n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });
  });

  describe('divUp', () => {
    it('rounds a non-exact quotient away from zero', async () => {
      expect(await harness.divUp(7n, 2n)).to.equal(4n);
      expect(await harness.divUp(1n, 3n)).to.equal(1n);
    });

    it('does not inflate an exact quotient', async () => {
      expect(await harness.divUp(8n, 2n)).to.equal(4n);
      expect(await harness.divUp(MAX, MAX)).to.equal(1n);
    });

    it('returns zero for a zero numerator rather than one', async () => {
      // The naive `(a + b - 1) / b` returns 1 here. Minting a share for a
      // zero deposit is exactly the bug this formulation avoids.
      expect(await harness.divUp(0n, 5n)).to.equal(0n);
    });

    it('does not overflow near the top of the range', async () => {
      // `(a + b - 1) / b` would overflow on both of these and revert.
      expect(await harness.divUp(MAX, 2n)).to.equal(refMulDivUp(MAX, 1n, 2n));
      expect(await harness.divUp(MAX, MAX - 1n)).to.equal(2n);
      expect(await harness.divUp(MAX - 1n, MAX)).to.equal(1n);
    });

    it('reverts on a zero denominator', async () => {
      await expect(harness.divUp(1n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });

    it('reverts on 0/0 rather than returning zero', async () => {
      await expect(harness.divUp(0n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });
  });

  /*//////////////////////////////////////////////////////////////
                              MULDIV
  //////////////////////////////////////////////////////////////*/

  describe('mulDivDown', () => {
    it('computes ordinary small values', async () => {
      expect(await harness.mulDivDown(10n, 20n, 5n)).to.equal(40n);
      expect(await harness.mulDivDown(1n, 1n, 3n)).to.equal(0n);
    });

    it('returns zero when either operand is zero', async () => {
      expect(await harness.mulDivDown(0n, MAX, 7n)).to.equal(0n);
      expect(await harness.mulDivDown(MAX, 0n, 7n)).to.equal(0n);
    });

    it('keeps full precision when the product exceeds 256 bits', async () => {
      // 2**255 * 2 overflows a uint256, but the quotient does not — the whole
      // reason the 512-bit intermediate exists.
      expect(await harness.mulDivDown(2n ** 255n, 2n, 4n)).to.equal(2n ** 254n);
      expect(await harness.mulDivDown(MAX, MAX, MAX)).to.equal(MAX);
      expect(await harness.mulDivDown(MAX, 2n, 2n)).to.equal(MAX);
    });

    it('divides exactly by an even denominator', async () => {
      // Exercises the power-of-two factoring branch.
      expect(await harness.mulDivDown(2n ** 200n, 2n ** 50n, 2n ** 128n)).to.equal(2n ** 122n);
    });

    it('handles a denominator of one', async () => {
      expect(await harness.mulDivDown(MAX, 1n, 1n)).to.equal(MAX);
    });

    it('reverts when the quotient does not fit in 256 bits', async () => {
      await expect(harness.mulDivDown(MAX, MAX, 1n)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
      await expect(harness.mulDivDown(MAX, MAX, 2n)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
      await expect(harness.mulDivDown(2n ** 255n, 4n, 2n)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
    });

    it('reports a zero denominator as DivisionByZero even on the 512-bit path', async () => {
      // `denominator <= prod1` is also true when the denominator is zero, so
      // without an explicit up-front check this would surface as an overflow.
      await expect(harness.mulDivDown(1n, 1n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
      await expect(harness.mulDivDown(MAX, MAX, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });
  });

  describe('mulDivUp', () => {
    it('rounds up only when there is a remainder', async () => {
      expect(await harness.mulDivUp(1n, 1n, 3n)).to.equal(1n);
      expect(await harness.mulDivUp(10n, 20n, 5n)).to.equal(40n);
      expect(await harness.mulDivUp(10n, 20n, 7n)).to.equal(29n); // 200/7 = 28.57
    });

    it('returns zero when either operand is zero', async () => {
      expect(await harness.mulDivUp(0n, MAX, 7n)).to.equal(0n);
    });

    it('keeps full precision when the product exceeds 256 bits', async () => {
      expect(await harness.mulDivUp(MAX, MAX, MAX)).to.equal(MAX);
      expect(await harness.mulDivUp(2n ** 255n, 3n, 4n)).to.equal(refMulDivUp(2n ** 255n, 3n, 4n));
    });

    it('reverts when the ceiling is unrepresentable but the floor is not', async () => {
      // (M-1)**2 == (M-2) * M + 1, so the floor is exactly type(uint256).max
      // with a remainder of 1 — the one input where rounding up is what
      // overflows. Off-by-one territory, and the reason this case is pinned.
      const x = MAX - 1n;
      const d = MAX - 2n;

      expect(refMulDivDown(x, x, d)).to.equal(MAX);
      expect(await harness.mulDivDown(x, x, d)).to.equal(MAX);
      await expect(harness.mulDivUp(x, x, d)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
    });

    it('reverts on a zero denominator', async () => {
      await expect(harness.mulDivUp(1n, 1n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });
  });

  /*//////////////////////////////////////////////////////////////
                          DIRECTION DISPATCH
  //////////////////////////////////////////////////////////////*/

  describe('direction dispatch', () => {
    it('routes mulDiv to the matching implementation', async () => {
      expect(await harness.mulDiv(10n, 20n, 7n, DOWN)).to.equal(await harness.mulDivDown(10n, 20n, 7n));
      expect(await harness.mulDiv(10n, 20n, 7n, UP)).to.equal(await harness.mulDivUp(10n, 20n, 7n));
    });

    it('routes div to the matching implementation', async () => {
      expect(await harness.div(7n, 2n, DOWN)).to.equal(3n);
      expect(await harness.div(7n, 2n, UP)).to.equal(4n);
    });

    it('rejects a direction outside the enum', async () => {
      // Solidity panics (0x21) on an invalid enum value rather than silently
      // treating it as Down.
      await expect(harness.mulDiv(10n, 20n, 7n, 2n)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                             INVARIANTS
  //////////////////////////////////////////////////////////////*/

  describe('invariants', () => {
    it('never lets the floor exceed the ceiling', async () => {
      for (const [x, y, d] of [
        [1n, 1n, 3n],
        [7n, 11n, 13n],
        [2n ** 128n, 2n ** 127n, 3n],
        [MAX, MAX, MAX],
      ]) {
        expect(await harness.mulDivDown(x, y, d)).to.be.lessThanOrEqual(await harness.mulDivUp(x, y, d));
      }
    });

    it('keeps floor and ceiling within one of each other', async () => {
      const [x, y, d] = [2n ** 200n + 7n, 2n ** 55n + 3n, 2n ** 100n - 1n];
      const down = await harness.mulDivDown(x, y, d);
      const up = await harness.mulDivUp(x, y, d);

      expect(up - down).to.be.oneOf([0n, 1n]);
    });

    it('agrees with the reference when the division is exact', async () => {
      const [x, y] = [2n ** 160n + 12345n, 2n ** 64n];

      expect(await harness.mulDivDown(x, y, y)).to.equal(x);
      expect(await harness.mulDivUp(x, y, y)).to.equal(x);
    });

    it('never mints value across a round trip in opposite directions', async () => {
      // The vault property this library exists for: converting assets to
      // shares and back must never hand back more than went in.
      const totalAssets = 1_000_000n * 10n ** 18n + 7n;
      const totalShares = 999_983n * 10n ** 18n;

      for (const assets of [1n, 2n, 3n, 10n ** 6n, 10n ** 18n, 123_456_789n]) {
        const shares = await harness.mulDivDown(assets, totalShares, totalAssets); // favour the vault
        const back = await harness.mulDivDown(shares, totalAssets, totalShares);

        expect(back).to.be.lessThanOrEqual(assets);
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                        DIFFERENTIAL FUZZING
  //////////////////////////////////////////////////////////////*/

  describe('differential vs BigInt reference', () => {
    const CASES = 256;

    it(`matches the reference on ${CASES} pseudo-random triples`, async () => {
      const random = makeRandom(0xc0ffee);
      let checked = 0;

      for (let i = 0; i < CASES; i += 1) {
        // Vary the bit widths so the sample hits both the 256-bit fast path
        // and the 512-bit path, plus small values where dust matters most.
        const widths = [8, 32, 64, 128, 200, 256];
        const x = random(widths[i % widths.length]);
        const y = random(widths[(i + 2) % widths.length]);
        const d = random(widths[(i + 4) % widths.length]);

        if (d === 0n) continue;

        const expectedDown = refMulDivDown(x, y, d);
        if (expectedDown > MAX) {
          await expect(harness.mulDivDown(x, y, d)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
          checked += 1;
          continue;
        }

        expect(await harness.mulDivDown(x, y, d), `mulDivDown(${x}, ${y}, ${d})`).to.equal(expectedDown);

        const expectedUp = refMulDivUp(x, y, d);
        if (expectedUp > MAX) {
          await expect(harness.mulDivUp(x, y, d)).to.be.revertedWithCustomError(harness, 'MulDivOverflow');
        } else {
          expect(await harness.mulDivUp(x, y, d), `mulDivUp(${x}, ${y}, ${d})`).to.equal(expectedUp);
        }

        checked += 1;
      }

      expect(checked).to.be.greaterThan(CASES / 2);
    });

    it('matches the reference on odd denominators specifically', async () => {
      // Odd denominators skip the power-of-two factoring entirely and go
      // straight to the modular inverse, so they deserve their own sample.
      const random = makeRandom(0xbadc0de);

      for (let i = 0; i < 64; i += 1) {
        const x = random(256);
        const y = random(64);
        const d = random(128) | 1n;

        const expected = refMulDivDown(x, y, d);
        if (expected > MAX) continue;

        expect(await harness.mulDivDown(x, y, d), `mulDivDown(${x}, ${y}, ${d})`).to.equal(expected);
      }
    });
  });
});
