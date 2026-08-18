// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Percentage} from "../Percentage.sol";
import {Rounding} from "../Rounding.sol";

/// @notice Test-only external surface for the `Percentage` library.
contract PercentageHarness {
    function bps() external pure returns (uint256) {
        return Percentage.BPS;
    }

    function feeOn(uint256 amount, uint256 rate) external pure returns (uint256) {
        return Percentage.feeOn(amount, rate);
    }

    function netOf(uint256 amount, uint256 rate) external pure returns (uint256) {
        return Percentage.netOf(amount, rate);
    }

    function split(uint256 amount, uint256 rate) external pure returns (uint256 fee, uint256 net) {
        return Percentage.split(amount, rate);
    }

    function applyBps(uint256 amount, uint256 rate, Rounding.Direction d) external pure returns (uint256) {
        return Percentage.applyBps(amount, rate, d);
    }

    function addBps(uint256 amount, uint256 rate, Rounding.Direction d) external pure returns (uint256) {
        return Percentage.addBps(amount, rate, d);
    }

    function subBps(uint256 amount, uint256 rate, Rounding.Direction d) external pure returns (uint256) {
        return Percentage.subBps(amount, rate, d);
    }

    function bpsOf(uint256 part, uint256 whole, Rounding.Direction d) external pure returns (uint256) {
        return Percentage.bpsOf(part, whole, d);
    }

    /// @notice The naive independent split, for contrast in the tests.
    /// @dev    What almost everyone writes. Both halves truncate, so on an
    ///         inexact division they sum to `amount - 1`.
    function naiveSplit(uint256 amount, uint256 rate) external pure returns (uint256 fee, uint256 net) {
        fee = (amount * rate) / Percentage.BPS;
        net = (amount * (Percentage.BPS - rate)) / Percentage.BPS;
    }
}
