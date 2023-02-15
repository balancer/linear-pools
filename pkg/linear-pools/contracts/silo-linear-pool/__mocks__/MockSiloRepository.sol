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
pragma experimental ABIEncoderV2;

import "../interfaces/ISiloRepository.sol";
import "../interfaces/IInterestRateModel.sol";
import "./MockInterestRateModel.sol";

import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";

contract MockSiloRepository is ISiloRepository, MockMaliciousQueryReverter {
    uint256 private _protocolShareFee;
    // Hardcode a interest rate model to use for testing
    MockInterestRateModel private _model = new MockInterestRateModel(0, 0);

    function getInterestRateModel(
        address, /* silo */
        address /* asset */
    ) external view override returns (IInterestRateModel) {
        maybeRevertMaliciously();
        return _model;
    }

    function protocolShareFee() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _protocolShareFee;
    }

    function setProtocolShareFee(uint256 shareFee) external {
        _protocolShareFee = shareFee;
    }
}
