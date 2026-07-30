// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "../Rounding.sol";

/// @title  RoundingHarness
/// @notice Test-only external surface for the `Rounding` library.
/// @dev    `internal` library functions cannot be called from a test runner
///         directly. Exposing them through a deployed harness means the suite
///         exercises the real compiled bytecode — including the revert paths,
///         which an inlined pure-JS reimplementation would never reach.
contract RoundingHarness {
    function opposite(Rounding.Direction direction) external pure returns (Rounding.Direction) {
        return Rounding.opposite(direction);
    }

    function div(uint256 a, uint256 b, Rounding.Direction direction) external pure returns (uint256) {
        return Rounding.div(a, b, direction);
    }

    function divDown(uint256 a, uint256 b) external pure returns (uint256) {
        return Rounding.divDown(a, b);
    }

    function divUp(uint256 a, uint256 b) external pure returns (uint256) {
        return Rounding.divUp(a, b);
    }

    function mulDiv(
        uint256 x,
        uint256 y,
        uint256 denominator,
        Rounding.Direction direction
    ) external pure returns (uint256) {
        return Rounding.mulDiv(x, y, denominator, direction);
    }

    function mulDivDown(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return Rounding.mulDivDown(x, y, denominator);
    }

    function mulDivUp(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return Rounding.mulDivUp(x, y, denominator);
    }
}
