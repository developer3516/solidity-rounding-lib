// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  Vesting
/// @notice Linear vesting where claiming often and claiming once pay exactly
///         the same total.
/// @dev    The obvious implementation computes each claim from the time since
///         the last one:
///
///             claim = total * (now - lastClaim) / duration     // truncates
///
///         which loses a unit on every claim that does not divide evenly. A
///         beneficiary who claims monthly ends up with twelve units less than
///         one who waits — and the contract ends holding a residue it can
///         never pay out, because the final claim computes the same truncated
///         way. **Claim frequency silently becomes a fee.**
///
///         The fix is to track the *cumulative* amount vested and derive each
///         claim by subtraction:
///
///             claimable = vestedAt(now) - alreadyClaimed
///
///         Now every truncation happens in the same place, against the same
///         total, and the errors do not accumulate: whatever the schedule of
///         claims, the sum is `vestedAt(now)` exactly. It is the same shape as
///         `Percentage.split` — compute one side, subtract for the other —
///         and the suite proves it the same way, by claiming on wildly
///         different schedules and asserting the totals match.
///
///         `vestedAt` rounds **down**, so a beneficiary can never claim ahead
///         of the schedule. At the end of the term it returns the full amount
///         with no rounding at all, which is what makes the residue zero
///         rather than merely small.
library Vesting {
    /// @notice The schedule is not internally consistent.
    error InvalidSchedule();

    /// @notice More was claimed than has vested.
    error OverClaimed(uint256 claimed, uint256 vested);

    /// @notice Cumulative amount vested at `timestamp`.
    /// @param total     the full grant
    /// @param start     when vesting begins
    /// @param cliff     nothing vests before this; must be at or after `start`
    /// @param duration  length of the vesting term from `start`
    /// @dev    Returns `total` exactly once the term has elapsed. Computing
    ///         the tail through the same `mulDiv` would leave a few units
    ///         permanently unclaimable, so the end of the schedule is an
    ///         explicit case rather than a limit the arithmetic approaches.
    function vestedAt(
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) internal pure returns (uint256) {
        if (cliff < start) revert InvalidSchedule();
        if (duration == 0) revert InvalidSchedule();

        if (timestamp < cliff) return 0;

        unchecked {
            // `timestamp >= cliff >= start`, so this cannot underflow.
            uint256 elapsed = timestamp - start;
            if (elapsed >= duration) return total;

            // Down: a beneficiary must never be able to claim ahead of the
            // schedule, and the remainder is paid at the end anyway.
            return Rounding.mulDivDown(total, elapsed, duration);
        }
    }

    /// @notice What can be claimed right now.
    /// @dev    Derived by subtraction from the cumulative figure, which is the
    ///         whole point: truncation happens once, against the full total,
    ///         rather than once per claim against a slice.
    function claimable(
        uint256 total,
        uint256 claimedSoFar,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) internal pure returns (uint256) {
        uint256 vested = vestedAt(total, start, cliff, duration, timestamp);

        // A claim larger than what has vested means the caller's accounting
        // and this schedule disagree. Returning zero would hide that; the
        // underflow would be an opaque panic, so say what happened.
        if (claimedSoFar > vested) revert OverClaimed(claimedSoFar, vested);

        unchecked {
            return vested - claimedSoFar;
        }
    }

    /// @notice What is still locked at `timestamp`.
    /// @dev    Also by subtraction, so `vested + locked == total` exactly.
    function locked(
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) internal pure returns (uint256) {
        unchecked {
            return total - vestedAt(total, start, cliff, duration, timestamp);
        }
    }

    /// @notice When the grant is fully vested.
    function endsAt(uint256 start, uint256 duration) internal pure returns (uint256) {
        return start + duration;
    }

    /// @notice Whether the whole grant has vested by `timestamp`.
    function isFullyVested(
        uint256 start,
        uint256 duration,
        uint256 timestamp
    ) internal pure returns (bool) {
        return timestamp >= start + duration;
    }
}
