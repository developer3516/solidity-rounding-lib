// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FixedPoint} from "../FixedPoint.sol";
import {Rounding} from "../Rounding.sol";

/// @notice Test-only external surface for the `FixedPoint` library.
contract FixedPointHarness {
    function wad() external pure returns (uint256) {
        return FixedPoint.WAD;
    }

    function ray() external pure returns (uint256) {
        return FixedPoint.RAY;
    }

    function mulWad(uint256 a, uint256 b, Rounding.Direction d) external pure returns (uint256) {
        return FixedPoint.mulWad(a, b, d);
    }

    function divWad(uint256 a, uint256 b, Rounding.Direction d) external pure returns (uint256) {
        return FixedPoint.divWad(a, b, d);
    }

    function mulWadDown(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.mulWadDown(a, b);
    }

    function mulWadUp(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.mulWadUp(a, b);
    }

    function divWadDown(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.divWadDown(a, b);
    }

    function divWadUp(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.divWadUp(a, b);
    }

    function mulRay(uint256 a, uint256 b, Rounding.Direction d) external pure returns (uint256) {
        return FixedPoint.mulRay(a, b, d);
    }

    function divRay(uint256 a, uint256 b, Rounding.Direction d) external pure returns (uint256) {
        return FixedPoint.divRay(a, b, d);
    }

    function mulRayDown(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.mulRayDown(a, b);
    }

    function mulRayUp(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.mulRayUp(a, b);
    }

    function divRayDown(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.divRayDown(a, b);
    }

    function divRayUp(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPoint.divRayUp(a, b);
    }

    function wadToRay(uint256 wad) external pure returns (uint256) {
        return FixedPoint.wadToRay(wad);
    }

    function rayToWad(uint256 ray, Rounding.Direction d) external pure returns (uint256) {
        return FixedPoint.rayToWad(ray, d);
    }
}
