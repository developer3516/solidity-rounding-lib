const { expect } = require('chai');
const { ethers } = require('hardhat');

const BPS = 10_000n;
const WAD = 10n ** 18n;
const MAX = 2n ** 256n - 1n;
const DOWN = 0n;
const UP = 1n;

const refUp = (a, b, d) => ((a * b) % d === 0n ? (a * b) / d : (a * b) / d + 1n);

describe('Percentage', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('PercentageHarness')).deploy();
  });

  it('exposes BPS', async () => {
    expect(await harness.bps()).to.equal(BPS);
  });

  /*//////////////////////////////////////////////////////////////
                        THE IDENTITY THAT MATTERS
  //////////////////////////////////////////////////////////////*/

  describe('fee + net == amount, exactly', () => {
    const amounts = [0n, 1n, 2n, 3n, 7n, 99n, 1000n, 12_345n, WAD, WAD + 1n, 10n ** 24n + 7n];
    const rates = [0n, 1n, 30n, 250n, 333n, 3333n, 5000n, 9999n, BPS];

    it('holds for every amount and rate', async () => {
      for (const amount of amounts) {
        for (const rate of rates) {
          const [fee, net] = await harness.split(amount, rate);

          expect(fee + net, `split(${amount}, ${rate})`).to.equal(amount);
        }
      }
    });

    it('holds at the very top of the range', async () => {
      for (const rate of [1n, 3333n, 9999n]) {
        const [fee, net] = await harness.split(MAX, rate);

        expect(fee + net).to.equal(MAX);
      }
    });

    it('agrees with netOf computed on its own', async () => {
      for (const amount of amounts) {
        for (const rate of rates) {
          const [fee, net] = await harness.split(amount, rate);

          expect(await harness.feeOn(amount, rate)).to.equal(fee);
          expect(await harness.netOf(amount, rate)).to.equal(net);
        }
      }
    });

    it('is exactly what the naive independent split gets wrong', async () => {
      // 1 unit at 33.33% divides inexactly, so both naive halves truncate.
      const [naiveFee, naiveNet] = await harness.naiveSplit(1n, 3333n);
      const [fee, net] = await harness.split(1n, 3333n);

      expect(naiveFee + naiveNet).to.equal(0n); // a whole unit vanished
      expect(fee + net).to.equal(1n);
    });

    it('loses a unit in the naive form across many inexact cases', async () => {
      let lost = 0;
      let exact = 0;

      for (const amount of [1n, 3n, 7n, 99n, 12_345n]) {
        for (const rate of [1n, 333n, 3333n, 6667n, 9999n]) {
          const [nf, nn] = await harness.naiveSplit(amount, rate);
          const [f, n] = await harness.split(amount, rate);

          if (nf + nn !== amount) lost += 1;
          if (f + n === amount) exact += 1;
        }
      }

      expect(lost).to.be.greaterThan(15, 'the naive form should leak on most inexact inputs');
      expect(exact).to.equal(25, 'split should be exact on all of them');
    });
  });

  /*//////////////////////////////////////////////////////////////
                                FEE
  //////////////////////////////////////////////////////////////*/

  describe('feeOn', () => {
    it('computes ordinary rates', async () => {
      expect(await harness.feeOn(10_000n, 250n)).to.equal(250n); // 2.5%
      expect(await harness.feeOn(WAD, 30n)).to.equal((WAD * 30n) / BPS); // 0.3%
    });

    it('rounds up, toward the protocol', async () => {
      // A fee that rounds down is a protocol donating dust on every call.
      expect(await harness.feeOn(1n, 1n)).to.equal(1n);
      expect(await harness.feeOn(3n, 3333n)).to.equal(refUp(3n, 3333n, BPS));
    });

    it('does not inflate an exact fee', async () => {
      expect(await harness.feeOn(10_000n, 100n)).to.equal(100n);
      expect(await harness.feeOn(0n, 500n)).to.equal(0n);
    });

    it('takes everything at 100% and nothing at 0%', async () => {
      expect(await harness.feeOn(1234n, BPS)).to.equal(1234n);
      expect(await harness.feeOn(1234n, 0n)).to.equal(0n);
      expect(await harness.netOf(1234n, BPS)).to.equal(0n);
      expect(await harness.netOf(1234n, 0n)).to.equal(1234n);
    });

    it('keeps full precision on amounts that would overflow a bare multiply', async () => {
      // The product that actually gets computed is amount * bps, so the
      // premise has to be about that one, not amount * BPS.
      const amount = 10n ** 75n;

      expect(amount * 250n > MAX).to.equal(true, 'the premise: the product must not fit');
      expect(await harness.feeOn(amount, 250n)).to.equal((amount * 250n) / BPS);
    });

    it('rejects a rate above 100%', async () => {
      await expect(harness.feeOn(100n, BPS + 1n)).to.be.revertedWithCustomError(
        harness,
        'BpsOutOfRange',
      );
      await expect(harness.netOf(100n, BPS + 1n)).to.be.revertedWithCustomError(
        harness,
        'BpsOutOfRange',
      );
    });

    it('never returns a fee larger than the amount', async () => {
      // What makes the subtraction in netOf safe from underflow.
      for (const amount of [0n, 1n, 7n, WAD, MAX]) {
        for (const rate of [0n, 1n, 5000n, 9999n, BPS]) {
          expect(await harness.feeOn(amount, rate)).to.be.lessThanOrEqual(amount);
        }
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                            GENERAL RATES
  //////////////////////////////////////////////////////////////*/

  describe('applyBps', () => {
    it('rounds in the requested direction', async () => {
      expect(await harness.applyBps(1n, 3333n, DOWN)).to.equal(0n);
      expect(await harness.applyBps(1n, 3333n, UP)).to.equal(1n);
    });

    it('allows a rate above 100%', async () => {
      // Liquidation bonuses and penalty multipliers are legitimately > BPS.
      expect(await harness.applyBps(1000n, 15_000n, DOWN)).to.equal(1500n);
    });

    it('agrees with feeOn when rounding up', async () => {
      expect(await harness.applyBps(7n, 3333n, UP)).to.equal(await harness.feeOn(7n, 3333n));
    });
  });

  describe('addBps and subBps', () => {
    it('marks up and discounts', async () => {
      expect(await harness.addBps(1000n, 500n, DOWN)).to.equal(1050n);
      expect(await harness.subBps(1000n, 500n, DOWN)).to.equal(950n);
    });

    it('treats direction as describing the deduction, not the result', async () => {
      // Up takes more away, so it leaves less.
      const up = await harness.subBps(3n, 3333n, UP);
      const down = await harness.subBps(3n, 3333n, DOWN);

      expect(up).to.be.lessThan(down);
    });

    it('leaves nothing at 100%', async () => {
      expect(await harness.subBps(1234n, BPS, DOWN)).to.equal(0n);
    });

    it('rejects a discount above 100% rather than underflowing', async () => {
      await expect(harness.subBps(100n, BPS + 1n, DOWN)).to.be.revertedWithCustomError(
        harness,
        'BpsOutOfRange',
      );
    });

    it('reverts rather than wrapping when a markup overflows', async () => {
      await expect(harness.addBps(MAX, 1n, UP)).to.be.reverted;
    });
  });

  describe('bpsOf', () => {
    it('reports a share in basis points', async () => {
      expect(await harness.bpsOf(250n, 10_000n, DOWN)).to.equal(250n);
      expect(await harness.bpsOf(1n, 3n, DOWN)).to.equal(3333n);
      expect(await harness.bpsOf(1n, 3n, UP)).to.equal(3334n);
    });

    it('round-trips against feeOn within a basis point', async () => {
      const amount = 1_000_000n;
      const fee = await harness.feeOn(amount, 250n);

      expect(await harness.bpsOf(fee, amount, DOWN)).to.equal(250n);
    });

    it('reverts on a zero whole rather than reporting zero', async () => {
      await expect(harness.bpsOf(1n, 0n, DOWN)).to.be.reverted;
    });

    it('handles a part larger than the whole', async () => {
      expect(await harness.bpsOf(3n, 2n, DOWN)).to.equal(15_000n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                             INVARIANTS
  //////////////////////////////////////////////////////////////*/

  describe('invariants', () => {
    it('never lets a split create or destroy value across a batch', async () => {
      // The failure mode that matters: a per-item leak that only shows up in
      // aggregate, when the contract cannot settle what it promised.
      let feeTotal = 0n;
      let netTotal = 0n;
      let amountTotal = 0n;

      for (let i = 1n; i <= 200n; i += 1n) {
        const amount = i * 7n + 1n;
        const [fee, net] = await harness.split(amount, 3333n);

        feeTotal += fee;
        netTotal += net;
        amountTotal += amount;
      }

      expect(feeTotal + netTotal).to.equal(amountTotal);
    });

    it('shows the naive form failing the same batch', async () => {
      let total = 0n;
      let amountTotal = 0n;

      for (let i = 1n; i <= 200n; i += 1n) {
        const amount = i * 7n + 1n;
        const [fee, net] = await harness.naiveSplit(amount, 3333n);

        total += fee + net;
        amountTotal += amount;
      }

      // Short by one unit for every item that divided inexactly.
      expect(total).to.be.lessThan(amountTotal);
    });
  });
});
