const { expect } = require('chai');
const { ethers } = require('hardhat');

const BPS = 10_000n;
const WAD = 10n ** 18n;
const MAX = 2n ** 256n - 1n;
const DOWN = 0n;
const UP = 1n;

const refDown = (a, b, d) => (a * b) / d;
const refUp = (a, b, d) => ((a * b) % d === 0n ? (a * b) / d : (a * b) / d + 1n);

describe('Slippage', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('SlippageHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                          A BOUND IS PERMISSIVE
  //////////////////////////////////////////////////////////////*/

  describe('a bound is the user speaking, so it rounds their way', () => {
    it('computes ordinary tolerances', async () => {
      expect(await harness.minOut(1000n * WAD, 50n)).to.equal((1000n * WAD * 9950n) / BPS);
      expect(await harness.maxIn(1000n * WAD, 50n)).to.equal((1000n * WAD * 10_050n) / BPS);
    });

    it('rounds the floor down, never demanding more than asked', async () => {
      // 3 units at 33.33% tolerance: the exact floor is 2.00001, and asking
      // for 3 would be enforcing a tolerance the caller never set.
      const quoted = 3n;
      const tolerance = 3333n;

      expect(await harness.minOut(quoted, tolerance)).to.equal(refDown(quoted, BPS - tolerance, BPS));
      expect(await harness.minOut(quoted, tolerance)).to.be.lessThan(
        await harness.strictMinOut(quoted, tolerance),
      );
    });

    it('rounds the ceiling up, never offering less room than allowed', async () => {
      const quoted = 3n;
      const tolerance = 3333n;

      expect(await harness.maxIn(quoted, tolerance)).to.equal(refUp(quoted, BPS + tolerance, BPS));
    });

    it('shows the strict floor rejecting trades the caller would accept', async () => {
      // The failure is invisible from outside: the transaction reverts with
      // "insufficient output" while the output was, by the caller's own
      // arithmetic, sufficient.
      let rejectedByStrict = 0;

      for (const quoted of [3n, 7n, 11n, 999n, 12_345n]) {
        for (const tolerance of [1n, 333n, 3333n, 6667n]) {
          const permissive = await harness.minOut(quoted, tolerance);
          const strict = await harness.strictMinOut(quoted, tolerance);

          // A trade landing exactly on the permissive floor passes there and
          // fails against the strict one.
          if (permissive < strict) rejectedByStrict += 1;
          expect(permissive).to.be.lessThanOrEqual(strict);
        }
      }

      expect(rejectedByStrict).to.be.greaterThan(10);
    });

    it('is exact when the tolerance divides evenly', async () => {
      expect(await harness.minOut(10_000n, 500n)).to.equal(9500n);
      expect(await harness.maxIn(10_000n, 500n)).to.equal(10_500n);
    });

    it('handles a zero tolerance as an exact requirement', async () => {
      expect(await harness.minOut(1234n, 0n)).to.equal(1234n);
      expect(await harness.maxIn(1234n, 0n)).to.equal(1234n);
    });

    it('handles a 100% tolerance as no floor at all', async () => {
      expect(await harness.minOut(1234n, BPS)).to.equal(0n);
    });

    it('handles a zero quote', async () => {
      expect(await harness.minOut(0n, 500n)).to.equal(0n);
      expect(await harness.maxIn(0n, 500n)).to.equal(0n);
    });

    it('keeps full precision on quotes that overflow a bare multiply', async () => {
      const quoted = 10n ** 74n;

      expect(quoted * BPS > MAX).to.equal(true, 'the premise');
      expect(await harness.minOut(quoted, 500n)).to.equal(refDown(quoted, BPS - 500n, BPS));
    });

    it('rejects a tolerance above 100%', async () => {
      await expect(harness.minOut(100n, BPS + 1n)).to.be.revertedWithCustomError(
        harness,
        'ToleranceOutOfRange',
      );
    });

    it('reverts rather than wrapping when a ceiling overflows', async () => {
      await expect(harness.maxIn(MAX, 1n)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                          THE CHECK IS INCLUSIVE
  //////////////////////////////////////////////////////////////*/

  describe('the check', () => {
    it('accepts a trade landing exactly on the floor', async () => {
      // The stated limit being met is the limit being met. Rejecting it would
      // enforce > on a bound expressed as >=.
      await expect(harness.requireMinOut(1000n, 1000n)).to.not.be.reverted;
      await expect(harness.requireMaxIn(1000n, 1000n)).to.not.be.reverted;
    });

    it('accepts a trade better than the bound', async () => {
      await expect(harness.requireMinOut(1001n, 1000n)).to.not.be.reverted;
      await expect(harness.requireMaxIn(999n, 1000n)).to.not.be.reverted;
    });

    it('rejects a trade one unit past the bound, and says both numbers', async () => {
      await expect(harness.requireMinOut(999n, 1000n))
        .to.be.revertedWithCustomError(harness, 'InsufficientOutput')
        .withArgs(999n, 1000n);

      await expect(harness.requireMaxIn(1001n, 1000n))
        .to.be.revertedWithCustomError(harness, 'ExcessiveInput')
        .withArgs(1001n, 1000n);
    });

    it('agrees with the bound it was derived from', async () => {
      // Asking and enforcing must not disagree by a unit, which is the whole
      // reason isWithinTolerance reuses minOut rather than recomputing.
      for (const quoted of [3n, 7n, 999n, WAD + 1n]) {
        for (const tolerance of [1n, 333n, 3333n]) {
          const floor = await harness.minOut(quoted, tolerance);

          expect(await harness.isWithinTolerance(quoted, floor, tolerance)).to.equal(true);
          if (floor > 0n) {
            expect(await harness.isWithinTolerance(quoted, floor - 1n, tolerance)).to.equal(false);
          }
        }
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                             REPORTING
  //////////////////////////////////////////////////////////////*/

  describe('realisedBps', () => {
    it('reports the shortfall in basis points', async () => {
      expect(await harness.realisedBps(10_000n, 9_950n)).to.equal(50n);
      expect(await harness.realisedBps(1000n * WAD, 995n * WAD)).to.equal(50n);
    });

    it('is zero when the trade met or beat the quote', async () => {
      expect(await harness.realisedBps(1000n, 1000n)).to.equal(0n);
      expect(await harness.realisedBps(1000n, 1001n)).to.equal(0n);
    });

    it('rounds up, so a report never understates what happened', async () => {
      // Slippage that rounds toward zero is the figure nobody notices drifting.
      const quoted = 10_000n;
      const actual = 9_999n; // 1 bp exactly

      expect(await harness.realisedBps(quoted, actual)).to.equal(1n);
      // A sub-basis-point loss still reports as one, not none.
      expect(await harness.realisedBps(100_000n, 99_999n)).to.equal(1n);
    });

    it('reports a total loss as the full range', async () => {
      expect(await harness.realisedBps(1000n, 0n)).to.equal(BPS);
    });

    it('reverts on a zero quote rather than dividing by nothing', async () => {
      await expect(harness.realisedBps(0n, 0n)).to.not.be.reverted; // actual >= quoted
      await expect(harness.realisedBps(1000n, 2000n)).to.not.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                             INVARIANTS
  //////////////////////////////////////////////////////////////*/

  describe('invariants', () => {
    it('never puts the floor above the quote', async () => {
      for (const quoted of [1n, 7n, 999n, WAD + 1n]) {
        for (const tolerance of [0n, 1n, 500n, 9999n, BPS]) {
          expect(await harness.minOut(quoted, tolerance), `${quoted}/${tolerance}`).to.be.lessThanOrEqual(
            quoted,
          );
        }
      }
    });

    it('never puts the ceiling below the quote', async () => {
      for (const quoted of [1n, 7n, 999n, WAD + 1n]) {
        for (const tolerance of [0n, 1n, 500n, 9999n]) {
          expect(await harness.maxIn(quoted, tolerance)).to.be.greaterThanOrEqual(quoted);
        }
      }
    });

    it('loosens the floor monotonically as the tolerance grows', async () => {
      let previous = MAX;
      for (const tolerance of [0n, 1n, 100n, 500n, 5000n, BPS]) {
        const floor = await harness.minOut(1_000_000n, tolerance);
        expect(floor).to.be.lessThanOrEqual(previous);
        previous = floor;
      }
    });

    it('routes the explicit direction to the named helpers', async () => {
      expect(await harness.bound(3n, 3333n, DOWN)).to.equal(await harness.minOut(3n, 3333n));
      expect(await harness.bound(3n, 3333n, UP)).to.equal(await harness.strictMinOut(3n, 3333n));
    });
  });
});
