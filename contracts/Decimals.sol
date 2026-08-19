// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  Decimals
/// @notice Convert token amounts between decimal scales, with the loss made
///         explicit instead of silent.
/// @dev    Almost every protocol that touches more than one token has to do
///         this, and it is one of the quietest sources of loss in DeFi. USDC
///         has 6 decimals, WETH has 18, WBTC has 8, and a handful of tokens
///         have 0 or 2. An amount is just a `uint256`; nothing in the type
///         says which scale it is in.
///
///         The two directions are not symmetric, and treating them as if they
///         were is the bug:
///
///           **Widening** (6 -> 18) multiplies by a power of ten. It is exact.
///           There is no remainder, so there is no direction to choose, and
///           offering one would imply a decision that does not exist.
///
///           **Narrowing** (18 -> 6) divides. Twelve digits are discarded, and
///           which way they go decides who absorbs them. That is a real
///           choice, so it is a required argument.
///
///         The asymmetry has a consequence worth stating plainly: a round trip
///         through a smaller scale is **lossy**. Converting 1 wei of WETH to
///         USDC precision and back yields zero. Not almost zero — zero. Code
///         that normalises to a common scale for comparison and then converts
///         back to pay out is destroying value on every call, and a test in
///         this suite measures exactly how much.
library Decimals {
    /// @notice A scale beyond what a `uint256` can represent.
    error DecimalsTooLarge(uint8 decimals);

    /// @dev `10 ** 78` overflows a `uint256`, so 77 is the ceiling.
    uint8 internal constant MAX_DECIMALS = 77;

    /*//////////////////////////////////////////////////////////////
                              CONVERSION
    //////////////////////////////////////////////////////////////*/

    /// @notice Convert `amount` from `from` decimals to `to` decimals.
    /// @dev    `direction` is used only when narrowing. Widening is exact and
    ///         ignores it, which is deliberate: a caller passing a direction
    ///         for a widening conversion is not wrong, just redundant, and
    ///         refusing would make generic code awkward for no gain.
    function convert(
        uint256 amount,
        uint8 from,
        uint8 to,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        if (from == to) return amount;

        if (to > from) {
            return amount * pow10(to - from);
        }

        return Rounding.div(amount, pow10(from - to), direction);
    }

    /// @notice Widen `amount` to a larger scale. Exact, so no direction.
    /// @dev    Reverts if `to < from`, rather than silently narrowing. A caller
    ///         who reached for `widen` believes no precision is being lost, and
    ///         quietly doing the lossy thing would betray exactly that belief.
    function widen(uint256 amount, uint8 from, uint8 to) internal pure returns (uint256) {
        if (to < from) revert DecimalsTooLarge(from);
        return amount * pow10(to - from);
    }

    /// @notice Narrow `amount` to a smaller scale, rounding in `direction`.
    function narrow(
        uint256 amount,
        uint8 from,
        uint8 to,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        if (to > from) revert DecimalsTooLarge(to);
        return Rounding.div(amount, pow10(from - to), direction);
    }

    /*//////////////////////////////////////////////////////////////
                                 LOSS
    //////////////////////////////////////////////////////////////*/

    /// @notice What a round trip through `to` decimals would discard.
    /// @dev    Exists so the loss can be checked *before* it happens. A
    ///         protocol that normalises to a common scale can call this,
    ///         compare it against a dust threshold, and revert rather than
    ///         silently keeping the difference.
    function roundTripLoss(uint256 amount, uint8 from, uint8 to) internal pure returns (uint256) {
        if (to >= from) return 0;

        unchecked {
            // Narrowing down then widening back can only lose, never gain, so
            // the subtraction cannot underflow.
            uint256 factor = pow10(from - to);
            return amount - (amount / factor) * factor;
        }
    }

    /// @notice Whether converting to `to` decimals and back is lossless.
    function isExact(uint256 amount, uint8 from, uint8 to) internal pure returns (bool) {
        return roundTripLoss(amount, from, to) == 0;
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @notice `10 ** exponent`, bounded to what fits.
    function pow10(uint8 exponent) internal pure returns (uint256) {
        if (exponent > MAX_DECIMALS) revert DecimalsTooLarge(exponent);
        return 10 ** exponent;
    }
}
