// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  Rounding
/// @notice Fixed-point multiply-divide with an explicit, caller-chosen rounding
///         direction.
/// @dev    Solidity's `/` always truncates toward zero. In a protocol that
///         holds other people's money, "toward zero" is the right answer only
///         about half the time: whenever value is converted between two units
///         — assets to shares, principal to interest, collateral to debt — the
///         rounding must land in the protocol's favour, or the dust becomes a
///         withdrawable surplus and the accumulated error becomes an exploit.
///
///         Making the direction a required argument turns that decision into
///         something a reviewer can see at the call site, rather than an
///         emergent property of which operand happened to be on top.
///
///         `mulDiv` computes `x * y / denominator` at full 512-bit
///         intermediate precision, so the multiplication cannot overflow
///         before the division has a chance to bring it back in range. The
///         algorithm is the one from Remco Bloemen's "Math by Fabrications",
///         also used by Uniswap V3's `FullMath` and OpenZeppelin's `Math`.
library Rounding {
    /// @notice Which way to break a non-exact division.
    /// @dev `Down` truncates toward zero; `Up` returns the ceiling.
    enum Direction {
        Down,
        Up
    }

    /// @notice The denominator was zero.
    error DivisionByZero();

    /// @notice The true quotient does not fit in 256 bits.
    error MulDivOverflow();

    /*//////////////////////////////////////////////////////////////
                            DIRECTION HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice The opposite of `direction`.
    /// @dev    The single most useful primitive in a vault. A deposit and the
    ///         withdrawal that reverses it must round in opposite directions,
    ///         or a deposit-then-withdraw round trip mints free value. Pairing
    ///         a conversion with `opposite(dir)` makes that symmetry explicit
    ///         instead of leaving it to two hand-written call sites to agree.
    function opposite(Direction direction) internal pure returns (Direction) {
        return direction == Direction.Down ? Direction.Up : Direction.Down;
    }

    /*//////////////////////////////////////////////////////////////
                                DIVISION
    //////////////////////////////////////////////////////////////*/

    /// @notice `a / b`, rounded in `direction`.
    function div(uint256 a, uint256 b, Direction direction) internal pure returns (uint256) {
        return direction == Direction.Down ? divDown(a, b) : divUp(a, b);
    }

    /// @notice `a / b`, truncated toward zero.
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert DivisionByZero();
        return a / b;
    }

    /// @notice `a / b`, rounded away from zero.
    /// @dev    Computed as `a == 0 ? 0 : (a - 1) / b + 1` rather than
    ///         `(a + b - 1) / b`: the latter overflows when `a` is near
    ///         `type(uint256).max`, turning a correct ceiling into a revert
    ///         exactly where balances are largest.
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert DivisionByZero();
        if (a == 0) return 0;
        unchecked {
            return (a - 1) / b + 1;
        }
    }

    /*//////////////////////////////////////////////////////////////
                              MULTIPLY-DIVIDE
    //////////////////////////////////////////////////////////////*/

    /// @notice `x * y / denominator`, rounded in `direction`, at full precision.
    function mulDiv(
        uint256 x,
        uint256 y,
        uint256 denominator,
        Direction direction
    ) internal pure returns (uint256) {
        return
            direction == Direction.Down
                ? mulDivDown(x, y, denominator)
                : mulDivUp(x, y, denominator);
    }

    /// @notice `floor(x * y / denominator)` at full 512-bit intermediate precision.
    /// @dev    Reverts with `MulDivOverflow` when the true quotient exceeds
    ///         `type(uint256).max`, and with `DivisionByZero` when
    ///         `denominator == 0`.
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        // Checked before anything else so a zero denominator always surfaces
        // as `DivisionByZero`, never as the overflow branch below (which a
        // zero denominator would also satisfy).
        if (denominator == 0) revert DivisionByZero();

        unchecked {
            // 512-bit product as two 256-bit limbs: x * y == prod1 * 2**256 + prod0.
            uint256 prod0; // least significant 256 bits
            uint256 prod1; // most significant 256 bits
            assembly ("memory-safe") {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            // The product fit in 256 bits, so plain division is exact.
            if (prod1 == 0) {
                return prod0 / denominator;
            }

            // The quotient must fit in 256 bits: prod1 / denominator < 2**256.
            if (denominator <= prod1) revert MulDivOverflow();

            // --- 512 by 256 division ------------------------------------
            // Make the numerator exactly divisible by subtracting the
            // remainder, then divide the two limbs by the denominator.

            uint256 remainder;
            assembly ("memory-safe") {
                remainder := mulmod(x, y, denominator)
                // Subtract 256-bit remainder from the 512-bit numerator.
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            // Factor the powers of two out of the denominator so what remains
            // is odd, and therefore invertible modulo 2**256.
            uint256 twos = denominator & (0 - denominator);
            assembly ("memory-safe") {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                // Shift the high limb into the space the low limb just freed.
                // When twos == 1 this evaluates to 0, which is correct: the
                // high limb contributes prod1 * 2**256 ≡ 0 (mod 2**256), and
                // the result is known to fit in 256 bits.
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            // Invert the (now odd) denominator modulo 2**256 by Newton–Raphson.
            // The seed is correct to 4 bits and each step doubles that, so six
            // steps reach the full 256.
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse; // 8 bits
            inverse *= 2 - denominator * inverse; // 16
            inverse *= 2 - denominator * inverse; // 32
            inverse *= 2 - denominator * inverse; // 64
            inverse *= 2 - denominator * inverse; // 128
            inverse *= 2 - denominator * inverse; // 256

            // Because the numerator is now exactly divisible, multiplying by
            // the modular inverse yields the true quotient.
            result = prod0 * inverse;
        }
    }

    /// @notice `ceil(x * y / denominator)` at full 512-bit intermediate precision.
    function mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        uint256 result = mulDivDown(x, y, denominator);

        // `mulmod` gives the exact remainder of the 512-bit product without
        // needing to reconstruct it.
        if (mulmod(x, y, denominator) != 0) {
            // The floor was already the largest representable value, so the
            // ceiling cannot be represented at all.
            if (result == type(uint256).max) revert MulDivOverflow();
            unchecked {
                result += 1;
            }
        }

        return result;
    }
}
