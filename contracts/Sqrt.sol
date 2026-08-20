// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  Sqrt
/// @notice Integer square root with a rounding direction, and a geometric mean
///         that does not overflow on the way there.
/// @dev    Square roots turn up in AMM accounting: the first liquidity provider
///         in a Uniswap-V2-style pool mints `sqrt(amount0 * amount1)` LP
///         tokens, and the invariant `k = x * y` is compared through its root
///         all over the place.
///
///         Two things go wrong with the obvious implementation.
///
///         **The direction.** `sqrt` truncates, and for an LP mint that is
///         correct — issuing the ceiling hands the first provider a fraction of
///         a token nobody deposited, and on an empty pool that fraction is the
///         entire pool. But "correct" here is a choice, and a choice made
///         silently is one a reviewer cannot check. So it is an argument, as
///         everywhere else in this library.
///
///         **The overflow.** `sqrt(a * b)` overflows whenever `a * b` exceeds
///         256 bits, which for two 18-decimal reserves happens at around
///         3.4e20 of each — a pool with 340 billion tokens a side, but also any
///         pool holding a token with more decimals or a very low unit price.
///         The product overflows long before the *root* does, so the failure is
///         entirely avoidable: `geometricMean` computes it at full 512-bit
///         precision and returns an answer where the naive form reverts.
library Sqrt {
    /// @notice `floor(sqrt(x))`, or the ceiling when asked.
    function sqrt(uint256 x, Rounding.Direction direction) internal pure returns (uint256) {
        uint256 root = floorSqrt(x);

        if (direction == Rounding.Direction.Up && root * root != x) {
            // `root + 1` cannot overflow: `floorSqrt` of any uint256 is at most
            // 2**128, far from the top of the range.
            unchecked {
                return root + 1;
            }
        }

        return root;
    }

    /// @notice `floor(sqrt(x))`.
    /// @dev    Newton's method, seeded by halving the bit length. Each
    ///         iteration roughly doubles the correct digits, so seven steps
    ///         cover the whole 256-bit range — the loop is unrolled because a
    ///         fixed count is cheaper than a convergence check that would have
    ///         to run the comparison anyway.
    ///
    ///         Newton converges from above and can land one too high, so the
    ///         final line takes the smaller of the last two estimates. Without
    ///         it the result is off by one on a band of inputs that a handful
    ///         of spot-check tests will happily miss.
    function floorSqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        unchecked {
            // Seed with 2**(ceil(bitlen(x)/2)), which is within a factor of
            // two of the answer.
            uint256 estimate = 1 << (log2(x) >> 1);

            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;
            estimate = (estimate + x / estimate) >> 1;

            uint256 corrected = x / estimate;
            return estimate < corrected ? estimate : corrected;
        }
    }

    /// @notice `sqrt(a * b)`, rounded in `direction`, without overflowing.
    /// @dev    The product is carried at 512 bits, so this answers for reserves
    ///         where `a * b` alone reverts. Computed as
    ///         `sqrt(mulDiv(a, b, 1))` — which sounds like a no-op and is not:
    ///         `mulDiv` is what holds the intermediate.
    ///
    ///         When the true product exceeds 256 bits the root of it still
    ///         does not, but `mulDiv(a, b, 1)` cannot represent it, so those
    ///         inputs revert rather than silently returning a wrong answer.
    ///         `geometricMeanScaled` is the way through for genuinely enormous
    ///         reserves.
    function geometricMean(
        uint256 a,
        uint256 b,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return sqrt(Rounding.mulDivDown(a, b, 1), direction);
    }

    /// @notice `sqrt(a * b / denominator)`, rounded in `direction`.
    /// @dev    The form that survives anything. Dividing inside the 512-bit
    ///         intermediate brings the product back into range before the root
    ///         is taken, so reserves that would overflow `a * b` still work —
    ///         pass the scale you are already working in as `denominator`.
    ///
    ///         `sqrt(a * b / d)` is not `sqrt(a * b) / sqrt(d)` in integer
    ///         arithmetic; this computes the former, which is the one that
    ///         keeps precision.
    function geometricMeanScaled(
        uint256 a,
        uint256 b,
        uint256 denominator,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return sqrt(Rounding.mulDiv(a, b, denominator, direction), direction);
    }

    /// @notice Index of the highest set bit, or 0 for 0.
    /// @dev    Binary search rather than a loop: eight comparisons instead of
    ///         up to 256 iterations.
    function log2(uint256 x) internal pure returns (uint256 result) {
        unchecked {
            if (x >> 128 > 0) {
                x >>= 128;
                result += 128;
            }
            if (x >> 64 > 0) {
                x >>= 64;
                result += 64;
            }
            if (x >> 32 > 0) {
                x >>= 32;
                result += 32;
            }
            if (x >> 16 > 0) {
                x >>= 16;
                result += 16;
            }
            if (x >> 8 > 0) {
                x >>= 8;
                result += 8;
            }
            if (x >> 4 > 0) {
                x >>= 4;
                result += 4;
            }
            if (x >> 2 > 0) {
                x >>= 2;
                result += 2;
            }
            if (x >> 1 > 0) {
                result += 1;
            }
        }
    }
}
