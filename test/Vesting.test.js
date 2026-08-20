const { expect } = require('chai');
const { ethers } = require('hardhat');

const WAD = 10n ** 18n;
const DAY = 86_400n;
const YEAR = 365n * DAY;

// A grant that divides badly on purpose: 1,000,000.000000000000000007 tokens
// over four years, so almost no interval lands on a whole unit.
const TOTAL = 1_000_000n * WAD + 7n;
const START = 1_767_225_600n; // 2026-01-01
const CLIFF = START + YEAR;
const DURATION = 4n * YEAR;

describe('Vesting', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('VestingHarness')).deploy();
  });

  const vested = (t, total = TOTAL) => harness.vestedAt(total, START, CLIFF, DURATION, t);

  /*//////////////////////////////////////////////////////////////
                            THE SCHEDULE
  //////////////////////////////////////////////////////////////*/

  describe('the schedule', () => {
    it('vests nothing before the cliff', async () => {
      expect(await vested(START)).to.equal(0n);
      expect(await vested(START + YEAR - 1n)).to.equal(0n);
    });

    it('vests the whole first year the moment the cliff lands', async () => {
      // The cliff withholds; it does not reset the clock.
      expect(await vested(CLIFF)).to.equal((TOTAL * YEAR) / DURATION);
    });

    it('accrues linearly after the cliff', async () => {
      const half = await vested(START + DURATION / 2n);

      expect(half).to.equal(TOTAL / 2n);
    });

    it('returns the full total once the term is up', async () => {
      expect(await vested(START + DURATION)).to.equal(TOTAL);
      expect(await vested(START + DURATION + YEAR)).to.equal(TOTAL);
    });

    it('leaves no residue at the end', async () => {
      // Computing the tail through the same mulDiv would strand a few units
      // permanently, so the end of the schedule is an explicit case.
      expect(await harness.locked(TOTAL, START, CLIFF, DURATION, START + DURATION)).to.equal(0n);
    });

    it('keeps vested + locked equal to the total, always', async () => {
      for (const t of [START, CLIFF, CLIFF + DAY, START + DURATION / 3n, START + DURATION]) {
        const v = await vested(t);
        const l = await harness.locked(TOTAL, START, CLIFF, DURATION, t);

        expect(v + l, `t=${t}`).to.equal(TOTAL);
      }
    });

    it('is monotonic', async () => {
      let previous = 0n;
      for (let t = START; t <= START + DURATION; t += DURATION / 20n) {
        const v = await vested(t);
        expect(v).to.be.greaterThanOrEqual(previous);
        previous = v;
      }
    });

    it('never runs ahead of the schedule', async () => {
      // Down, so a beneficiary can never claim more than has truly accrued.
      for (const t of [CLIFF, CLIFF + 1n, CLIFF + DAY, START + DURATION - 1n]) {
        const exact = (TOTAL * (t - START)) / DURATION;
        expect(await vested(t), `t=${t}`).to.be.lessThanOrEqual(exact);
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
              THE PROPERTY THE LIBRARY EXISTS FOR
  //////////////////////////////////////////////////////////////*/

  describe('claim frequency does not change the total', () => {
    /** Claim at every point in `schedule`, returning the running total. */
    async function claimOn(schedule) {
      let claimed = 0n;

      for (const t of schedule) {
        const amount = await harness.claimable(TOTAL, claimed, START, CLIFF, DURATION, t);
        claimed += amount;
      }

      return claimed;
    }

    const end = START + DURATION;
    const monthly = [];
    for (let t = CLIFF; t <= end; t += DURATION / 48n) monthly.push(t);
    if (monthly.at(-1) !== end) monthly.push(end);

    const daily = [];
    for (let t = CLIFF; t <= end; t += DAY) daily.push(t);
    if (daily.at(-1) !== end) daily.push(end);

    it('pays the same whether claimed once or monthly', async () => {
      const once = await claimOn([end]);
      const often = await claimOn(monthly);

      expect(once).to.equal(TOTAL);
      expect(often).to.equal(TOTAL);
    });

    it('pays the same on a daily schedule, a thousand claims deep', async () => {
      // The cliff is a year in, so daily claims over the remaining three
      // years of a four-year term.
      expect(daily.length).to.equal(1096);
      expect(await claimOn(daily)).to.equal(TOTAL);
    });

    it('pays the same on an irregular, bursty schedule', async () => {
      const irregular = [
        CLIFF,
        CLIFF + 1n,
        CLIFF + 2n,
        CLIFF + DAY,
        CLIFF + DAY + 7n,
        START + DURATION / 2n,
        START + DURATION / 2n + 1n,
        START + (3n * DURATION) / 4n,
        end - 1n,
        end,
      ];

      expect(await claimOn(irregular)).to.equal(TOTAL);
    });

    it('shows the naive per-interval form losing a unit per claim', async () => {
      // Each naive claim truncates on its own slice, so the losses stack and
      // the contract ends holding a residue it can never pay out.
      let naiveTotal = 0n;
      let last = START;

      for (const t of monthly) {
        naiveTotal += await harness.naiveClaim(TOTAL, last, DURATION, t);
        last = t;
      }

      expect(naiveTotal).to.be.lessThan(TOTAL);
      expect(TOTAL - naiveTotal).to.be.greaterThan(0n);
    });

    it('loses more the more often the naive form is claimed', async () => {
      const shortfall = async (schedule) => {
        let total = 0n;
        let last = START;
        for (const t of schedule) {
          total += await harness.naiveClaim(TOTAL, last, DURATION, t);
          last = t;
        }
        return TOTAL - total;
      };

      const monthlyLoss = await shortfall(monthly);
      const dailyLoss = await shortfall(daily);

      // Claim frequency is a fee, and this is the size of it.
      expect(dailyLoss).to.be.greaterThan(monthlyLoss);
    });
  });

  /*//////////////////////////////////////////////////////////////
                              CLAIMABLE
  //////////////////////////////////////////////////////////////*/

  describe('claimable', () => {
    it('is the cumulative vested minus what was already taken', async () => {
      const t = CLIFF + 100n * DAY;
      const v = await vested(t);

      expect(await harness.claimable(TOTAL, 0n, START, CLIFF, DURATION, t)).to.equal(v);
      expect(await harness.claimable(TOTAL, v / 2n, START, CLIFF, DURATION, t)).to.equal(v - v / 2n);
      expect(await harness.claimable(TOTAL, v, START, CLIFF, DURATION, t)).to.equal(0n);
    });

    it('is zero before the cliff even with nothing claimed', async () => {
      expect(await harness.claimable(TOTAL, 0n, START, CLIFF, DURATION, START + DAY)).to.equal(0n);
    });

    it('reverts rather than underflowing when the accounting disagrees', async () => {
      // Returning zero would hide a real inconsistency; a panic would say
      // nothing about what happened.
      await expect(
        harness.claimable(TOTAL, TOTAL, START, CLIFF, DURATION, CLIFF),
      ).to.be.revertedWithCustomError(harness, 'OverClaimed');
    });
  });

  /*//////////////////////////////////////////////////////////////
                              EDGES
  //////////////////////////////////////////////////////////////*/

  describe('edges', () => {
    it('handles a grant with no cliff', async () => {
      expect(await harness.vestedAt(TOTAL, START, START, DURATION, START)).to.equal(0n);
      expect(await harness.vestedAt(TOTAL, START, START, DURATION, START + DURATION / 4n)).to.equal(
        TOTAL / 4n,
      );
    });

    it('handles a cliff at the very end', async () => {
      const allAtOnce = START + DURATION;

      expect(await harness.vestedAt(TOTAL, START, allAtOnce, DURATION, allAtOnce - 1n)).to.equal(0n);
      expect(await harness.vestedAt(TOTAL, START, allAtOnce, DURATION, allAtOnce)).to.equal(TOTAL);
    });

    it('handles a grant of zero', async () => {
      expect(await harness.vestedAt(0n, START, CLIFF, DURATION, START + DURATION)).to.equal(0n);
    });

    it('handles a grant of one unit', async () => {
      // Nothing vests until the very last moment, and then all of it.
      expect(await harness.vestedAt(1n, START, START, DURATION, START + DURATION - 1n)).to.equal(0n);
      expect(await harness.vestedAt(1n, START, START, DURATION, START + DURATION)).to.equal(1n);
    });

    it('handles a duration of one second', async () => {
      expect(await harness.vestedAt(TOTAL, START, START, 1n, START)).to.equal(0n);
      expect(await harness.vestedAt(TOTAL, START, START, 1n, START + 1n)).to.equal(TOTAL);
    });

    it('keeps full precision on a grant that overflows a bare multiply', async () => {
      // The product actually computed is total * elapsed, so the premise has
      // to be about that one.
      const huge = 10n ** 70n;
      const elapsed = DURATION / 2n;

      expect(huge * elapsed > 2n ** 256n - 1n).to.equal(true, 'the premise');
      expect(await harness.vestedAt(huge, START, START, DURATION, START + elapsed)).to.equal(
        huge / 2n,
      );
    });

    it('rejects a cliff before the start', async () => {
      await expect(
        harness.vestedAt(TOTAL, START, START - 1n, DURATION, START),
      ).to.be.revertedWithCustomError(harness, 'InvalidSchedule');
    });

    it('rejects a zero duration rather than dividing by it', async () => {
      await expect(
        harness.vestedAt(TOTAL, START, START, 0n, START),
      ).to.be.revertedWithCustomError(harness, 'InvalidSchedule');
    });
  });

  describe('isFullyVested', () => {
    it('flips exactly at the end of the term', async () => {
      expect(await harness.isFullyVested(START, DURATION, START + DURATION - 1n)).to.equal(false);
      expect(await harness.isFullyVested(START, DURATION, START + DURATION)).to.equal(true);
    });
  });
});
