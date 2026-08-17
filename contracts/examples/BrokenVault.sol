// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Rounding} from "../Rounding.sol";
import {SharesMath} from "../SharesMath.sol";
import {RoundingVault} from "./RoundingVault.sol";

/// @title  BrokenVault
/// @notice `RoundingVault` with exactly one rounding direction reversed.
/// @dev    The counterexample the whole library exists to prevent.
///
///         The diff against the correct vault is a single argument:
///         `previewRedeem` rounds `Up` instead of `Down`. Nothing else
///         changes. It compiles, it passes any test that checks a single
///         deposit and a single withdrawal, and a reviewer skimming the file
///         sees a `mulDiv` with a direction argument — which looks exactly
///         like the correct code.
///
///         What it actually does is pay out the ceiling on every exit. One
///         extra unit per redemption is invisible. In a loop it is a
///         withdrawal faucet: the test suite deposits and redeems repeatedly
///         and walks away with more than it started, taken from the other
///         depositors' backing.
///
///         This is why the direction is a required argument in `Rounding` and
///         why `SharesMath` names the four operations instead of exposing the
///         choice. Here the choice was available, and one character of it was
///         wrong.
contract BrokenVault is RoundingVault {
    constructor(
        IERC20 asset_,
        uint8 decimalsOffset_,
        string memory name_,
        string memory symbol_
    ) RoundingVault(asset_, decimalsOffset_, name_, symbol_) {}

    /// @inheritdoc RoundingVault
    /// @dev The bug: `Direction.Up` where the correct vault uses `Down`.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return
            SharesMath.toAssets(
                shares,
                totalAssets(),
                totalSupply(),
                decimalsOffset,
                Rounding.Direction.Up // <-- should be Down
            );
    }
}