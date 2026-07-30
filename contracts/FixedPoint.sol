// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  FixedPoint
/// @notice WAD (1e18) and RAY (1e27) fixed-point arithmetic with an explicit
///         rounding direction.
/// @dev    Almost every DeFi rate, ratio and index is a fixed-point number in
///         one of two scales: WAD for prices, shares and percentages, RAY for
///         interest indices that compound and therefore need the extra nine
///         digits of headroom.
///
///         Mixing the two is a routine and expensive mistake — a RAY treated
///         as a WAD is off by a factor of a billion, and the code still
///         compiles because both are `uint256`. Naming the scale at the call
///         site (`mulWad` vs `mulRay`) is the cheapest available defence.
///
///         Everything here delegates to `Rounding.mulDiv`, so the full 512-bit
///         intermediate applies: `a.mulWadUp(b)` where both are around 1e30 is
///         fine, even though `a * b` alone would overflow long before the
///         division brought it back into range.
library FixedPoint {
    /// @notice 18-decimal scale.
    uint256 internal constant WAD = 1e18;

    /// @notice 27-decimal scale.
    uint256 internal constant RAY = 1e27;

    /// @dev RAY / WAD — the factor between the two scales.
    uint256 internal constant WAD_TO_RAY = 1e9;

    /*//////////////////////////////////////////////////////////////
                                  WAD
    //////////////////////////////////////////////////////////////*/

    /// @notice `a * b / WAD`, rounded in `direction`.
    function mulWad(uint256 a, uint256 b, Rounding.Direction direction) internal pure returns (uint256) {
        return Rounding.mulDiv(a, b, WAD, direction);
    }

    /// @notice `a * WAD / b`, rounded in `direction`.
    function divWad(uint256 a, uint256 b, Rounding.Direction direction) internal pure returns (uint256) {
        return Rounding.mulDiv(a, WAD, b, direction);
    }

    function mulWadDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivDown(a, b, WAD);
    }

    function mulWadUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivUp(a, b, WAD);
    }

    function divWadDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivDown(a, WAD, b);
    }

    function divWadUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivUp(a, WAD, b);
    }

    /*//////////////////////////////////////////////////////////////
                                  RAY
    //////////////////////////////////////////////////////////////*/

    /// @notice `a * b / RAY`, rounded in `direction`.
    function mulRay(uint256 a, uint256 b, Rounding.Direction direction) internal pure returns (uint256) {
        return Rounding.mulDiv(a, b, RAY, direction);
    }

    /// @notice `a * RAY / b`, rounded in `direction`.
    function divRay(uint256 a, uint256 b, Rounding.Direction direction) internal pure returns (uint256) {
        return Rounding.mulDiv(a, RAY, b, direction);
    }

    function mulRayDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivDown(a, b, RAY);
    }

    function mulRayUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivUp(a, b, RAY);
    }

    function divRayDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivDown(a, RAY, b);
    }

    function divRayUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return Rounding.mulDivUp(a, RAY, b);
    }

    /*//////////////////////////////////////////////////////////////
                            SCALE CONVERSION
    //////////////////////////////////////////////////////////////*/

    /// @notice Widen a WAD to a RAY.
    /// @dev    Exact — no direction argument, because scaling up never drops a
    ///         remainder. Reverts on overflow rather than wrapping, which is
    ///         the checked-arithmetic default and the right one here: a WAD
    ///         above ~1.15e59 has no RAY representation, and silently
    ///         wrapping would corrupt an index rather than halt the call.
    function wadToRay(uint256 wad) internal pure returns (uint256) {
        return wad * WAD_TO_RAY;
    }

    /// @notice Narrow a RAY to a WAD, rounded in `direction`.
    /// @dev    This one *does* need a direction: nine digits of precision are
    ///         being discarded, and which way they go decides who absorbs the
    ///         loss.
    function rayToWad(uint256 ray, Rounding.Direction direction) internal pure returns (uint256) {
        return Rounding.div(ray, WAD_TO_RAY, direction);
    }
}
