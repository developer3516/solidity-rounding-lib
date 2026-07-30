const { expect } = require('chai');
const { ethers } = require('hardhat');

const INT_MAX = 2n ** 255n - 1n;
const INT_MIN = -(2n ** 255n);
const DOWN = 0n;
const UP = 1n;

/*//////////////////////////////////////////////////////////////
                        REFERENCE MODEL
//////////////////////////////////////////////////////////////*/

// BigInt division truncates toward zero, exactly like Solidity's `/`, so the
// reference has to correct for it — which is the whole point of the library.
const floorDiv = (n, d) => {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
};

const ceilDiv = (n, d) => {
  const q = n / d;
  return n % d !== 0n && n < 0n === d < 0n ? q + 1n : q;
};

describe('SignedRounding', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('SignedRoundingHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                    THE TRAP THIS LIBRARY EXISTS FOR
  //////////////////////////////////////////////////////////////*/

  describe('floor is not truncation', () => {
    it('disagrees with native division on negatives', async () => {
      // Solidity truncates toward zero. For -7/2 that gives -3, but the floor
      // is -4. Anyone assuming `/` floors is off by one on every negative.
      expect(await harness.nativeDiv(-7n, 2n)).to.equal(-3n);
      expect(await harness.divDown(-7n, 2n)).to.equal(-4n);
      expect(await harness.divUp(-7n, 2n)).to.equal(-3n);
    });

    it('agrees with native division on positives', async () => {
      expect(await harness.nativeDiv(7n, 2n)).to.equal(3n);
      expect(await harness.divDown(7n, 2n)).to.equal(3n);
      expect(await harness.divUp(7n, 2n)).to.equal(4n);
    });

    it('means Up, not Down, matches native division for negatives', async () => {
      for (const [a, b] of [[-7n, 2n], [-1n, 3n], [-99n, 10n], [7n, -2n]]) {
        expect(await harness.divUp(a, b)).to.equal(await harness.nativeDiv(a, b), `${a}/${b}`);
      }
    });

    it('is monotonic across zero — flooring never drifts a balance upward', async () => {
      // Direction.Down moves every value the same way regardless of sign,
      // which is what makes it safe for signed accounting. Truncation does
      // not: it pulls negatives up and positives down.
      const values = [-7n, -3n, -1n, 1n, 3n, 7n];

      for (const v of values) {
        expect(await harness.divDown(v, 2n)).to.equal(floorDiv(v, 2n), `floor(${v}/2)`);
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                            SIGN HANDLING
  //////////////////////////////////////////////////////////////*/

  describe('sign combinations', () => {
    const magnitudes = [7n, 3n, 2n];

    it('gets the sign right for all eight operand combinations', async () => {
      for (const sx of [1n, -1n]) {
        for (const sy of [1n, -1n]) {
          for (const sd of [1n, -1n]) {
            const [x, y, d] = [sx * magnitudes[0], sy * magnitudes[1], sd * magnitudes[2]];

            expect(await harness.mulDivDown(x, y, d), `floor(${x}*${y}/${d})`).to.equal(
              floorDiv(x * y, d),
            );
            expect(await harness.mulDivUp(x, y, d), `ceil(${x}*${y}/${d})`).to.equal(
              ceilDiv(x * y, d),
            );
          }
        }
      }
    });

    it('treats two negatives as a positive result', async () => {
      expect(await harness.mulDivDown(-6n, -2n, 4n)).to.equal(3n);
    });

    it('handles a negative denominator', async () => {
      expect(await harness.mulDivDown(6n, 2n, -4n)).to.equal(-3n);
      expect(await harness.mulDivDown(7n, 1n, -2n)).to.equal(-4n);
      expect(await harness.mulDivUp(7n, 1n, -2n)).to.equal(-3n);
    });

    it('returns zero without a sign when an operand is zero', async () => {
      expect(await harness.mulDivDown(0n, -5n, 3n)).to.equal(0n);
      expect(await harness.mulDivUp(0n, -5n, 3n)).to.equal(0n);
      expect(await harness.mulDivUp(-5n, 0n, 3n)).to.equal(0n);
    });

    it('does not round an exact result in either direction', async () => {
      for (const [x, y, d] of [[-6n, 2n, 4n], [6n, 2n, -4n], [-6n, -2n, 4n]]) {
        expect(await harness.mulDivDown(x, y, d)).to.equal(await harness.mulDivUp(x, y, d));
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                                 ABS
  //////////////////////////////////////////////////////////////*/

  describe('abs', () => {
    it('returns the magnitude of ordinary values', async () => {
      expect(await harness.abs(0n)).to.equal(0n);
      expect(await harness.abs(7n)).to.equal(7n);
      expect(await harness.abs(-7n)).to.equal(7n);
      expect(await harness.abs(INT_MAX)).to.equal(INT_MAX);
    });

    it('handles int256.min, whose magnitude has no signed representation', async () => {
      // -(-2**255) overflows int256; the unchecked negation wraps to the same
      // bit pattern, which read as unsigned is exactly 2**255.
      expect(await harness.abs(INT_MIN)).to.equal(2n ** 255n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                              BOUNDARIES
  //////////////////////////////////////////////////////////////*/

  describe('boundaries', () => {
    it('produces int256.min when that is the true result', async () => {
      expect(await harness.mulDivDown(INT_MIN, 1n, 1n)).to.equal(INT_MIN);
      expect(await harness.mulDivDown(INT_MIN, 2n, 2n)).to.equal(INT_MIN);
      // A magnitude of exactly 2**255 has a home only on the negative side,
      // and reaching it from operands that are themselves in range is the
      // case a magnitude-based implementation is most likely to get wrong.
      expect(await harness.mulDivDown(2n ** 254n, 2n, -1n)).to.equal(INT_MIN);
    });

    it('rejects a positive result of magnitude 2**255', async () => {
      // int256.max is 2**255 - 1, so the same magnitude has nowhere to go
      // once the sign flips.
      await expect(harness.mulDivDown(2n ** 254n, 2n, 1n)).to.be.revertedWithCustomError(
        harness,
        'MulDivOverflow',
      );
      await expect(harness.mulDivDown(INT_MIN, 1n, -1n)).to.be.revertedWithCustomError(
        harness,
        'MulDivOverflow',
      );
      await expect(harness.mulDivDown(INT_MIN, -1n, 1n)).to.be.revertedWithCustomError(
        harness,
        'MulDivOverflow',
      );
    });

    it('rejects a result that exceeds int256 entirely', async () => {
      await expect(harness.mulDivDown(INT_MAX, INT_MAX, 1n)).to.be.revertedWithCustomError(
        harness,
        'MulDivOverflow',
      );
      await expect(harness.mulDivDown(INT_MIN, INT_MIN, 1n)).to.be.revertedWithCustomError(
        harness,
        'MulDivOverflow',
      );
    });

    it('keeps full precision when the product exceeds the signed range', async () => {
      // The product overflows int256 many times over; the quotient does not.
      const x = 2n ** 200n;
      const y = 2n ** 50n;

      expect(await harness.mulDivDown(x, y, 2n ** 128n)).to.equal((x * y) / 2n ** 128n);
      expect(await harness.mulDivDown(-x, y, 2n ** 128n)).to.equal(-((x * y) / 2n ** 128n));
    });

    it('reverts on a zero denominator', async () => {
      await expect(harness.mulDivDown(1n, 1n, 0n)).to.be.revertedWithCustomError(
        harness,
        'DivisionByZero',
      );
      await expect(harness.divUp(-1n, 0n)).to.be.revertedWithCustomError(harness, 'DivisionByZero');
    });
  });

  /*//////////////////////////////////////////////////////////////
                          DIRECTION DISPATCH
  //////////////////////////////////////////////////////////////*/

  describe('direction dispatch', () => {
    it('routes mulDiv and div to the matching implementation', async () => {
      expect(await harness.mulDiv(-7n, 1n, 2n, DOWN)).to.equal(await harness.mulDivDown(-7n, 1n, 2n));
      expect(await harness.mulDiv(-7n, 1n, 2n, UP)).to.equal(await harness.mulDivUp(-7n, 1n, 2n));
      expect(await harness.div(-7n, 2n, DOWN)).to.equal(-4n);
      expect(await harness.div(-7n, 2n, UP)).to.equal(-3n);
    });

    it('rejects a direction outside the enum', async () => {
      await expect(harness.mulDiv(1n, 1n, 1n, 2n)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                             INVARIANTS
  //////////////////////////////////////////////////////////////*/

  describe('invariants', () => {
    const cases = [
      [-7n, 3n, 2n],
      [7n, -3n, 2n],
      [-7n, -3n, -2n],
      [10n ** 30n, -7n, 3n],
      [-1n, 1n, 3n],
    ];

    it('never lets the floor exceed the ceiling', async () => {
      for (const [x, y, d] of cases) {
        expect(await harness.mulDivDown(x, y, d)).to.be.lessThanOrEqual(
          await harness.mulDivUp(x, y, d),
          `${x}*${y}/${d}`,
        );
      }
    });

    it('keeps floor and ceiling within one of each other', async () => {
      for (const [x, y, d] of cases) {
        const gap = (await harness.mulDivUp(x, y, d)) - (await harness.mulDivDown(x, y, d));
        expect(gap).to.be.oneOf([0n, 1n], `${x}*${y}/${d}`);
      }
    });

    it('negating the input mirrors the direction', async () => {
      // floor(-v) == -ceil(v): the two directions are reflections, so a sign
      // flip has to swap them. If it does not, one of them is truncating.
      for (const [x, y, d] of cases) {
        expect(await harness.mulDivDown(-x, y, d)).to.equal(-(await harness.mulDivUp(x, y, d)));
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                        DIFFERENTIAL FUZZING
  //////////////////////////////////////////////////////////////*/

  describe('differential vs BigInt reference', () => {
    it('matches floor and ceiling across a signed spread', async () => {
      const values = [-101n, -7n, -3n, -1n, 0n, 1n, 3n, 7n, 101n, 10n ** 18n, -(10n ** 18n)];
      const divisors = [-101n, -7n, -3n, -1n, 1n, 3n, 7n, 101n];

      for (const x of values) {
        for (const y of [-3n, 1n, 5n]) {
          for (const d of divisors) {
            expect(await harness.mulDivDown(x, y, d), `floor(${x}*${y}/${d})`).to.equal(
              floorDiv(x * y, d),
            );
            expect(await harness.mulDivUp(x, y, d), `ceil(${x}*${y}/${d})`).to.equal(
              ceilDiv(x * y, d),
            );
          }
        }
      }
    });
  });
});
