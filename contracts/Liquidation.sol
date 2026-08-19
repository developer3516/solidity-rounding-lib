// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Decimals} from "./Decimals.sol";
import {Percentage} from "./Percentage.sol";
import {Rounding} from "./Rounding.sol";

/// @title  Liquidation
/// @notice Collateral seized for debt repaid, with the rounding chosen so the
///         borrower is never over-seized.
/// @dev    This is where the rest of the library meets: a liquidation crosses
///         two token scales (`Decimals`), applies a bonus in basis points
///         (`Percentage`), and divides twice at full precision (`Rounding`).
///         Every one of those is a place a unit can go the wrong way, and the
///         party who loses it is always the borrower — the one being
///         liquidated, who is not in the room.
///
///         The direction rule is therefore the opposite of everywhere else in
///         this library. Elsewhere the protocol rounds in its own favour
///         because the counterparty is a voluntary depositor. Here the
///         counterparty is being forcibly closed out, so **seizure rounds
///         down**: the liquidator receives at most what the bonus entitles
///         them to, and any dust stays with the borrower.
///
///         The arithmetic, in one expression:
///
///             seize = repaid × debtPrice × 10^collDec × (BPS + bonus)
///                     ───────────────────────────────────────────────
///                          collPrice × 10^debtDec × BPS
///
///         Computing that as written would overflow long before dividing, so
///         it is two `mulDiv` steps. The intermediate is deliberately the
///         *value* of the repayment in price units at collateral scale, which
///         keeps the larger multiplication first and the lossy division last —
///         the opposite order loses precision on every small repayment.
library Liquidation {
    /// @notice A price feed returned zero.
    error InvalidPrice();

    /// @notice The bonus exceeded what the library will accept.
    error BonusOutOfRange(uint256 bonusBps);

    /// @dev A 100% bonus already means seizing twice the debt's worth. Beyond
    ///      that a "bonus" is a misconfiguration, not an aggressive parameter.
    uint256 internal constant MAX_BONUS_BPS = 10_000;

    /// @notice Collateral to seize for `debtRepaid`, rounding **down**.
    /// @param debtRepaid        amount of the debt asset being repaid
    /// @param debtDecimals      decimals of the debt asset
    /// @param debtPrice         price per whole debt token
    /// @param collateralDecimals decimals of the collateral asset
    /// @param collateralPrice   price per whole collateral token, same scale
    ///                          as `debtPrice`
    /// @param bonusBps          liquidation bonus in basis points
    function collateralToSeize(
        uint256 debtRepaid,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint256 bonusBps
    ) internal pure returns (uint256) {
        return
            seizeWithDirection(
                debtRepaid,
                debtDecimals,
                debtPrice,
                collateralDecimals,
                collateralPrice,
                bonusBps,
                Rounding.Direction.Down
            );
    }

    /// @notice The same conversion with an explicit direction.
    /// @dev    Exposed for the preview and accounting paths that need to state
    ///         a bound rather than take one. The seizing path itself should
    ///         use `collateralToSeize`, which cannot be handed the wrong one.
    function seizeWithDirection(
        uint256 debtRepaid,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint256 bonusBps,
        Rounding.Direction direction
    ) internal pure returns (uint256) {
        if (debtPrice == 0 || collateralPrice == 0) revert InvalidPrice();
        if (bonusBps > MAX_BONUS_BPS) revert BonusOutOfRange(bonusBps);

        // Step one: what the repayment is worth, expressed at collateral
        // scale. Multiplying by 10^collateralDecimals before dividing by
        // 10^debtDecimals keeps the value large through the only division
        // that can truncate it.
        uint256 valueAtCollateralScale = Rounding.mulDiv(
            debtRepaid,
            debtPrice * Decimals.pow10(collateralDecimals),
            Decimals.pow10(debtDecimals),
            direction
        );

        // Step two: apply the bonus and convert to collateral units. Both the
        // bonus numerator and the price denominator fold into one division so
        // there is a single truncation rather than two.
        return
            Rounding.mulDiv(
                valueAtCollateralScale,
                Percentage.BPS + bonusBps,
                collateralPrice * Percentage.BPS,
                direction
            );
    }

    /// @notice Debt repayable for a given amount of collateral, rounding **up**.
    /// @dev    The inverse, and the direction inverts with it. A liquidator
    ///         asking "how much must I repay to seize this collateral" must be
    ///         quoted at least the true amount, or the position ends up
    ///         under-repaid and the shortfall lands on the protocol.
    function debtForCollateral(
        uint256 collateralSeized,
        uint8 collateralDecimals,
        uint256 collateralPrice,
        uint8 debtDecimals,
        uint256 debtPrice,
        uint256 bonusBps
    ) internal pure returns (uint256) {
        if (debtPrice == 0 || collateralPrice == 0) revert InvalidPrice();
        if (bonusBps > MAX_BONUS_BPS) revert BonusOutOfRange(bonusBps);

        uint256 valueAtDebtScale = Rounding.mulDiv(
            collateralSeized,
            collateralPrice * Decimals.pow10(debtDecimals),
            Decimals.pow10(collateralDecimals),
            Rounding.Direction.Up
        );

        return
            Rounding.mulDiv(
                valueAtDebtScale,
                Percentage.BPS,
                debtPrice * (Percentage.BPS + bonusBps),
                Rounding.Direction.Up
            );
    }

    /// @notice The most of a debt that may be repaid in one liquidation.
    /// @dev    Rounds **down**, so a close factor of 50% can never authorise
    ///         repaying 50% plus a unit — the bound is a ceiling, and a bound
    ///         that rounds up is not a bound.
    function maxRepayable(uint256 totalDebt, uint256 closeFactorBps) internal pure returns (uint256) {
        if (closeFactorBps > Percentage.BPS) revert BonusOutOfRange(closeFactorBps);
        return Rounding.mulDivDown(totalDebt, closeFactorBps, Percentage.BPS);
    }

    /// @notice The bonus portion of a seizure, in collateral units.
    /// @dev    What the liquidator earns above the debt's face value. Derived
    ///         by subtraction from the same seizure figure rather than
    ///         recomputed, so `principal + bonus == seized` holds exactly —
    ///         the same identity `Percentage.split` protects for fees.
    function bonusPortion(uint256 seized, uint256 bonusBps) internal pure returns (uint256) {
        if (bonusBps > MAX_BONUS_BPS) revert BonusOutOfRange(bonusBps);

        uint256 principal = Rounding.mulDivDown(seized, Percentage.BPS, Percentage.BPS + bonusBps);
        unchecked {
            // `principal <= seized` because the denominator is the larger, so
            // this cannot underflow.
            return seized - principal;
        }
    }
}
