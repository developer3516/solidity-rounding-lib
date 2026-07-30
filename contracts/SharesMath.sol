// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Rounding} from "./Rounding.sol";

/// @title  SharesMath
/// @notice Asset/share conversion for vaults, with the ERC-4626 rounding table
///         encoded in the function names instead of left to the caller.
/// @dev    This is what `Rounding` exists for. A vault performs the same
///         multiply-divide in four different places, and the correct rounding
///         direction is different in each:
///
///           | operation  | user supplies | rounding | who it favours |
///           |------------|---------------|----------|----------------|
///           | deposit    | assets        | Down     | the vault      |
///           | mint       | shares        | Up       | the vault      |
///           | withdraw   | assets        | Up       | the vault      |
///           | redeem     | shares        | Down     | the vault      |
///
///         Every row rounds toward the vault. That is not a coincidence — it
///         is the only assignment where no sequence of operations lets a user
///         extract more than they put in. Get one row backwards and the error
///         is not a rounding nuisance; it is a loop that mints value.
///
///         Writing those four call sites by hand means writing `Direction.Up`
///         or `Direction.Down` correctly four times, in code where the wrong
///         choice still compiles, still passes a naive test, and only shows up
///         when someone runs it in a loop. Naming them removes the choice.
library SharesMath {
    /// @notice Virtual assets and shares defend against the inflation attack.
    /// @dev    On an empty vault an attacker can deposit 1 wei, receive 1
    ///         share, then *donate* a large balance directly to the vault.
    ///         The share price becomes enormous, and the next depositor's
    ///         `assets * totalShares / totalAssets` truncates to zero or one
    ///         share — the attacker redeems and takes the difference.
    ///
    ///         Adding 1 virtual asset and `10**offset` virtual shares makes
    ///         the donation dilute the attacker too. Raising the offset raises
    ///         the cost of the attack exponentially while costing honest users
    ///         nothing but a rounding unit.
    ///
    ///         The virtual amounts also mean the denominators are never zero,
    ///         so an empty vault needs no special case anywhere below.
    uint256 internal constant VIRTUAL_ASSETS = 1;

    /*//////////////////////////////////////////////////////////////
                            CORE CONVERSIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Convert assets to shares in an explicit direction.
    /// @param  assets       amount denominated in the underlying asset
    /// @param  totalAssets  assets currently held by the vault
    /// @param  totalShares  shares currently outstanding
    /// @param  offset       decimals offset; `10**offset` virtual shares
    /// @param  direction    which way to break a non-exact division
    function toShares(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return Rounding.mulDiv(assets, totalShares + 10 ** offset, totalAssets + VIRTUAL_ASSETS, direction);
    }

    /// @notice Convert shares to assets in an explicit direction.
    function toAssets(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        return Rounding.mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + 10 ** offset, direction);
    }

    /*//////////////////////////////////////////////////////////////
                          ERC-4626 PREVIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Shares minted for `assets` deposited. Rounds down: the vault
    ///         never over-issues against what it actually received.
    function previewDeposit(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) internal pure returns (uint256) {
        return toShares(assets, totalAssets, totalShares, offset, Rounding.Direction.Down);
    }

    /// @notice Assets required to mint `shares`. Rounds up: the depositor
    ///         covers the remainder rather than the vault absorbing it.
    function previewMint(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) internal pure returns (uint256) {
        return toAssets(shares, totalAssets, totalShares, offset, Rounding.Direction.Up);
    }

    /// @notice Shares burned to withdraw `assets`. Rounds up: the withdrawer
    ///         pays the remainder in shares.
    function previewWithdraw(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) internal pure returns (uint256) {
        return toShares(assets, totalAssets, totalShares, offset, Rounding.Direction.Up);
    }

    /// @notice Assets returned for `shares` redeemed. Rounds down: the vault
    ///         never pays out more than the position is worth.
    function previewRedeem(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares,
        uint8 offset
    ) internal pure returns (uint256) {
        return toAssets(shares, totalAssets, totalShares, offset, Rounding.Direction.Down);
    }
}
