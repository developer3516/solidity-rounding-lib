const { expect } = require('chai');
const { ethers } = require('hardhat');

const MAX = 2n ** 256n - 1n;

/**
 * Inputs chosen to exercise both branches of the 512-bit path, because the
 * cost differs sharply between them and a single number would hide that.
 */
const INPUTS = {
  /** Product fits in 256 bits — the fast path every implementation shares. */
  fastPath: [10n ** 18n, 3n * 10n ** 18n, 10n ** 18n],
  /** Product does not fit — only the 512-bit implementations survive here. */
  fullPath: [2n ** 200n, 2n ** 200n, 2n ** 250n],
};

describe('gas benchmark', () => {
  let bench;

  before(async () => {
    bench = await (await ethers.getContractFactory('GasBenchmark')).deploy();

    // Warm the storage slot. The first zero-to-non-zero SSTORE costs 20,000
    // gas and would swamp every difference being measured. The contract
    // initialises `sink` to 1, but warming it in this transaction context
    // makes the intent explicit rather than incidental.
    await (await bench.noop(1n, 1n, 1n)).wait();
  });

  /** Gas for one call, with the baseline subtracted so only the maths is left. */
  async function measure(method, [x, y, d]) {
    const baseline = await (await bench.noop(x, y, d)).wait();
    const actual = await (await bench[method](x, y, d)).wait();

    return actual.gasUsed - baseline.gasUsed;
  }

  async function table(inputs) {
    const methods = [
      ['Rounding.mulDivDown', 'roundingDown'],
      ['Rounding.mulDivUp', 'roundingUp'],
      ['OZ Math.mulDiv', 'openZeppelinDown'],
      ['OZ Math.mulDiv (Ceil)', 'openZeppelinUp'],
      ['Solmate mulDivDown', 'solmateDown'],
      ['Solmate mulDivUp', 'solmateUp'],
      ['naive x * y / d', 'naive'],
    ];

    const rows = [];
    for (const [label, method] of methods) {
      try {
        rows.push([label, await measure(method, inputs)]);
      } catch {
        rows.push([label, null]); // reverted — recorded, not skipped
      }
    }

    return rows;
  }

  function report(title, rows) {
    process.stdout.write(`\n      ${title}\n`);
    for (const [label, gas] of rows) {
      const value = gas === null ? 'reverts' : `${gas}`;
      process.stdout.write(`        ${label.padEnd(24)} ${value.padStart(8)}\n`);
    }
  }

  it('reports the fast path, where the product fits in 256 bits', async () => {
    const rows = await table(INPUTS.fastPath);
    report('product fits in 256 bits', rows);

    const gas = Object.fromEntries(rows);

    // Nothing reverts here — every implementation handles this range.
    // `.to.be.null` rather than `.to.equal(null)`: hardhat-chai-matchers
    // overrides `equal` to normalise both sides to BigInt, and null has no
    // BigInt form, so the assertion throws instead of failing.
    for (const [label, value] of rows) {
      expect(value, `${label} should not revert`).to.not.be.null;
    }

    // Solmate is cheaper because it does less: no 512-bit intermediate, so it
    // has no overflow branch to carry. Asserting the ordering documents the
    // trade rather than pretending it does not exist.
    expect(gas['Solmate mulDivDown']).to.be.lessThan(gas['Rounding.mulDivDown']);
  });

  it('stays within a sane margin of OpenZeppelin', async () => {
    const gas = Object.fromEntries(await table(INPUTS.fastPath));

    // Both implement the same algorithm, so a large gap means something has
    // regressed here — this is the assertion that would catch it.
    const ratio = Number(gas['Rounding.mulDivDown']) / Number(gas['OZ Math.mulDiv']);

    expect(ratio).to.be.lessThan(1.25, `mulDivDown is ${ratio.toFixed(2)}x OZ`);
  });

  it('reports the full 512-bit path', async () => {
    const rows = await table(INPUTS.fullPath);
    report('product exceeds 256 bits', rows);

    const gas = Object.fromEntries(rows);

    // The point of the 512-bit intermediate: the naive form and Solmate both
    // give up here, and this library does not.
    expect(gas['naive x * y / d']).to.be.null;
    expect(gas['Solmate mulDivDown']).to.be.null;
    expect(gas['Rounding.mulDivDown']).to.be.a('bigint');
    expect(gas['OZ Math.mulDiv']).to.be.a('bigint');
  });

  it('costs more on the 512-bit path than the fast path', async () => {
    // A sanity check on the measurement itself: if the two paths came back
    // identical, the harness would be measuring something other than the
    // arithmetic.
    const fast = await measure('roundingDown', INPUTS.fastPath);
    const full = await measure('roundingDown', INPUTS.fullPath);

    expect(full).to.be.greaterThan(fast);
  });

  it('confirms the naive form fails where the library does not', async () => {
    const [x, y, d] = INPUTS.fullPath;

    await expect(bench.naive(x, y, d)).to.be.reverted;
    await expect(bench.roundingDown(x, y, d)).to.not.be.reverted;

    // And the extreme case: max * max / max is exactly max.
    await expect(bench.roundingDown(MAX, MAX, MAX)).to.not.be.reverted;
  });
});
