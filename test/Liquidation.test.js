const { expect } = require('chai');
const { ethers } = require('hardhat');

const BPS = 10_000n;
const DOWN = 0n;
const UP = 1n;

// Chainlink-style 8-decimal USD feeds.
const USDC = { decimals: 6, price: 1_00_000_000n }; // $1.00
const WETH = { decimals: 18, price: 3_000_00_000_000n }; // $3,000
const WBTC = { decimals: 8, price: 60_000_00_000_000n }; // $60,000

const ONE_USDC = 10n ** 6n;
const ONE_WETH = 10n ** 18n;

/** Arbitrary-precision reference for the whole expression, in one go. */
function refSeize(repaid, debtDec, debtPrice, collDec, collPrice, bonusBps, up = false) {
  const num = repaid * debtPrice * 10n ** BigInt(collDec) * (BPS + bonusBps);
  const den = collPrice * 10n ** BigInt(debtDec) * BPS;
  return up && num % den !== 0n ? num / den + 1n : num / den;
}

describe('Liquidation', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('LiquidationHarness')).deploy();
  });

  const seize = (repaid, debt, coll, bonus) =>
    harness.collateralToSeize(repaid, debt.decimals, debt.price, coll.decimals, coll.price, bonus);

  /*//////////////////////////////////////////////////////////////
                            THE BASE CASE
  //////////////////////////////////////////////////////////////*/

  describe('repaying USDC debt against WETH collateral', () => {
    it('seizes the debt value at parity with no bonus', async () => {
      // $3,000 of USDC repaid, WETH at $3,000 -> 1 WETH.
      expect(await seize(3000n * ONE_USDC, USDC, WETH, 0n)).to.equal(ONE_WETH);
    });

    it('adds the bonus on top', async () => {
      // 5% bonus -> 1.05 WETH.
      expect(await seize(3000n * ONE_USDC, USDC, WETH, 500n)).to.equal((ONE_WETH * 105n) / 100n);
    });

    it('scales linearly with the amount repaid', async () => {
      const one = await seize(1000n * ONE_USDC, USDC, WETH, 500n);
      const ten = await seize(10_000n * ONE_USDC, USDC, WETH, 500n);

      expect(ten).to.equal(one * 10n);
    });

    it('seizes nothing for nothing', async () => {
      expect(await seize(0n, USDC, WETH, 500n)).to.equal(0n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                        AGAINST THE REFERENCE
  //////////////////////////////////////////////////////////////*/

  describe('matches an arbitrary-precision reference', () => {
    const pairs = [
      ['USDC debt / WETH collateral', USDC, WETH],
      ['WETH debt / USDC collateral', WETH, USDC],
      ['WBTC debt / USDC collateral', WBTC, USDC],
      ['USDC debt / WBTC collateral', USDC, WBTC],
      ['WETH debt / WBTC collateral', WETH, WBTC],
    ];
    const bonuses = [0n, 1n, 500n, 1000n, 9999n];

    it('across every pair, bonus and magnitude', async () => {
      for (const [label, debt, coll] of pairs) {
        for (const bonus of bonuses) {
          for (const units of [1n, 7n, 1000n]) {
            const repaid = units * 10n ** BigInt(debt.decimals);
            const expected = refSeize(repaid, debt.decimals, debt.price, coll.decimals, coll.price, bonus);

            expect(await seize(repaid, debt, coll, bonus), `${label} bonus=${bonus} units=${units}`)
              .to.equal(expected);
          }
        }
      }
    });

    it('on dust amounts, where truncation decides everything', async () => {
      for (const repaid of [1n, 2n, 3n, 999n]) {
        const expected = refSeize(repaid, USDC.decimals, USDC.price, WETH.decimals, WETH.price, 500n);

        expect(await seize(repaid, USDC, WETH, 500n), `repaid=${repaid}`).to.equal(expected);
      }
    });

    it('when the direction is stated explicitly', async () => {
      const repaid = 7n;
      const args = [repaid, USDC.decimals, USDC.price, WETH.decimals, WETH.price, 333n];

      expect(await harness.seizeWithDirection(...args, DOWN)).to.equal(
        refSeize(repaid, USDC.decimals, USDC.price, WETH.decimals, WETH.price, 333n, false),
      );
    });
  });

  /*//////////////////////////////////////////////////////////////
                    THE DIRECTION RULE INVERTS HERE
  //////////////////////////////////////////////////////////////*/

  describe('seizure rounds down, toward the borrower', () => {
    it('never seizes more than the exact entitlement', async () => {
      // The borrower is being forcibly closed out and is not in the room.
      // Every unit of truncation has to fall their way.
      for (const repaid of [1n, 3n, 7n, 999n, 12_345n]) {
        const exact = refSeize(repaid, WETH.decimals, WETH.price, USDC.decimals, USDC.price, 777n);
        const actual = await seize(repaid, WETH, USDC, 777n);

        expect(actual, `repaid=${repaid}`).to.be.lessThanOrEqual(exact);
      }
    });

    it('is the opposite of what an Up direction would give', async () => {
      const args = [7n, USDC.decimals, USDC.price, WETH.decimals, WETH.price, 333n];

      const down = await harness.seizeWithDirection(...args, DOWN);
      const up = await harness.seizeWithDirection(...args, UP);

      expect(down).to.be.lessThan(up);
      expect(await seize(7n, USDC, WETH, 333n)).to.equal(down);
    });

    it('takes nothing at all when the entitlement truncates to zero', async () => {
      // 1 wei of WETH debt against WBTC collateral: worth far less than one
      // satoshi, so the correct seizure is zero, not one.
      expect(await seize(1n, WETH, WBTC, 500n)).to.equal(0n);
    });
  });

  describe('the inverse quotes at least the true debt', () => {
    it('rounds up, so the protocol is never left short', async () => {
      for (const collateral of [1n, 7n, 999n, ONE_WETH]) {
        const quoted = await harness.debtForCollateral(
          collateral,
          WETH.decimals,
          WETH.price,
          USDC.decimals,
          USDC.price,
          500n,
        );

        // Repaying the quote must buy at least the collateral asked for.
        const seized = await harness.collateralToSeize(
          quoted,
          USDC.decimals,
          USDC.price,
          WETH.decimals,
          WETH.price,
          500n,
        );

        expect(seized, `collateral=${collateral}`).to.be.greaterThanOrEqual(collateral);
      }
    });

    it('round-trips exactly on whole units', async () => {
      const debt = await harness.debtForCollateral(
        ONE_WETH,
        WETH.decimals,
        WETH.price,
        USDC.decimals,
        USDC.price,
        0n,
      );

      expect(debt).to.equal(3000n * ONE_USDC);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          BONUS AND BOUNDS
  //////////////////////////////////////////////////////////////*/

  describe('bonusPortion', () => {
    it('splits a seizure into principal and bonus that add up', async () => {
      // Same identity Percentage.split protects for fees: derived by
      // subtraction, so nothing can vanish between the two halves.
      for (const seized of [1n, 7n, 999n, ONE_WETH, ONE_WETH + 1n]) {
        for (const bonus of [0n, 1n, 500n, 9999n]) {
          const bonusPart = await harness.bonusPortion(seized, bonus);
          const principal = seized - bonusPart;

          expect(principal + bonusPart, `seized=${seized} bonus=${bonus}`).to.equal(seized);
          expect(bonusPart).to.be.lessThanOrEqual(seized);
        }
      }
    });

    it('is zero when there is no bonus', async () => {
      expect(await harness.bonusPortion(ONE_WETH, 0n)).to.equal(0n);
    });

    it('is about 5% of a 5%-bonus seizure', async () => {
      const seized = (ONE_WETH * 105n) / 100n;
      const bonusPart = await harness.bonusPortion(seized, 500n);

      expect(bonusPart).to.be.closeTo(ONE_WETH / 20n, 10n);
    });
  });

  describe('maxRepayable', () => {
    it('applies the close factor', async () => {
      expect(await harness.maxRepayable(1000n * ONE_USDC, 5000n)).to.equal(500n * ONE_USDC);
      expect(await harness.maxRepayable(1000n * ONE_USDC, BPS)).to.equal(1000n * ONE_USDC);
    });

    it('rounds down, because a bound that rounds up is not a bound', async () => {
      // 50% of 3 units is 1.5 — authorising 2 would let a liquidator exceed
      // the close factor by a unit on every call.
      expect(await harness.maxRepayable(3n, 5000n)).to.equal(1n);
    });

    it('rejects a close factor above 100%', async () => {
      await expect(harness.maxRepayable(100n, BPS + 1n)).to.be.revertedWithCustomError(
        harness,
        'BonusOutOfRange',
      );
    });
  });

  describe('rejects nonsense inputs', () => {
    it('refuses a zero price rather than dividing by it', async () => {
      await expect(
        harness.collateralToSeize(1n, 6, 0n, 18, WETH.price, 500n),
      ).to.be.revertedWithCustomError(harness, 'InvalidPrice');

      await expect(
        harness.collateralToSeize(1n, 6, USDC.price, 18, 0n, 500n),
      ).to.be.revertedWithCustomError(harness, 'InvalidPrice');
    });

    it('refuses a bonus above the cap', async () => {
      const cap = await harness.maxBonusBps();

      expect(cap).to.equal(BPS);
      await expect(seize(1n, USDC, WETH, cap + 1n)).to.be.revertedWithCustomError(
        harness,
        'BonusOutOfRange',
      );
    });

    it('accepts the cap itself', async () => {
      // A 100% bonus seizes twice the debt's worth — extreme but coherent.
      expect(await seize(3000n * ONE_USDC, USDC, WETH, BPS)).to.equal(2n * ONE_WETH);
    });
  });

  /*//////////////////////////////////////////////////////////////
                             PRECISION
  //////////////////////////////////////////////////////////////*/

  describe('precision', () => {
    it('survives a repayment large enough to overflow a naive product', async () => {
      // repaid * price * 10**18 overflows a uint256 long before the division
      // brings it back. The 512-bit intermediate inside mulDiv is what makes
      // this work at all.
      const repaid = 10n ** 52n;
      const expected = refSeize(repaid, USDC.decimals, USDC.price, WETH.decimals, WETH.price, 500n);

      expect(repaid * USDC.price * 10n ** 18n > 2n ** 256n - 1n).to.equal(true, 'the premise');
      expect(await seize(repaid, USDC, WETH, 500n)).to.equal(expected);
    });

    it('does not collapse a small repayment to zero when it should not', async () => {
      // 1 USDC against WETH: worth 1/3000 of a WETH, which is still
      // 333,333,333,333,333 wei. An implementation that divided first would
      // return zero here.
      const seized = await seize(ONE_USDC, USDC, WETH, 0n);

      expect(seized).to.equal(ONE_WETH / 3000n);
      expect(seized).to.be.greaterThan(10n ** 14n);
    });
  });
});
