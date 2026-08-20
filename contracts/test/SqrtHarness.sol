// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "../Rounding.sol";
import {Sqrt} from "../Sqrt.sol";

/// @notice Test-only external surface for the `Sqrt` library.
contract SqrtHarness {
    function sqrt(uint256 x, Rounding.Direction d) external pure returns (uint256) {
        return Sqrt.sqrt(x, d);
    }

    function floorSqrt(uint256 x) external pure returns (uint256) {
        return Sqrt.floorSqrt(x);
    }

    function geometricMean(uint256 a, uint256 b, Rounding.Direction d) external pure returns (uint256) {
        return Sqrt.geometricMean(a, b, d);
    }

    function geometricMeanScaled(
        uint256 a,
        uint256 b,
        uint256 denominator,
        Rounding.Direction d
    ) external pure returns (uint256) {
        return Sqrt.geometricMeanScaled(a, b, denominator, d);
    }

    function log2(uint256 x) external pure returns (uint256) {
        return Sqrt.log2(x);
    }

    /// @notice The naive form, for contrast: reverts where the library does not.
    function naiveGeometricMean(uint256 a, uint256 b) external pure returns (uint256) {
        return Sqrt.floorSqrt(a * b);
    }
}
