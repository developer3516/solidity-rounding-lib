// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "../Rounding.sol";
import {Vesting} from "../Vesting.sol";

/// @notice Test-only external surface for the `Vesting` library.
contract VestingHarness {
    function vestedAt(
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) external pure returns (uint256) {
        return Vesting.vestedAt(total, start, cliff, duration, timestamp);
    }

    function claimable(
        uint256 total,
        uint256 claimedSoFar,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) external pure returns (uint256) {
        return Vesting.claimable(total, claimedSoFar, start, cliff, duration, timestamp);
    }

    function locked(
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 timestamp
    ) external pure returns (uint256) {
        return Vesting.locked(total, start, cliff, duration, timestamp);
    }

    function isFullyVested(uint256 start, uint256 duration, uint256 t) external pure returns (bool) {
        return Vesting.isFullyVested(start, duration, t);
    }

    /// @notice The naive per-interval claim, for contrast in the tests.
    /// @dev    What almost everyone writes: each claim computed from the time
    ///         since the last one, truncating separately every time.
    function naiveClaim(
        uint256 total,
        uint256 lastClaimAt,
        uint256 duration,
        uint256 timestamp
    ) external pure returns (uint256) {
        return Rounding.mulDivDown(total, timestamp - lastClaimAt, duration);
    }
}
