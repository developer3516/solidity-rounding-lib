// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {Rounding} from "../Rounding.sol";

/// @notice Gas harness comparing this library against OpenZeppelin and Solmate.
/// @dev    Every function here is non-view and writes to `sink`, so each call
///         produces a receipt with a real `gasUsed`. A `view` function
///         measured through `estimateGas` would fold in the transaction's
///         intrinsic cost and calldata pricing, which say nothing about the
///         arithmetic.
///
///         `noop` exists to be subtracted: it has the same signature, the same
///         calldata shape and the same storage write as the others, so
///         `gasUsed(op) - gasUsed(noop)` isolates the library call itself.
///
///         The storage slot is pre-warmed by the test before measuring.
///         Otherwise the first write pays 20,000 gas for a cold zero-to-
///         non-zero SSTORE and swamps the difference being measured.
contract GasBenchmark {
    uint256 public sink = 1;

    /// @notice Baseline: same shape, no arithmetic.
    function noop(uint256 x, uint256 y, uint256 d) external {
        sink = x | y | d;
    }

    function roundingDown(uint256 x, uint256 y, uint256 d) external {
        sink = Rounding.mulDivDown(x, y, d);
    }

    function roundingUp(uint256 x, uint256 y, uint256 d) external {
        sink = Rounding.mulDivUp(x, y, d);
    }

    function openZeppelinDown(uint256 x, uint256 y, uint256 d) external {
        sink = Math.mulDiv(x, y, d);
    }

    function openZeppelinUp(uint256 x, uint256 y, uint256 d) external {
        sink = Math.mulDiv(x, y, d, Math.Rounding.Ceil);
    }

    /// @dev Solmate's `mulDivDown` has no 512-bit intermediate — it reverts
    ///      whenever `x * y` overflows, whatever the quotient would have been.
    ///      It is cheaper because it does less, which is the point of
    ///      measuring it alongside rather than instead.
    function solmateDown(uint256 x, uint256 y, uint256 d) external {
        sink = FixedPointMathLib.mulDivDown(x, y, d);
    }

    function solmateUp(uint256 x, uint256 y, uint256 d) external {
        sink = FixedPointMathLib.mulDivUp(x, y, d);
    }

    /// @notice Naive `x * y / d`, for reference — overflows where the others do not.
    function naive(uint256 x, uint256 y, uint256 d) external {
        sink = (x * y) / d;
    }
}
