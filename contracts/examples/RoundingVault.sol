// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {SharesMath} from "../SharesMath.sol";

/// @title  RoundingVault
/// @notice A minimal ERC-4626-shaped vault built on `SharesMath`.
/// @dev    Example code, not part of the published package — it is here to
///         show the library doing its job in something that actually holds
///         tokens, and to give `BrokenVault` something to be a counterexample
///         to.
///
///         There is no rounding decision anywhere in this contract. Every
///         conversion goes through the correspondingly named `SharesMath`
///         helper, which is the entire point: the four directions were decided
///         once, in a library with 100+ tests behind it, instead of four times
///         in vault code where the wrong choice still compiles.
///
///         The one thing a vault author still has to get right is *ordering*.
///         Each preview is computed **before** the transfer that changes the
///         balance it reads, since `totalAssets()` is a live
///         `balanceOf(address(this))`. Compute after, and a deposit prices
///         itself against a pool that already contains it.
contract RoundingVault is ERC20 {
    using SafeERC20 for IERC20;

    // solhint-disable immutable-vars-naming
    // ERC-4626 specifies the getter as `asset()`, so the SNAKE_CASE
    // convention solhint wants would break the interface it is imitating.

    IERC20 public immutable asset;

    /// @notice Virtual-share offset. See `SharesMath` on the inflation attack.
    uint8 public immutable decimalsOffset;

    // solhint-enable immutable-vars-naming

    constructor(
        IERC20 asset_,
        uint8 decimalsOffset_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        asset = asset_;
        decimalsOffset = decimalsOffset_;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /*//////////////////////////////////////////////////////////////
                                PREVIEWS
    //////////////////////////////////////////////////////////////*/

    function previewDeposit(uint256 assets) public view virtual returns (uint256) {
        return SharesMath.previewDeposit(assets, totalAssets(), totalSupply(), decimalsOffset);
    }

    function previewMint(uint256 shares) public view virtual returns (uint256) {
        return SharesMath.previewMint(shares, totalAssets(), totalSupply(), decimalsOffset);
    }

    function previewWithdraw(uint256 assets) public view virtual returns (uint256) {
        return SharesMath.previewWithdraw(assets, totalAssets(), totalSupply(), decimalsOffset);
    }

    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        return SharesMath.previewRedeem(shares, totalAssets(), totalSupply(), decimalsOffset);
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit `assets`, receive shares priced before the transfer.
    function deposit(uint256 assets) external returns (uint256 shares) {
        shares = previewDeposit(assets);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(msg.sender, shares);
    }

    /// @notice Mint exactly `shares`, paying whatever they cost.
    function mint(uint256 shares) external returns (uint256 assets) {
        assets = previewMint(shares);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(msg.sender, shares);
    }

    /// @notice Withdraw exactly `assets`, burning whatever they cost in shares.
    function withdraw(uint256 assets) external returns (uint256 shares) {
        shares = previewWithdraw(assets);
        _burn(msg.sender, shares);
        asset.safeTransfer(msg.sender, assets);
    }

    /// @notice Burn `shares`, receive what they are worth.
    function redeem(uint256 shares) external returns (uint256 assets) {
        assets = previewRedeem(shares);
        _burn(msg.sender, shares);
        asset.safeTransfer(msg.sender, assets);
    }
}
