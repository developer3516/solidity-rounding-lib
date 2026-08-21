// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Percentage} from "../Percentage.sol";
import {Rounding} from "../Rounding.sol";
import {Slippage} from "../Slippage.sol";

/// @notice Test-only external surface for the `Slippage` library.
contract SlippageHarness {
    function minOut(uint256 quoted, uint256 toleranceBps) external pure returns (uint256) {
        return Slippage.minOut(quoted, toleranceBps);
    }

    function maxIn(uint256 quoted, uint256 toleranceBps) external pure returns (uint256) {
        return Slippage.maxIn(quoted, toleranceBps);
    }

    function bound(uint256 q, uint256 t, Rounding.Direction d) external pure returns (uint256) {
        return Slippage.bound(q, t, d);
    }

    function requireMinOut(uint256 actual, uint256 floor) external pure {
        Slippage.requireMinOut(actual, floor);
    }

    function requireMaxIn(uint256 actual, uint256 ceiling) external pure {
        Slippage.requireMaxIn(actual, ceiling);
    }

    function realisedBps(uint256 quoted, uint256 actual) external pure returns (uint256) {
        return Slippage.realisedBps(quoted, actual);
    }

    function isWithinTolerance(uint256 q, uint256 a, uint256 t) external pure returns (bool) {
        return Slippage.isWithinTolerance(q, a, t);
    }

    /// @notice The same floor rounded the wrong way, for contrast in the tests.
    /// @dev    Enforces a tolerance tighter than the caller asked for.
    function strictMinOut(uint256 quoted, uint256 toleranceBps) external pure returns (uint256) {
        return Rounding.mulDivUp(quoted, Percentage.BPS - toleranceBps, Percentage.BPS);
    }
}
