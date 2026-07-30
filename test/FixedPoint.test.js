const { expect } = require('chai');
const { ethers } = require('hardhat');

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const MAX = 2n ** 256n - 1n;
const DOWN = 0n;
const UP = 1n;

const refMul = (a, b, scale, up) => (up && (a * b) % scale !== 0n ? (a * b) / scale + 1n : (a * b) / scale);
const refDiv = (a, b, scale, up) => (up && (a * scale) % b !== 0n ? (a * scale) / b + 1n : (a * scale) / b);

describe('FixedPoint', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('FixedPointHarness')).deploy();
  });

  describe('constants', () => {
    it('exposes the two scales', async () => {
      expect(await harness.wad()).to.equal(WAD);
      expect(await harness.ray()).to.equal(RAY);
    });
  });

  /*//////////////////////////////////////////////////////////////
                                 WAD
  //////////////////////////////////////////////////////////////*/

  describe('WAD arithmetic', () => {
    it('multiplies whole units', async () => {
      expect(await harness.mulWadDown(2n * WAD, 3n * WAD)).to.equal(6n * WAD);
      expect(await harness.mulWadDown(WAD / 2n, 2n * WAD)).to.equal(WAD);
    });

    it('divides whole units', async () => {
      expect(await harness.divWadDown(6n * WAD, 3n * WAD)).to.equal(2n * WAD);
      expect(await harness.divWadDown(WAD, 2n * WAD)).to.equal(WAD / 2n);
    });

    it('treats WAD as the multiplicative identity', async () => {
      const x = 123_456_789n * WAD + 7n;

      expect(await harness.mulWadDown(x, WAD)).to.equal(x);
      expect(await harness.mulWadUp(x, WAD)).to.equal(x);
      expect(await harness.divWadDown(x, WAD)).to.equal(x);
    });

    it('rounds a non-exact product in both directions', async () => {
      // 1 wei of a token times half — exactly 0.5, so the direction shows.
      expect(await harness.mulWadDown(1n, WAD / 2n)).to.equal(0n);
      expect(await harness.mulWadUp(1n, WAD / 2n)).to.equal(1n);
    });

    it('rounds a non-exact quotient in both directions', async () => {
      expect(await harness.divWadDown(1n, 3n * WAD)).to.equal(0n);
      expect(await harness.divWadUp(1n, 3n * WAD)).to.equal(1n);
    });

    it('does not round an exact result up', async () => {
      expect(await harness.mulWadUp(2n * WAD, 3n * WAD)).to.equal(6n * WAD);
      expect(await harness.divWadUp(6n * WAD, 3n * WAD)).to.equal(2n * WAD);
    });

    it('keeps full precision when the intermediate product exceeds 256 bits', async () => {
      // a * b alone overflows long before dividing by WAD brings it back.
      const a = 10n ** 39n;
      const b = 10n ** 39n;

      expect(a * b > MAX).to.equal(true, 'the premise: the product must not fit');
      expect(await harness.mulWadDown(a, b)).to.equal((a * b) / WAD);
    });

    it('reverts on division by zero', async () => {
      await expect(harness.divWadDown(WAD, 0n)).to.be.reverted;
      await expect(harness.divWadUp(WAD, 0n)).to.be.reverted;
    });

    it('reverts when the result does not fit', async () => {
      await expect(harness.divWadDown(MAX, 1n)).to.be.reverted;
    });
  });

  /*//////////////////////////////////////////////////////////////
                                 RAY
  //////////////////////////////////////////////////////////////*/

  describe('RAY arithmetic', () => {
    it('multiplies and divides whole units', async () => {
      expect(await harness.mulRayDown(2n * RAY, 3n * RAY)).to.equal(6n * RAY);
      expect(await harness.divRayDown(6n * RAY, 3n * RAY)).to.equal(2n * RAY);
    });

    it('treats RAY as the multiplicative identity', async () => {
      const x = 42n * RAY + 13n;

      expect(await harness.mulRayDown(x, RAY)).to.equal(x);
      expect(await harness.divRayDown(x, RAY)).to.equal(x);
    });

    it('rounds in both directions', async () => {
      expect(await harness.mulRayDown(1n, RAY / 2n)).to.equal(0n);
      expect(await harness.mulRayUp(1n, RAY / 2n)).to.equal(1n);
      expect(await harness.divRayDown(1n, 3n * RAY)).to.equal(0n);
      expect(await harness.divRayUp(1n, 3n * RAY)).to.equal(1n);
    });

    it('carries nine more digits of precision than WAD', async () => {
      // Take a rate of 1 + 1e-27. At WAD scale that rate is not representable
      // at all — it *is* exactly 1.0 — so applying it does nothing. At RAY
      // scale it survives. That is why compounding interest indices are held
      // in RAY: at WAD, a small per-second rate rounds to a no-op and the
      // index never moves.
      const principal = 10n ** 30n;

      expect(await harness.mulWadDown(principal, WAD)).to.equal(principal);
      expect(await harness.mulRayDown(principal, RAY + 1n)).to.equal(principal + 1000n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          DIRECTION DISPATCH
  //////////////////////////////////////////////////////////////*/

  describe('direction dispatch', () => {
    it('routes the WAD helpers', async () => {
      expect(await harness.mulWad(1n, WAD / 2n, DOWN)).to.equal(await harness.mulWadDown(1n, WAD / 2n));
      expect(await harness.mulWad(1n, WAD / 2n, UP)).to.equal(await harness.mulWadUp(1n, WAD / 2n));
      expect(await harness.divWad(1n, 3n * WAD, DOWN)).to.equal(await harness.divWadDown(1n, 3n * WAD));
      expect(await harness.divWad(1n, 3n * WAD, UP)).to.equal(await harness.divWadUp(1n, 3n * WAD));
    });

    it('routes the RAY helpers', async () => {
      expect(await harness.mulRay(1n, RAY / 2n, DOWN)).to.equal(await harness.mulRayDown(1n, RAY / 2n));
      expect(await harness.mulRay(1n, RAY / 2n, UP)).to.equal(await harness.mulRayUp(1n, RAY / 2n));
      expect(await harness.divRay(1n, 3n * RAY, DOWN)).to.equal(await harness.divRayDown(1n, 3n * RAY));
      expect(await harness.divRay(1n, 3n * RAY, UP)).to.equal(await harness.divRayUp(1n, 3n * RAY));
    });
  });

  /*//////////////////////////////////////////////////////////////
                          SCALE CONVERSION
  //////////////////////////////////////////////////////////////*/

  describe('scale conversion', () => {
    it('widens a WAD to a RAY exactly', async () => {
      expect(await harness.wadToRay(WAD)).to.equal(RAY);
      expect(await harness.wadToRay(0n)).to.equal(0n);
      expect(await harness.wadToRay(1n)).to.equal(10n ** 9n);
    });

    it('narrows a RAY to a WAD in the requested direction', async () => {
      expect(await harness.rayToWad(RAY, DOWN)).to.equal(WAD);

      // One below a clean WAD: the nine discarded digits are what decide it.
      expect(await harness.rayToWad(RAY - 1n, DOWN)).to.equal(WAD - 1n);
      expect(await harness.rayToWad(RAY - 1n, UP)).to.equal(WAD);
    });

    it('does not inflate an exact narrowing', async () => {
      expect(await harness.rayToWad(RAY, UP)).to.equal(WAD);
      expect(await harness.rayToWad(0n, UP)).to.equal(0n);
    });

    it('round-trips WAD to RAY and back without loss', async () => {
      for (const wad of [0n, 1n, WAD, 12345n * WAD + 6789n, 10n ** 30n]) {
        expect(await harness.rayToWad(await harness.wadToRay(wad), DOWN)).to.equal(wad);
        expect(await harness.rayToWad(await harness.wadToRay(wad), UP)).to.equal(wad);
      }
    });

    it('reverts rather than wrapping when a WAD has no RAY representation', async () => {
      // Silently wrapping here would corrupt an index instead of halting.
      await expect(harness.wadToRay(MAX)).to.be.reverted;
      await expect(harness.wadToRay(MAX / 10n ** 9n + 1n)).to.be.reverted;
    });

    it('accepts the largest WAD that still fits', async () => {
      const largest = MAX / 10n ** 9n;
      expect(await harness.wadToRay(largest)).to.equal(largest * 10n ** 9n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                            INVARIANTS
  //////////////////////////////////////////////////////////////*/

  describe('invariants', () => {
    it('keeps the up variant within one wei of the down variant', async () => {
      const pairs = [
        [7n, 13n],
        [WAD + 1n, WAD - 1n],
        [10n ** 24n + 7n, 3n],
      ];

      for (const [a, b] of pairs) {
        const down = await harness.mulWadDown(a, b);
        const up = await harness.mulWadUp(a, b);

        expect(up - down).to.be.oneOf([0n, 1n]);
      }
    });

    it('never lets mul-then-div recover more than went in', async () => {
      // Rounding down twice must not manufacture value.
      for (const [x, rate] of [
        [10n ** 21n + 7n, WAD / 3n],
        [999n, (WAD * 7n) / 11n],
        [WAD, WAD - 1n],
      ]) {
        const scaled = await harness.mulWadDown(x, rate);
        const back = await harness.divWadDown(scaled, rate);

        expect(back).to.be.lessThanOrEqual(x);
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                        DIFFERENTIAL FUZZING
  //////////////////////////////////////////////////////////////*/

  describe('differential vs BigInt reference', () => {
    const values = [0n, 1n, 2n, 999n, WAD - 1n, WAD, WAD + 1n, 10n ** 24n + 7n, RAY, RAY + 13n];

    it('matches the reference for every WAD pair', async () => {
      for (const a of values) {
        for (const b of values) {
          expect(await harness.mulWadDown(a, b), `mulWadDown(${a}, ${b})`).to.equal(
            refMul(a, b, WAD, false),
          );
          expect(await harness.mulWadUp(a, b), `mulWadUp(${a}, ${b})`).to.equal(
            refMul(a, b, WAD, true),
          );

          if (b === 0n) continue;
          expect(await harness.divWadDown(a, b), `divWadDown(${a}, ${b})`).to.equal(
            refDiv(a, b, WAD, false),
          );
          expect(await harness.divWadUp(a, b), `divWadUp(${a}, ${b})`).to.equal(
            refDiv(a, b, WAD, true),
          );
        }
      }
    });

    it('matches the reference for every RAY pair', async () => {
      for (const a of values) {
        for (const b of values) {
          expect(await harness.mulRayDown(a, b), `mulRayDown(${a}, ${b})`).to.equal(
            refMul(a, b, RAY, false),
          );
          expect(await harness.mulRayUp(a, b), `mulRayUp(${a}, ${b})`).to.equal(
            refMul(a, b, RAY, true),
          );

          if (b === 0n) continue;
          expect(await harness.divRayDown(a, b), `divRayDown(${a}, ${b})`).to.equal(
            refDiv(a, b, RAY, false),
          );
          expect(await harness.divRayUp(a, b), `divRayUp(${a}, ${b})`).to.equal(
            refDiv(a, b, RAY, true),
          );
        }
      }
    });
  });
});
