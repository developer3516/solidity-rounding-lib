const { expect } = require('chai');
const { ethers } = require('hardhat');

const DOWN = 0n;
const UP = 1n;
const WAD = 10n ** 18n;

/*//////////////////////////////////////////////////////////////
                        REFERENCE MODEL
//////////////////////////////////////////////////////////////*/

const refToShares = (assets, totalAssets, totalShares, offset, up) => {
  const num = assets * (totalShares + 10n ** offset);
  const den = totalAssets + 1n;
  return up && num % den !== 0n ? num / den + 1n : num / den;
};

const refToAssets = (shares, totalAssets, totalShares, offset, up) => {
  const num = shares * (totalAssets + 1n);
  const den = totalShares + 10n ** offset;
  return up && num % den !== 0n ? num / den + 1n : num / den;
};

describe('SharesMath', () => {
  let harness;

  before(async () => {
    harness = await (await ethers.getContractFactory('SharesMathHarness')).deploy();
  });

  /*//////////////////////////////////////////////////////////////
                            EMPTY VAULT
  //////////////////////////////////////////////////////////////*/

  describe('empty vault', () => {
    it('needs no special case — the virtual amounts keep denominators non-zero', async () => {
      // Both totals are zero. Without virtual assets and shares this is a
      // division by zero, and every vault has to branch around it. Here all
      // four conversions are simply 1:1.
      expect(await harness.previewDeposit(1000n, 0n, 0n, 0)).to.equal(1000n);
      expect(await harness.previewMint(1000n, 0n, 0n, 0)).to.equal(1000n);
      expect(await harness.previewWithdraw(1000n, 0n, 0n, 0)).to.equal(1000n);
      expect(await harness.previewRedeem(1000n, 0n, 0n, 0)).to.equal(1000n);
    });

    it('issues shares scaled by the decimals offset', async () => {
      expect(await harness.previewDeposit(WAD, 0n, 0n, 0)).to.equal(WAD);
      expect(await harness.previewDeposit(WAD, 0n, 0n, 6)).to.equal(WAD * 10n ** 6n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          THE ROUNDING TABLE
  //////////////////////////////////////////////////////////////*/

  describe('rounding table', () => {
    // A vault holding 3 assets against 2 shares — every conversion below has
    // a remainder, so each one reveals its direction.
    const ta = 3n;
    const ts = 2n;

    it('previewDeposit rounds down', async () => {
      expect(await harness.previewDeposit(1n, ta, ts, 0)).to.equal(
        refToShares(1n, ta, ts, 0n, false),
      );
      expect(await harness.previewDeposit(1n, ta, ts, 0)).to.be.lessThan(
        await harness.previewWithdraw(1n, ta, ts, 0),
      );
    });

    it('previewMint rounds up', async () => {
      expect(await harness.previewMint(1n, ta, ts, 0)).to.equal(refToAssets(1n, ta, ts, 0n, true));
      expect(await harness.previewMint(1n, ta, ts, 0)).to.be.greaterThan(
        await harness.previewRedeem(1n, ta, ts, 0),
      );
    });

    it('previewWithdraw rounds up', async () => {
      expect(await harness.previewWithdraw(1n, ta, ts, 0)).to.equal(
        refToShares(1n, ta, ts, 0n, true),
      );
    });

    it('previewRedeem rounds down', async () => {
      expect(await harness.previewRedeem(1n, ta, ts, 0)).to.equal(
        refToAssets(1n, ta, ts, 0n, false),
      );
    });

    it('every operation rounds toward the vault', async () => {
      // The asset-in/asset-out pair and the share-in/share-out pair must each
      // sit on opposite sides of the exact value, or some ordering of the two
      // extracts the difference.
      const depositShares = await harness.previewDeposit(1n, ta, ts, 0);
      const withdrawShares = await harness.previewWithdraw(1n, ta, ts, 0);
      const mintAssets = await harness.previewMint(1n, ta, ts, 0);
      const redeemAssets = await harness.previewRedeem(1n, ta, ts, 0);

      expect(depositShares).to.be.lessThanOrEqual(withdrawShares);
      expect(redeemAssets).to.be.lessThanOrEqual(mintAssets);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          DIRECTION DISPATCH
  //////////////////////////////////////////////////////////////*/

  describe('explicit direction', () => {
    it('toShares matches the preview helpers', async () => {
      expect(await harness.toShares(7n, 13n, 5n, 0, DOWN)).to.equal(
        await harness.previewDeposit(7n, 13n, 5n, 0),
      );
      expect(await harness.toShares(7n, 13n, 5n, 0, UP)).to.equal(
        await harness.previewWithdraw(7n, 13n, 5n, 0),
      );
    });

    it('toAssets matches the preview helpers', async () => {
      expect(await harness.toAssets(7n, 13n, 5n, 0, DOWN)).to.equal(
        await harness.previewRedeem(7n, 13n, 5n, 0),
      );
      expect(await harness.toAssets(7n, 13n, 5n, 0, UP)).to.equal(
        await harness.previewMint(7n, 13n, 5n, 0),
      );
    });
  });

  /*//////////////////////////////////////////////////////////////
                            ROUND TRIPS
  //////////////////////////////////////////////////////////////*/

  describe('round trips never mint value', () => {
    const cases = [
      { ta: 0n, ts: 0n },
      { ta: 1n, ts: 1n },
      { ta: 3n, ts: 2n },
      { ta: 1000n * WAD + 7n, ts: 999n * WAD },
      { ta: 999n * WAD, ts: 1000n * WAD + 7n },
    ];

    const amounts = [1n, 2n, 3n, 999n, WAD, 12345n * WAD + 1n];

    it('deposit then redeem returns no more than went in', async () => {
      for (const { ta, ts } of cases) {
        for (const assets of amounts) {
          const shares = await harness.previewDeposit(assets, ta, ts, 0);
          const back = await harness.previewRedeem(shares, ta, ts, 0);

          expect(back).to.be.lessThanOrEqual(assets, `assets=${assets} ta=${ta} ts=${ts}`);
        }
      }
    });

    it('mint then withdraw burns no fewer shares than were minted', async () => {
      for (const { ta, ts } of cases) {
        for (const shares of amounts) {
          const assets = await harness.previewMint(shares, ta, ts, 0);
          const burned = await harness.previewWithdraw(assets, ta, ts, 0);

          expect(burned).to.be.greaterThanOrEqual(shares, `shares=${shares} ta=${ta} ts=${ts}`);
        }
      }
    });

    it('holds at a non-zero decimals offset too', async () => {
      for (const assets of amounts) {
        const shares = await harness.previewDeposit(assets, 1000n * WAD + 7n, 999n * WAD, 6);
        const back = await harness.previewRedeem(shares, 1000n * WAD + 7n, 999n * WAD, 6);

        expect(back).to.be.lessThanOrEqual(assets);
      }
    });
  });

  /*//////////////////////////////////////////////////////////////
                          INFLATION ATTACK
  //////////////////////////////////////////////////////////////*/

  describe('inflation attack', () => {
    /**
     * The classic empty-vault donation attack:
     *   1. attacker deposits 1 wei into an empty vault
     *   2. attacker transfers a large balance straight to the vault, so the
     *      share price jumps without minting any shares
     *   3. the victim deposits, and their share count truncates
     *   4. attacker redeems and takes the rounded-away remainder
     */
    async function runAttack(offset) {
      const donation = 10_000n * WAD;
      const victimAssets = 10_000n * WAD;

      // 1. Attacker seeds the empty vault.
      const attackerShares = await harness.previewDeposit(1n, 0n, 0n, offset);
      let totalAssets = 1n;
      let totalShares = attackerShares;

      // 2. Donation inflates assets without minting shares.
      totalAssets += donation;

      // 3. Victim deposits at the inflated price.
      const victimShares = await harness.previewDeposit(victimAssets, totalAssets, totalShares, offset);
      totalAssets += victimAssets;
      totalShares += victimShares;

      // 4. Victim exits.
      const victimRecovers = await harness.previewRedeem(victimShares, totalAssets, totalShares, offset);

      const lostBps = ((victimAssets - victimRecovers) * 10_000n) / victimAssets;
      return { victimShares, victimRecovers, lostBps };
    }

    it('costs the victim dearly with no offset', async () => {
      const { victimShares, lostBps } = await runAttack(0);

      // A single share for a 10,000-token deposit — the truncation is total.
      expect(victimShares).to.equal(1n);
      expect(lostBps).to.be.greaterThan(2_000n); // more than 20%
    });

    it('is neutralised by a decimals offset', async () => {
      const { lostBps } = await runAttack(6);

      expect(lostBps).to.be.lessThan(10n); // under 0.1%
    });

    it('loses its bite as the offset grows', async () => {
      const losses = [];
      for (const offset of [0, 3, 6, 9]) {
        losses.push((await runAttack(offset)).lostBps);
      }

      // A third of the deposit at offset 0, two basis points at 3, and
      // nothing at all beyond that. Pinned exactly, because the whole point
      // of the offset is how sharply this falls off.
      expect(losses).to.deep.equal([3333n, 2n, 0n, 0n]);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          VAULT LIFECYCLE
  //////////////////////////////////////////////////////////////*/

  describe('vault lifecycle', () => {
    it('never lets depositors redeem more than the vault holds', async () => {
      // Three users deposit at different times with yield accruing between
      // them, then all exit. The sum of the payouts must not exceed the
      // assets actually present.
      let totalAssets = 0n;
      let totalShares = 0n;
      const positions = [];

      for (const [deposit, yieldAccrued] of [
        [1_000n * WAD, 0n],
        [2_500n * WAD, 37n * WAD + 13n],
        [777n * WAD + 1n, 91n * WAD + 7n],
      ]) {
        totalAssets += yieldAccrued;

        const shares = await harness.previewDeposit(deposit, totalAssets, totalShares, 6);
        totalAssets += deposit;
        totalShares += shares;
        positions.push(shares);
      }

      let paidOut = 0n;
      let remainingAssets = totalAssets;
      let remainingShares = totalShares;

      for (const shares of positions) {
        const assets = await harness.previewRedeem(shares, remainingAssets, remainingShares, 6);
        paidOut += assets;
        remainingAssets -= assets;
        remainingShares -= shares;
      }

      expect(paidOut).to.be.lessThanOrEqual(totalAssets);
      expect(remainingAssets).to.be.greaterThanOrEqual(0n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                        DIFFERENTIAL FUZZING
  //////////////////////////////////////////////////////////////*/

  describe('differential vs BigInt reference', () => {
    it('matches the reference across a spread of vault states', async () => {
      const states = [
        [0n, 0n],
        [1n, 1n],
        [3n, 2n],
        [WAD, WAD],
        [10n ** 24n, 10n ** 24n + 1n],
        [10n ** 24n + 1n, 10n ** 24n],
        [7n, 10n ** 30n],
      ];
      const amounts = [0n, 1n, 2n, 999n, WAD, 10n ** 21n + 7n];

      for (const [ta, ts] of states) {
        for (const amount of amounts) {
          for (const offset of [0n, 6n]) {
            const o = Number(offset);

            expect(await harness.previewDeposit(amount, ta, ts, o)).to.equal(
              refToShares(amount, ta, ts, offset, false),
              `previewDeposit(${amount}, ${ta}, ${ts}, ${o})`,
            );
            expect(await harness.previewWithdraw(amount, ta, ts, o)).to.equal(
              refToShares(amount, ta, ts, offset, true),
              `previewWithdraw(${amount}, ${ta}, ${ts}, ${o})`,
            );
            expect(await harness.previewRedeem(amount, ta, ts, o)).to.equal(
              refToAssets(amount, ta, ts, offset, false),
              `previewRedeem(${amount}, ${ta}, ${ts}, ${o})`,
            );
            expect(await harness.previewMint(amount, ta, ts, o)).to.equal(
              refToAssets(amount, ta, ts, offset, true),
              `previewMint(${amount}, ${ta}, ${ts}, ${o})`,
            );
          }
        }
      }
    });
  });
});
