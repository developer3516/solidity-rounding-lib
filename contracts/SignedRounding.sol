// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  SignedRounding
/// @notice Full-precision `mulDiv` for `int256`, with `Down` meaning floor and
///         `Up` meaning ceiling — for negative results too.
/// @dev    Signed rounding has a trap that unsigned rounding does not, and it
///         is worth being explicit about before reading anything else.
///
///         Solidity's `/` truncates **toward zero**. For positive operands
///         that is the same as flooring, so the distinction never comes up and
///         it is easy to assume `a / b` floors. It does not:
///
///             int256(-7) / 2 == -3     // truncation
///             floor(-3.5)    == -4     // what `Direction.Down` gives you
///             ceil(-3.5)     == -3
///
///         So on negatives, native division agrees with `Direction.Up`, not
///         `Direction.Down`. A codebase that reaches for this library
///         expecting `Down` to be "what `/` already did" will find every
///         negative result shifted by one.
///
///         The definitions here are absolute, not relative to zero:
///
///             Direction.Down  →  toward negative infinity  (floor)
///             Direction.Up    →  toward positive infinity  (ceiling)
///
///         Monotonic and sign-independent, which is what makes them safe to
///         reason about in accounting: flooring a loss and flooring a gain
///         both move the value the same way, so a signed balance cannot drift
///         upward just because it crossed zero.
///
///         The magnitude is computed by `Rounding.mulDiv`, so the full 512-bit
///         intermediate applies here too.
library SignedRounding {
    /// @notice The denominator was zero.
    error DivisionByZero();

    /// @notice The result does not fit in an `int256`.
    error MulDivOverflow();

    /// @dev The magnitude of `type(int256).min`, which is one past `max`.
    uint256 private constant MIN_MAGNITUDE = 2 ** 255;

    /*//////////////////////////////////////////////////////////////
                              MULTIPLY-DIVIDE
    //////////////////////////////////////////////////////////////*/

    /// @notice `x * y / denominator`, rounded in `direction`, at full precision.
    function mulDiv(
        int256 x,
        int256 y,
        int256 denominator,
        Rounding.Direction direction
    ) internal pure returns (int256) {
        if (denominator == 0) revert DivisionByZero();

        uint256 absX = abs(x);
        uint256 absY = abs(y);
        uint256 absD = abs(denominator);

        // Three-way sign: negative exactly when an odd number of operands are.
        bool negative = ((x < 0) != (y < 0)) != (denominator < 0);

        uint256 magnitude = Rounding.mulDivDown(absX, absY, absD);
        bool inexact = mulmod(absX, absY, absD) != 0;

        // Work in magnitudes, then place the sign. Rounding toward positive
        // infinity means rounding the *magnitude* down when the result is
        // negative — the direction flips as it crosses zero, which is exactly
        // the step a naive implementation misses.
        if (inexact) {
            bool grow = negative ? direction == Rounding.Direction.Down : direction == Rounding.Direction.Up;
            if (grow) {
                unchecked {
                    magnitude += 1;
                }
            }
        }

        return toSigned(magnitude, negative);
    }

    /// @notice `floor(x * y / denominator)`.
    function mulDivDown(int256 x, int256 y, int256 denominator) internal pure returns (int256) {
        return mulDiv(x, y, denominator, Rounding.Direction.Down);
    }

    /// @notice `ceil(x * y / denominator)`.
    function mulDivUp(int256 x, int256 y, int256 denominator) internal pure returns (int256) {
        return mulDiv(x, y, denominator, Rounding.Direction.Up);
    }

    /*//////////////////////////////////////////////////////////////
                                 DIVISION
    //////////////////////////////////////////////////////////////*/

    /// @notice `a / b`, rounded in `direction`.
    function div(int256 a, int256 b, Rounding.Direction direction) internal pure returns (int256) {
        return mulDiv(a, 1, b, direction);
    }

    /// @notice `floor(a / b)` — differs from `a / b` whenever the result is
    ///         negative and the division is not exact.
    function divDown(int256 a, int256 b) internal pure returns (int256) {
        return mulDiv(a, 1, b, Rounding.Direction.Down);
    }

    /// @notice `ceil(a / b)`.
    function divUp(int256 a, int256 b) internal pure returns (int256) {
        return mulDiv(a, 1, b, Rounding.Direction.Up);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Magnitude of `x` as a `uint256`.
    /// @dev    `-x` overflows for `type(int256).min`, so the negation is
    ///         unchecked. That is not a workaround — wrapping produces the
    ///         right answer. Negating `-2**255` wraps to the same bit pattern,
    ///         and reinterpreting those bits as unsigned is `2**255`, which is
    ///         the true magnitude. Every other input negates normally.
    function abs(int256 x) internal pure returns (uint256) {
        unchecked {
            return uint256(x < 0 ? -x : x);
        }
    }

    /// @dev Reattach the sign, rejecting magnitudes with no signed home.
    function toSigned(uint256 magnitude, bool negative) private pure returns (int256) {
        if (negative) {
            if (magnitude > MIN_MAGNITUDE) revert MulDivOverflow();
            // `int256(2**255)` is itself `type(int256).min`, so negating it
            // would be a no-op that silently returned a positive-looking
            // value. Handle the boundary directly instead.
            if (magnitude == MIN_MAGNITUDE) return type(int256).min;
            return -int256(magnitude);
        }

        if (magnitude > uint256(type(int256).max)) revert MulDivOverflow();
        return int256(magnitude);
    }
}
