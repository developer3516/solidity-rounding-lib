// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Liquidation} from "../Liquidation.sol";
import {Rounding} from "../Rounding.sol";

/// @notice Test-only external surface for the `Liquidation` library.
contract LiquidationHarness {
    function maxBonusBps() external pure returns (uint256) {
        return Liquidation.MAX_BONUS_BPS;
    }

    function collateralToSeize(
        uint256 debtRepaid,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint256 bonusBps
    ) external pure returns (uint256) {
        return
            Liquidation.collateralToSeize(
                debtRepaid,
                debtDecimals,
                debtPrice,
                collateralDecimals,
                collateralPrice,
                bonusBps
            );
    }

    function seizeWithDirection(
        uint256 debtRepaid,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint256 bonusBps,
        Rounding.Direction direction
    ) external pure returns (uint256) {
        return
            Liquidation.seizeWithDirection(
                debtRepaid,
                debtDecimals,
                debtPrice,
                collateralDecimals,
                collateralPrice,
                bonusBps,
                direction
            );
    }

    function debtForCollateral(
        uint256 collateralSeized,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint256 bonusBps
    ) external pure returns (uint256) {
        return
            Liquidation.debtForCollateral(
                collateralSeized,
                collateralDecimals,
                collateralPrice,
                debtDecimals,
                debtPrice,
                bonusBps
            );
    }

    function maxRepayable(uint256 totalDebt, uint256 closeFactorBps) external pure returns (uint256) {
        return Liquidation.maxRepayable(totalDebt, closeFactorBps);
    }

    function bonusPortion(uint256 seized, uint256 bonusBps) external pure returns (uint256) {
        return Liquidation.bonusPortion(seized, bonusBps);
    }
}
