// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;

import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";
import "@orbcollective/shared-dependencies/contracts/TestToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../interfaces/IGearboxDieselToken.sol";

contract MockGearboxVault is IGearboxVault, MockMaliciousQueryReverter {
    using FixedPoint for uint256;

    uint256 private _rate = 1e27;
    address private immutable _ASSET;

    constructor(address underlyingAsset) {
        _ASSET = underlyingAsset;
    }

    // solhint-disable-next-line func-name-mixedcase
    function underlyingToken() external view override returns (address) {
        return _ASSET;
    }

    function getDieselRate_RAY() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _rate;
    }

    function setRate(uint256 rate) external {
        _rate = rate;
    }

    function fromDiesel(uint256 amountDiesel) external view override returns (uint256) {
        return amountDiesel.mulDown(_rate) / 10**9;
    }

    function addLiquidity(
        uint256,
        address,
        uint256
    ) external pure override {}

    function removeLiquidity(uint256, address) external pure override {}
}
