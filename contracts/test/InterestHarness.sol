// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Interest} from "../Interest.sol";
import {Rounding} from "../Rounding.sol";

/// @notice Test-only external surface for the `Interest` library.
contract InterestHarness {
    function maxCompoundPeriod() external pure returns (uint256) {
        return Interest.MAX_COMPOUND_PERIOD;
    }

    function linear(uint256 rate, uint256 elapsed) external pure returns (uint256) {
        return Interest.linear(rate, elapsed);
    }

    function compound(uint256 rate, uint256 elapsed) external pure returns (uint256) {
        return Interest.compound(rate, elapsed);
    }

    function applyToDebt(uint256 amount, uint256 factor) external pure returns (uint256) {
        return Interest.applyToDebt(amount, factor);
    }

    function applyToClaim(uint256 amount, uint256 factor) external pure returns (uint256) {
        return Interest.applyToClaim(amount, factor);
    }

    function applyFactor(uint256 a, uint256 f, Rounding.Direction d) external pure returns (uint256) {
        return Interest.applyFactor(a, f, d);
    }

    function advanceIndex(uint256 index, uint256 factor) external pure returns (uint256) {
        return Interest.advanceIndex(index, factor);
    }

    function fromScaled(uint256 s, uint256 i, Rounding.Direction d) external pure returns (uint256) {
        return Interest.fromScaled(s, i, d);
    }

    function toScaled(uint256 a, uint256 i, Rounding.Direction d) external pure returns (uint256) {
        return Interest.toScaled(a, i, d);
    }
}
