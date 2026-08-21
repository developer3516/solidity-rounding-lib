// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Percentage} from "./Percentage.sol";
import {Rounding} from "./Rounding.sol";

/// @title  Slippage
/// @notice Slippage bounds, rounded so the contract never invents a limit the
///         user did not ask for.
/// @dev    Every other library here rounds toward the protocol, because the
///         counterparty is a voluntary depositor and the dust may as well stay
///         with the pool. `Liquidation` already inverts that once — the
///         borrower is not in the room. This inverts it for a different
///         reason, and the reason is worth being precise about.
///
///         A slippage bound is **the user's own statement of what they will
///         accept**. It is not a protocol parameter. So the question is not
///         "which way favours the protocol" but "which way is faithful to what
///         the user said", and the answer is: a bound must be **permissive**.
///
///             minOut  ->  round DOWN   (never demand more than asked)
///             maxIn   ->  round UP     (never offer less than allowed)
///
///         Round `minOut` up instead and the contract quietly enforces a
///         tolerance a fraction tighter than the one the user set. Trades that
///         satisfy the user's actual limit revert, and the failure is
///         invisible: the transaction reverts with "insufficient output" while
///         the output was, by the user's own arithmetic, sufficient. Nobody
///         debugs that from a revert string.
///
///         The check itself is a separate decision, and it is **inclusive**.
///         `actual == minOut` is exactly the limit the user set; rejecting it
///         would be enforcing `>` on a bound that was stated as `>=`.
library Slippage {
    /// @notice The trade returned less than the caller's floor.
    error InsufficientOutput(uint256 actual, uint256 minOut);

    /// @notice The trade cost more than the caller's ceiling.
    error ExcessiveInput(uint256 actual, uint256 maxIn);

    /// @notice The tolerance exceeded 100%.
    error ToleranceOutOfRange(uint256 toleranceBps);

    /*//////////////////////////////////////////////////////////////
                                 BOUNDS
    //////////////////////////////////////////////////////////////*/

    /// @notice The least output a caller will accept, given a quote.
    /// @dev    Rounds **down**. Rounding up would enforce a tolerance tighter
    ///         than the one asked for, reverting trades that satisfy the
    ///         user's actual limit.
    function minOut(uint256 quoted, uint256 toleranceBps) internal pure returns (uint256) {
        if (toleranceBps > Percentage.BPS) revert ToleranceOutOfRange(toleranceBps);

        unchecked {
            // `BPS - toleranceBps` cannot underflow after the check above.
            return Rounding.mulDivDown(quoted, Percentage.BPS - toleranceBps, Percentage.BPS);
        }
    }

    /// @notice The most input a caller will spend, given a quote.
    /// @dev    Rounds **up**, for the mirror-image reason: a ceiling rounded
    ///         down offers less room than the user allowed.
    function maxIn(uint256 quoted, uint256 toleranceBps) internal pure returns (uint256) {
        return Rounding.mulDivUp(quoted, Percentage.BPS + toleranceBps, Percentage.BPS);
    }

    /// @notice A bound in an explicit direction, for callers that need one.
    function bound(
        uint256 quoted,
        uint256 toleranceBps,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        if (toleranceBps > Percentage.BPS) revert ToleranceOutOfRange(toleranceBps);

        unchecked {
            return Rounding.mulDiv(quoted, Percentage.BPS - toleranceBps, Percentage.BPS, direction);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 CHECKS
    //////////////////////////////////////////////////////////////*/

    /// @notice Require `actual >= floor`.
    /// @dev    Inclusive. Landing exactly on the stated limit is the limit
    ///         being met, and rejecting it enforces `>` on a bound the user
    ///         expressed as `>=`.
    function requireMinOut(uint256 actual, uint256 floor) internal pure {
        if (actual < floor) revert InsufficientOutput(actual, floor);
    }

    /// @notice Require `actual <= ceiling`.
    function requireMaxIn(uint256 actual, uint256 ceiling) internal pure {
        if (actual > ceiling) revert ExcessiveInput(actual, ceiling);
    }

    /*//////////////////////////////////////////////////////////////
                               REPORTING
    //////////////////////////////////////////////////////////////*/

    /// @notice How far `actual` fell below `quoted`, in basis points.
    /// @dev    Rounds **up**, so a report never understates what happened. An
    ///         analytics figure that rounds slippage down toward zero is the
    ///         one nobody notices drifting.
    function realisedBps(uint256 quoted, uint256 actual) internal pure returns (uint256) {
        if (actual >= quoted) return 0;

        unchecked {
            return Rounding.mulDivUp(quoted - actual, Percentage.BPS, quoted);
        }
    }

    /// @notice Whether `actual` is within `toleranceBps` of `quoted`.
    /// @dev    Uses the same permissive floor the bound does, so asking and
    ///         enforcing cannot disagree by a unit.
    function isWithinTolerance(
        uint256 quoted,
        uint256 actual,
        uint256 toleranceBps
    ) internal pure returns (bool) {
        return actual >= minOut(quoted, toleranceBps);
    }
}
