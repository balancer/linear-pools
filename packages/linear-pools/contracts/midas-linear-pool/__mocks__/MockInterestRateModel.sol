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

import "../interfaces/IInterestRateModel.sol";

contract MockInterestRateModel is IInterestRateModel {
    uint256 private _borrowRate;
    uint256 private _supplyRate;

    function getBorrowRate(
        uint256, /*cash*/
        uint256, /*borrows*/
        uint256 /*reserves*/
    ) external view override returns (uint256) {
        return _borrowRate;
    }

    function getSupplyRate(
        uint256, /*cash*/
        uint256, /*borrows*/
        uint256 /*reserves*/
    ) external view override returns (uint256) {
        return _supplyRate;
    }

    function setBorrowRate(uint256 rate) public {
        _borrowRate = rate;
    }

    function setSupplyRate(uint256 rate) public {
        _supplyRate = rate;
    }
}
