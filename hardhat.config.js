require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('hardhat-gas-reporter');
require('solidity-coverage');

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.30',
    settings: {
      // A library is deployed once (or inlined) and called constantly, so
      // optimise hard for runtime cost rather than deployment size.
      optimizer: { enabled: true, runs: 1_000_000 },
      evmVersion: 'cancun',
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
};
