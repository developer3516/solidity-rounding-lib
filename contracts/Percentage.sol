// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  Percentage
/// @notice Basis-point arithmetic with the fee/net split guaranteed to add up.
/// @dev    A fee is not one calculation, it is two: how much the protocol
///         takes, and how much the user is left with. The obvious way to write
///         them is independently —
///
///             fee = amount * feeBps / 10_000
///             net = amount * (10_000 - feeBps) / 10_000
///
///         — and that is wrong roughly half the time. Both truncate, so
///         whenever the division is inexact the two results sum to `amount - 1`
///         and a unit vanishes. Round both up instead and they sum to
///         `amount + 1`, which is worse: the contract now owes more than it
///         holds, and on a large enough batch it cannot settle.
///
///         `split` computes the fee and derives the net by **subtraction**, so
///         `fee + net == amount` holds exactly, for every input, with no
///         rounding argument to get wrong. That identity is the whole point of
///         this library, and the suite asserts it against the naive form.
///
///         Direction still matters for the part that *is* a choice: a fee
///         rounds up, toward the protocol, because the alternative is a
///         protocol that pays out its own dust.
library Percentage {
    /// @notice One hundred percent, in basis points.
    uint256 internal constant BPS = 10_000;

    /// @notice The rate exceeded 100%.
    error BpsOutOfRange(uint256 bps);

    /*//////////////////////////////////////////////////////////////
                              FEE AND NET
    //////////////////////////////////////////////////////////////*/

    /// @notice The fee on `amount` at `bps`, rounded up.
    /// @dev    Up, toward the protocol. A fee that rounds down is a protocol
    ///         donating dust on every transaction it processes.
    function feeOn(uint256 amount, uint256 bps) internal pure returns (uint256) {
        if (bps > BPS) revert BpsOutOfRange(bps);
        return Rounding.mulDivUp(amount, bps, BPS);
    }

    /// @notice What is left of `amount` after the fee at `bps`.
    /// @dev    Derived by subtraction rather than computed from
    ///         `BPS - bps`, which is what makes `fee + net == amount` exact.
    function netOf(uint256 amount, uint256 bps) internal pure returns (uint256) {
        unchecked {
            // `feeOn` rounds up but can never exceed `amount`, because
            // `bps <= BPS` — so this cannot underflow.
            return amount - feeOn(amount, bps);
        }
    }

    /// @notice Both halves at once, guaranteed to sum to `amount`.
    function split(uint256 amount, uint256 bps) internal pure returns (uint256 fee, uint256 net) {
        fee = feeOn(amount, bps);
        unchecked {
            net = amount - fee;
        }
    }

    /*//////////////////////////////////////////////////////////////
                             GENERAL RATES
    //////////////////////////////////////////////////////////////*/

    /// @notice `amount * bps / BPS`, rounded in `direction`.
    /// @dev    Unlike `feeOn`, this accepts a rate above 100% — multipliers,
    ///         penalty rates and liquidation bonuses are legitimately more
    ///         than `BPS`, and rejecting them here would push callers back to
    ///         hand-rolled `mulDiv`.
    function applyBps(
        uint256 amount,
        uint256 bps,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return Rounding.mulDiv(amount, bps, BPS, direction);
    }

    /// @notice `amount` increased by `bps`, rounded in `direction`.
    function addBps(
        uint256 amount,
        uint256 bps,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return amount + applyBps(amount, bps, direction);
    }

    /// @notice `amount` reduced by `bps`, rounded in `direction`.
    /// @dev    `direction` describes the *deduction*, so `Up` takes more away
    ///         and leaves less. Rounding the deduction up is the conservative
    ///         choice when the remainder is what gets paid out.
    function subBps(
        uint256 amount,
        uint256 bps,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        if (bps > BPS) revert BpsOutOfRange(bps);
        unchecked {
            return amount - applyBps(amount, bps, direction);
        }
    }

    /// @notice What fraction `part` is of `whole`, in basis points.
    /// @dev    Reverts on a zero `whole` via `Rounding`, rather than reporting
    ///         a share of nothing as zero.
    function bpsOf(
        uint256 part,
        uint256 whole,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return Rounding.mulDiv(part, BPS, whole, direction);
    }
}
