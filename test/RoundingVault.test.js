const { expect } = require('chai');
const { ethers } = require('hardhat');

const WAD = 10n ** 18n;

describe('RoundingVault', () => {
  let token, alice, bob, attacker;

  /** Deploy a vault of the given kind with an inexact assets/shares ratio. */
  async function setup(kind = 'RoundingVault', offset = 6) {
    token = await (await ethers.getContractFactory('MockERC20')).deploy();
    const vault = await (await ethers.getContractFactory(kind)).deploy(
      await token.getAddress(),
      offset,
      'Vault Share',
      'vMOCK',
    );

    for (const who of [alice, bob, attacker]) {
      await token.mint(who.address, 1_000_000n * WAD);
      await token.connect(who).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    return vault;
  }

  /** Seed the vault, then donate so the share price is not a round number. */
  async function seedWithDust(vault) {
    await vault.connect(alice).deposit(1000n * WAD);
    await token.mint(await vault.getAddress(), 7n); // 7 wei of yield
  }

  before(async () => {
    [alice, bob, attacker] = await ethers.getSigners();
  });

  /*//////////////////////////////////////////////////////////////
                              BASICS
  //////////////////////////////////////////////////////////////*/

  describe('basics', () => {
    it('prices the first deposit against an empty vault', async () => {
      const vault = await setup('RoundingVault', 0);

      await vault.connect(alice).deposit(100n * WAD);

      expect(await vault.balanceOf(alice.address)).to.equal(100n * WAD);
      expect(await vault.totalAssets()).to.equal(100n * WAD);
    });

    it('scales the first deposit by the decimals offset', async () => {
      const vault = await setup('RoundingVault', 6);

      await vault.connect(alice).deposit(100n * WAD);

      expect(await vault.balanceOf(alice.address)).to.equal(100n * WAD * 10n ** 6n);
    });

    it('shares yield with existing depositors', async () => {
      const vault = await setup('RoundingVault', 6);
      await vault.connect(alice).deposit(1000n * WAD);

      await token.mint(await vault.getAddress(), 100n * WAD); // 10% yield

      const shares = await vault.balanceOf(alice.address);
      expect(await vault.previewRedeem(shares)).to.be.closeTo(1100n * WAD, 10n);
    });

    it('mints exactly the shares asked for', async () => {
      const vault = await setup();
      await seedWithDust(vault);

      const before = await vault.balanceOf(bob.address);
      await vault.connect(bob).mint(500n * WAD);

      expect((await vault.balanceOf(bob.address)) - before).to.equal(500n * WAD);
    });

    it('withdraws exactly the assets asked for', async () => {
      const vault = await setup();
      await seedWithDust(vault);
      await vault.connect(bob).deposit(1000n * WAD);

      const before = await token.balanceOf(bob.address);
      await vault.connect(bob).withdraw(400n * WAD);

      expect((await token.balanceOf(bob.address)) - before).to.equal(400n * WAD);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          THE COUNTEREXAMPLE
  //////////////////////////////////////////////////////////////*/

  describe('one reversed direction is enough', () => {
    /**
     * Deposit once, then exit the whole position in `chunks` redemptions, and
     * report the total received.
     *
     * Splitting an exit is the sharp test rather than deposit/redeem
     * round-tripping: a round trip pays the deposit's floor once and collects
     * the redemption's ceiling once, and the two cancel. Splitting collects
     * the ceiling `chunks` times while paying the floor once, so a reversed
     * direction stops cancelling and starts accumulating.
     *
     * There is nothing clever going on. It is a withdrawal, in instalments.
     */
    async function exitInChunks(kind, chunks) {
      const vault = await setup(kind);
      await seedWithDust(vault);

      const before = await token.balanceOf(attacker.address);
      await vault.connect(attacker).deposit(1000n * WAD + 3n);

      const total = await vault.balanceOf(attacker.address);
      const piece = total / BigInt(chunks);

      for (let i = 0; i < chunks - 1; i += 1) {
        await vault.connect(attacker).redeem(piece);
      }
      await vault.connect(attacker).redeem(await vault.balanceOf(attacker.address));

      return (await token.balanceOf(attacker.address)) - before;
    }

    it('leaves the correct vault whole however the exit is split', async () => {
      const single = await exitInChunks('RoundingVault', 1);
      const split = await exitInChunks('RoundingVault', 50);

      // Never ahead, and splitting buys nothing. Losing a unit to rounding is
      // fine — that unit stays with the other depositors, which is the safe
      // direction for it to go.
      expect(single).to.be.lessThanOrEqual(0n);
      expect(split).to.be.lessThanOrEqual(0n);
    });

    it('pays the broken one out more the more finely it is split', async () => {
      const single = await exitInChunks('BrokenVault', 1);
      const split = await exitInChunks('BrokenVault', 50);

      expect(split).to.be.greaterThan(single);
      expect(split).to.be.greaterThan(0n);
    });

    it('leaks more with more instalments, up to the dust available', async () => {
      const one = await exitInChunks('BrokenVault', 1);
      const ten = await exitInChunks('BrokenVault', 10);
      const twoHundred = await exitInChunks('BrokenVault', 200);

      // Splitting further keeps paying until there is no fractional remainder
      // left to round up, then plateaus. The ceiling cannot invent value out
      // of nothing — it can only hand over what has accumulated as dust.
      expect(ten).to.be.greaterThan(one);
      expect(twoHundred).to.be.greaterThanOrEqual(ten);

      // Which is the part worth being precise about: this seeded vault holds
      // 7 wei of dust, so the leak is small. It is bounded by dust, not by
      // anything in the code — and a live vault accrues dust continuously, so
      // the bound rises every time yield lands.
      expect(twoHundred).to.be.lessThanOrEqual(7n);
    });

    it('takes the difference out of the other depositors', async () => {
      const vault = await setup('BrokenVault');
      await seedWithDust(vault);

      const aliceShares = await vault.balanceOf(alice.address);
      const worthBefore = await vault.previewRedeem(aliceShares);

      await vault.connect(attacker).deposit(1000n * WAD + 3n);
      const piece = (await vault.balanceOf(attacker.address)) / 50n;
      for (let i = 0; i < 49; i += 1) await vault.connect(attacker).redeem(piece);
      await vault.connect(attacker).redeem(await vault.balanceOf(attacker.address));

      // Alice did nothing and still holds every share she had. They are worth
      // less, and the difference is sitting in the attacker's wallet.
      expect(await vault.balanceOf(alice.address)).to.equal(aliceShares);
      expect(await vault.previewRedeem(aliceShares)).to.be.lessThan(worthBefore);
    });

    it('differs from the correct vault by exactly one argument', async () => {
      // Both vaults, same state, same call — the only divergence is the
      // rounding direction, and it shows up as a single unit.
      const correct = await setup('RoundingVault');
      await seedWithDust(correct);
      await correct.connect(bob).deposit(1000n * WAD + 3n);
      const correctOut = await correct.previewRedeem(await correct.balanceOf(bob.address));

      const broken = await setup('BrokenVault');
      await seedWithDust(broken);
      await broken.connect(bob).deposit(1000n * WAD + 3n);
      const brokenOut = await broken.previewRedeem(await broken.balanceOf(bob.address));

      expect(brokenOut - correctOut).to.equal(1n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                          INFLATION ATTACK
  //////////////////////////////////////////////////////////////*/

  describe('inflation attack, against a real contract', () => {
    async function runAttack(offset) {
      const vault = await setup('RoundingVault', offset);

      await vault.connect(attacker).deposit(1n); // seed an empty vault
      await token.connect(attacker).transfer(await vault.getAddress(), 10_000n * WAD); // donate

      const before = await token.balanceOf(bob.address);
      await vault.connect(bob).deposit(10_000n * WAD);
      await vault.connect(bob).redeem(await vault.balanceOf(bob.address));
      const after = await token.balanceOf(bob.address);

      return before - after; // what the victim lost
    }

    it('costs the victim a third of the deposit with no offset', async () => {
      const lost = await runAttack(0);

      expect(lost).to.be.greaterThan((10_000n * WAD * 30n) / 100n);
    });

    it('costs essentially nothing with a decimals offset', async () => {
      const lost = await runAttack(6);

      expect(lost).to.be.lessThan((10_000n * WAD) / 100_000n);
    });
  });

  /*//////////////////////////////////////////////////////////////
                            SOLVENCY
  //////////////////////////////////////////////////////////////*/

  describe('solvency', () => {
    it('can pay everyone out after mixed activity', async () => {
      const vault = await setup('RoundingVault');

      await vault.connect(alice).deposit(1000n * WAD);
      await token.mint(await vault.getAddress(), 37n * WAD + 13n);
      await vault.connect(bob).deposit(2500n * WAD + 1n);
      await token.mint(await vault.getAddress(), 91n * WAD + 7n);
      await vault.connect(attacker).mint(400n * WAD);

      for (const who of [alice, bob, attacker]) {
        const shares = await vault.balanceOf(who.address);
        if (shares > 0n) await vault.connect(who).redeem(shares);
      }

      // Every share burned, and the vault never went short — whatever dust is
      // left over is dust it kept, not dust it owed.
      expect(await vault.totalSupply()).to.equal(0n);
      expect(await vault.totalAssets()).to.be.greaterThanOrEqual(0n);
    });
  });
});
