const { expect } = require('chai');
const { ethers } = require('hardhat');

const DOWN = 0n;
const UP = 1n;

// The scales that actually collide in production.
const USDC = 6;
const WBTC = 8;
const WETH = 18;

const ONE_USDC = 10n ** 6n;
const ONE_WETH = 10n ** 18n;

describe('Decimals', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('DecimalsHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                              WIDENING
  //////////////////////////////////////////////////////////////*/

  describe('widening is exact', () => {
    it('scales USDC up to WETH precision', async () => {
      expect(await harness.widen(ONE_USDC, USDC, WETH)).to.equal(ONE_WETH);
      expect(await harness.widen(1n, USDC, WETH)).to.equal(10n ** 12n);
    });

    it('leaves an amount alone at the same scale', async () => {
      expect(await harness.widen(12_345n, USDC, USDC)).to.equal(12_345n);
      expect(await harness.convert(12_345n, USDC, USDC, DOWN)).to.equal(12_345n);
    });

    it('ignores the direction, because there is no remainder to place', async () => {
      const down = await harness.convert(ONE_USDC, USDC, WETH, DOWN);
      const up = await harness.convert(ONE_USDC, USDC, WETH, UP);

      expect(down).to.equal(up);
    });

    it('refuses to widen downward rather than quietly narrowing', async () => {
      // A caller reaching for widen believes nothing is being lost. Doing the
      // lossy thing silently would betray exactly that belief.
      await expect(harness.widen(ONE_WETH, WETH, USDC)).to.be.revertedWithCustomError(
        harness,
        'DecimalsTooLarge',
      );
    });

    it('reverts rather than wrapping when the widened amount does not fit', async () => {
      await expect(harness.widen(2n ** 255n, 0, 18)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                              NARROWING
  //////////////////////////////////////////////////////////////*/

  describe('narrowing needs a direction', () => {
    it('scales WETH down to USDC precision', async () => {
      expect(await harness.narrow(ONE_WETH, WETH, USDC, DOWN)).to.equal(ONE_USDC);
    });

    it('rounds a remainder in the direction asked', async () => {
      // 1.5 USDC worth of WETH, at USDC precision.
      const amount = (3n * ONE_WETH) / 2n / ONE_USDC;

      expect(await harness.narrow(ONE_WETH + 1n, WETH, USDC, DOWN)).to.equal(ONE_USDC);
      expect(await harness.narrow(ONE_WETH + 1n, WETH, USDC, UP)).to.equal(ONE_USDC + 1n);
      expect(amount).to.be.greaterThan(0n);
    });

    it('takes a single wei of WETH to zero, or to one unit', async () => {
      // The number that surprises people: 1 wei is a billionth of the
      // smallest representable USDC amount.
      expect(await harness.narrow(1n, WETH, USDC, DOWN)).to.equal(0n);
      expect(await harness.narrow(1n, WETH, USDC, UP)).to.equal(1n);
    });

    it('does not inflate an exact narrowing', async () => {
      expect(await harness.narrow(ONE_WETH, WETH, USDC, UP)).to.equal(ONE_USDC);
      expect(await harness.narrow(0n, WETH, USDC, UP)).to.equal(0n);
    });

    it('refuses to narrow upward', async () => {
      await expect(harness.narrow(1n, USDC, WETH, DOWN)).to.be.revertedWithCustomError(
        harness,
        'DecimalsTooLarge',
      );
    });
  });

  /*//////////////////////////////////////////////////////////////
                      THE ROUND TRIP IS LOSSY
  //////////////////////////////////////////////////////////////*/

  describe('a round trip through a smaller scale loses value', () => {
    async function roundTrip(amount, from, to, direction = DOWN) {
      const narrowed = await harness.narrow(amount, from, to, direction);
      return harness.widen(narrowed, to, from);
    }

    it('destroys a single wei entirely', async () => {
      // Not almost zero. Zero.
      expect(await roundTrip(1n, WETH, USDC)).to.equal(0n);
    });

    it('keeps whole units intact', async () => {
      expect(await roundTrip(ONE_WETH, WETH, USDC)).to.equal(ONE_WETH);
      expect(await roundTrip(1234n * ONE_WETH, WETH, USDC)).to.equal(1234n * ONE_WETH);
    });

    it('discards everything below the target precision', async () => {
      const amount = ONE_WETH + 999_999_999_999n; // 1 WETH plus sub-USDC dust

      expect(await roundTrip(amount, WETH, USDC)).to.equal(ONE_WETH);
      expect(await harness.roundTripLoss(amount, WETH, USDC)).to.equal(999_999_999_999n);
    });

    it('never gains, whatever the direction', async () => {
      for (const amount of [1n, 999n, ONE_WETH, ONE_WETH + 7n, 10n ** 24n + 13n]) {
        expect(await roundTrip(amount, WETH, USDC, DOWN), `amount=${amount}`).to.be.lessThanOrEqual(
          amount,
        );
      }
    });

    it('reports the loss before it happens', async () => {
      // The point of roundTripLoss: a protocol can compare it against a dust
      // threshold and revert, rather than silently keeping the difference.
      const amount = ONE_WETH + 123_456_789_012n;

      const loss = await harness.roundTripLoss(amount, WETH, USDC);
      const after = await roundTrip(amount, WETH, USDC);

      expect(amount - after).to.equal(loss);
    });

    it('reports zero loss when widening', async () => {
      expect(await harness.roundTripLoss(12_345n, USDC, WETH)).to.equal(0n);
      expect(await harness.roundTripLoss(12_345n, USDC, USDC)).to.equal(0n);
    });

    it('agrees with isExact', async () => {
      expect(await harness.isExact(ONE_WETH, WETH, USDC)).to.equal(true);
      expect(await harness.isExact(ONE_WETH + 1n, WETH, USDC)).to.equal(false);
      expect(await harness.isExact(1n, USDC, WETH)).to.equal(true);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          REAL TOKEN PAIRS
  //////////////////////////////////////////////////////////////*/

  describe('the pairs that actually collide', () => {
    it('handles WBTC at 8 decimals', async () => {
      const oneWbtc = 10n ** 8n;

      expect(await harness.widen(oneWbtc, WBTC, WETH)).to.equal(ONE_WETH);
      expect(await harness.narrow(ONE_WETH, WETH, WBTC, DOWN)).to.equal(oneWbtc);
      expect(await harness.narrow(1n, WETH, WBTC, DOWN)).to.equal(0n);
    });

    it('handles a zero-decimal token', async () => {
      // They exist, and every scaling assumption written as "at least 6"
      // breaks on them.
      expect(await harness.widen(5n, 0, WETH)).to.equal(5n * ONE_WETH);
      expect(await harness.narrow(ONE_WETH + 1n, WETH, 0, DOWN)).to.equal(1n);
      expect(await harness.narrow(ONE_WETH + 1n, WETH, 0, UP)).to.equal(2n);
    });

    it('converts between two non-18 scales without going through 18', async () => {
      expect(await harness.convert(10n ** 8n, WBTC, USDC, DOWN)).to.equal(ONE_USDC);
      expect(await harness.convert(ONE_USDC, USDC, WBTC, DOWN)).to.equal(10n ** 8n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                              BOUNDARIES
  //////////////////////////////////////////////////////////////*/

  describe('pow10', () => {
    it('computes the scales in range', async () => {
      expect(await harness.pow10(0)).to.equal(1n);
      expect(await harness.pow10(18)).to.equal(ONE_WETH);
      expect(await harness.pow10(77)).to.equal(10n ** 77n);
    });

    it('refuses a scale that does not fit in a uint256', async () => {
      // 10 ** 78 overflows, so 77 is the ceiling and the library says so
      // rather than wrapping.
      const cap = await harness.maxDecimals();

      expect(cap).to.equal(77n);
      await expect(harness.pow10(78)).to.be.revertedWithCustomError(harness, 'DecimalsTooLarge');
    });
  });

  describe('invariants', () => {
    it('is the identity when the scales match', async () => {
      for (const amount of [0n, 1n, ONE_WETH, 2n ** 255n]) {
        expect(await harness.convert(amount, WETH, WETH, DOWN)).to.equal(amount);
      }
    });

    it('keeps up and down within one unit of each other', async () => {
      for (const amount of [1n, 7n, ONE_WETH + 1n, 10n ** 24n + 13n]) {
        const down = await harness.narrow(amount, WETH, USDC, DOWN);
        const up = await harness.narrow(amount, WETH, USDC, UP);

        expect(up - down).to.be.oneOf([0n, 1n], `amount=${amount}`);
      }
    });

    it('widens and narrows back to exactly the original', async () => {
      // The other direction of the round trip, which is lossless.
      for (const amount of [0n, 1n, 999n, ONE_USDC, 12_345_678n]) {
        const widened = await harness.widen(amount, USDC, WETH);

        expect(await harness.narrow(widened, WETH, USDC, DOWN)).to.equal(amount);
        expect(await harness.narrow(widened, WETH, USDC, UP)).to.equal(amount);
      }
    });
  });
});
