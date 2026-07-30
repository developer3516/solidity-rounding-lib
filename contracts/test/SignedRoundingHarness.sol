// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "../Rounding.sol";
import {SignedRounding} from "../SignedRounding.sol";

/// @notice Test-only external surface for the `SignedRounding` library.
contract SignedRoundingHarness {
    function mulDiv(int256 x, int256 y, int256 d, Rounding.Direction dir) external pure returns (int256) {
        return SignedRounding.mulDiv(x, y, d, dir);
    }

    function mulDivDown(int256 x, int256 y, int256 d) external pure returns (int256) {
        return SignedRounding.mulDivDown(x, y, d);
    }

    function mulDivUp(int256 x, int256 y, int256 d) external pure returns (int256) {
        return SignedRounding.mulDivUp(x, y, d);
    }

    function div(int256 a, int256 b, Rounding.Direction dir) external pure returns (int256) {
        return SignedRounding.div(a, b, dir);
    }

    function divDown(int256 a, int256 b) external pure returns (int256) {
        return SignedRounding.divDown(a, b);
    }

    function divUp(int256 a, int256 b) external pure returns (int256) {
        return SignedRounding.divUp(a, b);
    }

    function abs(int256 x) external pure returns (uint256) {
        return SignedRounding.abs(x);
    }

    /// @notice Solidity's native division, for contrast in the tests.
    function nativeDiv(int256 a, int256 b) external pure returns (int256) {
        return a / b;
    }
}
