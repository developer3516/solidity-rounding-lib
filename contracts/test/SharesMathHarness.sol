// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "../Rounding.sol";
import {SharesMath} from "../SharesMath.sol";

/// @notice Test-only external surface for the `SharesMath` library.
contract SharesMathHarness {
    function toShares(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset,
        Rounding.Direction direction
    ) external pure returns (uint256) {
        return SharesMath.toShares(assets, totalAssets, totalShares, offset, direction);
    }

    function toAssets(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset,
        Rounding.Direction direction
    ) external pure returns (uint256) {
        return SharesMath.toAssets(shares, totalAssets, totalShares, offset, direction);
    }

    function previewDeposit(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) external pure returns (uint256) {
        return SharesMath.previewDeposit(assets, totalAssets, totalShares, offset);
    }

    function previewMint(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) external pure returns (uint256) {
        return SharesMath.previewMint(shares, totalAssets, totalShares, offset);
    }

    function previewWithdraw(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) external pure returns (uint256) {
        return SharesMath.previewWithdraw(assets, totalAssets, totalShares, offset);
    }

    function previewRedeem(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) external pure returns (uint256) {
        return SharesMath.previewRedeem(shares, totalAssets, totalShares, offset);
    }
}
