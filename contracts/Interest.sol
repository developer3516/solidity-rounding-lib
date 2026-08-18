// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FixedPoint} from "./FixedPoint.sol";
import {Rounding} from "./Rounding.sol";

/// @title  Interest
/// @notice Interest accrual factors in RAY, with the rounding asymmetry that
///         keeps a lending market solvent.
/// @dev    A lending market accrues interest twice over the same period: once
///         onto what borrowers owe, once onto what suppliers are owed. The
///         two must not round the same way.
///
///             borrower debt   ->  round UP    (owes at least this)
///             supplier claim  ->  round DOWN  (owed at most this)
///
///         Round both down and the market slowly pays out interest it never
///         collected. Round both up and it promises suppliers more than
///         borrowers were charged. Either way the gap accumulates every block
///         and is only visible when the last supplier tries to exit.
///
///         `applyToDebt` and `applyToClaim` name those two directions so the
///         choice is not made freehand at each call site — the same argument
///         `SharesMath` makes for vault conversions.
///
///         Rates are per-second in RAY, which is why RAY exists: a 5% APR is
///         about `1.0000000015` per second, and at WAD scale that rate *is*
///         exactly 1.0, so the index would never move.
library Interest {
    /// @notice The compounding approximation was asked for too long a period.
    error PeriodTooLong(uint256 elapsed);

    /// @dev Beyond roughly a year the third-order truncation stops being
    ///      negligible, so the approximation refuses rather than drifting.
    uint256 internal constant MAX_COMPOUND_PERIOD = 400 days;

    /*//////////////////////////////////////////////////////////////
                                 FACTORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Simple interest: `RAY + rate * elapsed`.
    /// @dev    Exact — no approximation, no rounding. Used for the borrow side
    ///         in markets that charge simple interest, and as the lower bound
    ///         the compounded factor is checked against.
    function linear(uint256 ratePerSecond, uint256 elapsed) internal pure returns (uint256) {
        return FixedPoint.RAY + ratePerSecond * elapsed;
    }

    /// @notice Compounded interest, `(RAY + rate)^elapsed`, via binomial expansion.
    /// @dev    Computing the exact power on chain costs far more gas than the
    ///         error is worth, so this takes the first three terms:
    ///
    ///             1 + nx + n(n-1)/2 x^2 + n(n-1)(n-2)/6 x^3
    ///
    ///         with `n = elapsed` and `x = ratePerSecond`. The omitted terms
    ///         are positive, so the result is always an **underestimate** —
    ///         which is the safe direction for a borrow index (it never
    ///         charges more than true compounding would) and is why the period is
    ///         capped rather than left open.
    ///
    ///         This is the approximation Aave uses, for the same reasons.
    function compound(uint256 ratePerSecond, uint256 elapsed) internal pure returns (uint256) {
        if (elapsed > MAX_COMPOUND_PERIOD) revert PeriodTooLong(elapsed);
        if (elapsed == 0) return FixedPoint.RAY;

        unchecked {
            uint256 expMinusOne = elapsed - 1;
            uint256 expMinusTwo = elapsed > 2 ? elapsed - 2 : 0;

            uint256 basePowerTwo = FixedPoint.mulRayDown(ratePerSecond, ratePerSecond);
            uint256 basePowerThree = FixedPoint.mulRayDown(basePowerTwo, ratePerSecond);

            uint256 secondTerm = (elapsed * expMinusOne * basePowerTwo) / 2;
            uint256 thirdTerm = (elapsed * expMinusOne * expMinusTwo * basePowerThree) / 6;

            return FixedPoint.RAY + ratePerSecond * elapsed + secondTerm + thirdTerm;
        }
    }

    /*//////////////////////////////////////////////////////////////
                            APPLYING A FACTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Grow a debt by an accrual factor, rounding **up**.
    /// @dev    A borrower owes at least the accrued amount. Rounding down here
    ///         forgives a unit of interest on every accrual, which over a
    ///         market's lifetime is real money the suppliers were promised.
    function applyToDebt(uint256 amount, uint256 factor) internal pure returns (uint256) {
        return FixedPoint.mulRayUp(amount, factor);
    }

    /// @notice Grow a claim by an accrual factor, rounding **down**.
    /// @dev    A supplier is owed at most the accrued amount. The remainder
    ///         stays in the market, which is the only direction that cannot
    ///         make it insolvent.
    function applyToClaim(uint256 amount, uint256 factor) internal pure returns (uint256) {
        return FixedPoint.mulRayDown(amount, factor);
    }

    /// @notice Apply a factor in an explicit direction.
    function applyFactor(
        uint256 amount,
        uint256 factor,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return FixedPoint.mulRay(amount, factor, direction);
    }

    /*//////////////////////////////////////////////////////////////
                                 INDICES
    //////////////////////////////////////////////////////////////*/

    /// @notice Advance a cumulative index by a factor, rounding **down**.
    /// @dev    Indices only ever move one way, so the direction is fixed here
    ///         rather than exposed: an index that rounded up would ratchet
    ///         upward on every touch, and a market touched more often would
    ///         charge more interest than one touched rarely — a bug that pays
    ///         whoever calls `accrue` in a loop.
    function advanceIndex(uint256 index, uint256 factor) internal pure returns (uint256) {
        return FixedPoint.mulRayDown(index, factor);
    }

    /// @notice Convert a scaled balance to its current value using an index.
    function fromScaled(
        uint256 scaled,
        uint256 index,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return FixedPoint.mulRay(scaled, index, direction);
    }

    /// @notice Convert a current value to the scaled balance to store.
    /// @dev    The inverse of `fromScaled`, so it divides where that
    ///         multiplies, and takes the opposite direction to match.
    function toScaled(
        uint256 amount,
        uint256 index,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return FixedPoint.divRay(amount, index, direction);
    }
}
