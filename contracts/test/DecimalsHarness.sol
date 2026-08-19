// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Decimals} from "../Decimals.sol";
import {Rounding} from "../Rounding.sol";

/// @notice Test-only external surface for the `Decimals` library.
contract DecimalsHarness {
    function maxDecimals() external pure returns (uint8) {
        return Decimals.MAX_DECIMALS;
    }

    function convert(
        uint256 amount,
        uint8 from,
        uint8 to,
        Rounding.Direction d
    ) external pure returns (uint256) {
        return Decimals.convert(amount, from, to, d);
    }

    function widen(uint256 amount, uint8 from, uint8 to) external pure returns (uint256) {
        return Decimals.widen(amount, from, to);
    }

    function narrow(
        uint256 amount,
        uint8 from,
        uint8 to,
        Rounding.Direction d
    ) external pure returns (uint256) {
        return Decimals.narrow(amount, from, to, d);
    }

    function roundTripLoss(uint256 amount, uint8 from, uint8 to) external pure returns (uint256) {
        return Decimals.roundTripLoss(amount, from, to);
    }

    function isExact(uint256 amount, uint8 from, uint8 to) external pure returns (bool) {
        return Decimals.isExact(amount, from, to);
    }

    function pow10(uint8 exponent) external pure returns (uint256) {
        return Decimals.pow10(exponent);
    }
}
