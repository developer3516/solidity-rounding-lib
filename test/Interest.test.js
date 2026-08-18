const { expect } = require('chai');
const { ethers } = require('hardhat');

const RAY = 10n ** 27n;
const WAD = 10n ** 18n;
const DOWN = 0n;
const UP = 1n;

const YEAR = 365n * 24n * 3600n;
/** ~5% APR expressed per second, in RAY. */
const RATE_5PCT = (RAY * 5n) / 100n / YEAR;

/** Exact compounding in BigInt, to measure the on-chain approximation against. */
function exactCompound(rate, elapsed, scale = RAY) {
  let result = scale;
  const base = scale + rate;
  for (let i = 0n; i < elapsed; i += 1n) result = (result * base) / scale;
  return result;
}

describe('Interest', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('InterestHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                                LINEAR
  //////////////////////////////////////////////////////////////*/

  describe('linear', () => {
    it('is exactly RAY over zero time', async () => {
      expect(await harness.linear(RATE_5PCT, 0n)).to.equal(RAY);
    });

    it('is exact — no approximation to check against', async () => {
      expect(await harness.linear(RATE_5PCT, 1000n)).to.equal(RAY + RATE_5PCT * 1000n);
    });

    it('lands near 5% over a year', async () => {
      const factor = await harness.linear(RATE_5PCT, YEAR);
      const growthBps = ((factor - RAY) * 10_000n) / RAY;

      expect(growthBps).to.be.closeTo(500n, 1n);
    });

    it('is zero-growth at a zero rate', async () => {
      expect(await harness.linear(0n, YEAR)).to.equal(RAY);
    });
  });

  /*//////////////////////////////////////////////////////////////
                               COMPOUND
  //////////////////////////////////////////////////////////////*/

  describe('compound', () => {
    it('is exactly RAY over zero time', async () => {
      expect(await harness.compound(RATE_5PCT, 0n)).to.equal(RAY);
    });

    it('matches linear over a single second', async () => {
      // With n = 1 the second and third terms vanish, so the two agree exactly.
      expect(await harness.compound(RATE_5PCT, 1n)).to.equal(await harness.linear(RATE_5PCT, 1n));
    });

    it('exceeds linear once there is anything to compound', async () => {
      for (const elapsed of [2n, 60n, 86_400n, YEAR]) {
        expect(
          await harness.compound(RATE_5PCT, elapsed),
          `elapsed=${elapsed}`,
        ).to.be.greaterThan(await harness.linear(RATE_5PCT, elapsed));
      }
    });

    it('grows monotonically with time', async () => {
      let previous = 0n;
      for (const elapsed of [0n, 1n, 100n, 10_000n, 1_000_000n]) {
        const factor = await harness.compound(RATE_5PCT, elapsed);
        expect(factor).to.be.greaterThanOrEqual(previous);
        previous = factor;
      }
    });

    it('never overshoots true compounding', async () => {
      // The omitted terms of the expansion are all positive, so the result is
      // an underestimate. That direction is the safe one for a borrow index:
      // it can never charge more than real compounding would.
      for (const elapsed of [2n, 10n, 1000n, 86_400n]) {
        const onChain = await harness.compound(RATE_5PCT, elapsed);
        const exact = exactCompound(RATE_5PCT, elapsed);

        expect(onChain, `elapsed=${elapsed}`).to.be.lessThanOrEqual(exact);
      }
    });

    it('stays within a basis point of exact over a day', async () => {
      const elapsed = 86_400n;
      const onChain = await harness.compound(RATE_5PCT, elapsed);
      const exact = exactCompound(RATE_5PCT, elapsed);

      const errorBps = ((exact - onChain) * 10_000n) / exact;
      expect(errorBps).to.equal(0n);
    });

    it('refuses a period long enough for the truncation to matter', async () => {
      const cap = await harness.maxCompoundPeriod();

      await expect(harness.compound(RATE_5PCT, cap + 1n)).to.be.revertedWithCustomError(
        harness,
        'PeriodTooLong',
      );
      await expect(harness.compound(RATE_5PCT, cap)).to.not.be.reverted;
    });

    it('is zero-growth at a zero rate', async () => {
      expect(await harness.compound(0n, YEAR)).to.equal(RAY);
    });
  });

  /*//////////////////////////////////////////////////////////////
                        THE ASYMMETRY THAT MATTERS
  //////////////////////////////////////////////////////////////*/

  describe('debt rounds up, claims round down', () => {
    // A factor that divides inexactly against any round amount.
    const factor = RAY + 1n;

    it('charges the borrower at least the accrued amount', async () => {
      expect(await harness.applyToDebt(1n, factor)).to.equal(2n);
    });

    it('credits the supplier at most the accrued amount', async () => {
      expect(await harness.applyToClaim(1n, factor)).to.equal(1n);
    });

    it('never credits more than it charges over the same period', async () => {
      // The solvency property. Equal principals, one borrowed and one
      // supplied: the market must not owe more than it collected.
      for (const principal of [1n, 7n, 999n, WAD, WAD + 1n, 10n ** 24n + 7n]) {
        const charged = await harness.applyToDebt(principal, factor);
        const credited = await harness.applyToClaim(principal, factor);

        expect(credited, `principal=${principal}`).to.be.lessThanOrEqual(charged);
      }
    });

    it('accumulates the gap toward the market, never away from it', async () => {
      // Repeated accrual, as a real market does every block.
      let debt = 1_000_000n;
      let claim = 1_000_000n;

      for (let i = 0; i < 50; i += 1) {
        debt = await harness.applyToDebt(debt, factor);
        claim = await harness.applyToClaim(claim, factor);
      }

      expect(claim).to.be.lessThanOrEqual(debt);
    });

    it('would invert if both rounded the same way', async () => {
      // Sanity check on the premise: rounding both up credits more than an
      // up-rounded debt only by accident, and rounding both down under-charges
      // the borrower. Naming the two directions is what removes the choice.
      const bothUp = await harness.applyFactor(1n, factor, UP);
      const bothDown = await harness.applyFactor(1n, factor, DOWN);

      expect(bothUp).to.equal(await harness.applyToDebt(1n, factor));
      expect(bothDown).to.equal(await harness.applyToClaim(1n, factor));
      expect(bothUp).to.be.greaterThan(bothDown);
    });

    it('leaves an exact accrual alone in both directions', async () => {
      expect(await harness.applyToDebt(1000n, 2n * RAY)).to.equal(2000n);
      expect(await harness.applyToClaim(1000n, 2n * RAY)).to.equal(2000n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                                INDICES
  //////////////////////////////////////////////////////////////*/

  describe('advanceIndex', () => {
    it('leaves the index alone for a RAY factor', async () => {
      expect(await harness.advanceIndex(RAY, RAY)).to.equal(RAY);
    });

    it('does not ratchet when touched repeatedly', async () => {
      // An index that rounded up would grow on every touch, so a market
      // poked in a loop would charge more than one left alone. Ten no-op
      // accruals must be indistinguishable from none.
      let index = 3n * RAY + 7n;
      const before = index;

      for (let i = 0; i < 10; i += 1) index = await harness.advanceIndex(index, RAY);

      expect(index).to.equal(before);
    });

    it('is monotonic for factors at or above RAY', async () => {
      let index = RAY;
      for (let i = 0; i < 5; i += 1) {
        const next = await harness.advanceIndex(index, RAY + RAY / 1000n);
        expect(next).to.be.greaterThan(index);
        index = next;
      }
    });
  });

  describe('scaled balances', () => {
    const index = 2n * RAY + 1n;

    it('round-trips without creating value', async () => {
      for (const amount of [1n, 7n, 999n, WAD, 10n ** 24n + 7n]) {
        const scaled = await harness.toScaled(amount, index, DOWN);
        const back = await harness.fromScaled(scaled, index, DOWN);

        expect(back, `amount=${amount}`).to.be.lessThanOrEqual(amount);
      }
    });

    it('inverts cleanly at a RAY index', async () => {
      expect(await harness.toScaled(1234n, RAY, DOWN)).to.equal(1234n);
      expect(await harness.fromScaled(1234n, RAY, DOWN)).to.equal(1234n);
    });

    it('rounds in the direction asked', async () => {
      expect(await harness.fromScaled(1n, index, DOWN)).to.equal(2n);
      expect(await harness.fromScaled(1n, index, UP)).to.equal(3n);
    });

    it('reverts on a zero index rather than dividing by nothing', async () => {
      await expect(harness.toScaled(1n, 0n, DOWN)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                           A MARKET, SIMULATED
  //////////////////////////////////////////////////////////////*/

  describe('a market over a year', () => {
    it('collects at least what it pays out', async () => {
      // One borrower and one supplier, same principal, accrued in daily steps
      // for a year. The market must end solvent.
      const principal = 100_000n * WAD;
      let debt = principal;
      let claim = principal;

      for (let day = 0; day < 365; day += 1) {
        const factor = await harness.compound(RATE_5PCT, 86_400n);
        debt = await harness.applyToDebt(debt, factor);
        claim = await harness.applyToClaim(claim, factor);
      }

      expect(claim).to.be.lessThanOrEqual(debt);

      // And the interest is in the right ballpark — a little over 5%,
      // since daily compounding beats simple interest.
      const growthBps = ((debt - principal) * 10_000n) / principal;
      expect(growthBps).to.be.greaterThan(500n);
      expect(growthBps).to.be.lessThan(520n);
    });
  });
});
