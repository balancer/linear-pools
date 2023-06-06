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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/IWBAMM.sol";
import "./MockBProtocolExchangeRateModel.sol";


contract MockBProtocolWrapper is ERC20, IWBAMM, MockBprotocolExchangeRateModel {

    // SafeERC20
    // SafeApprove? 
    // possibility to sweep from this contract? 

    // address public immutable BAMM; // BProtocol AMM
    address public immutable LQTY; // LQTY Token
    address public gauge; // Boosted Pool Gauge

    constructor(address _gauge, address _lqty, address SP, address _bamm) ERC20("Wrapped BProtocol AMM", "WBAMM") 
        MockBprotocolExchangeRateModel(SP, _bamm)
    {
        gauge = _gauge;
        LQTY = _lqty;
    }

    // TODO: remove
    function previewWithdraw(uint256 numShares) external override view returns(uint256) {
        // Calculate the amount of LUSD that will be withdrawn
        // based on the amount of shares
        return 1;
    }

    function deposit(uint256 lusdAmount) external override returns(uint256) {
        // Transfer LUSD from user to BProtocol AMM
        // Transfer BProtocol AMM shares from BProtocol AMM to user
        // Mint WBAMM to user
        return 1;

    }

    function withdraw(uint256 numShares) external override  returns (uint256) {
        // Burn WBAMM from user
        // Transfer Bprotocol AMM shares from the Wrapper contract back to BAMM
        // Transfer LUSD from BProtocol AMM to user
        return 1;
    }

    // TODO: Implement 
    function handleEth() external view returns(uint256) {
        // during every withdrawl the possibility of this contract
        // receiving eth exists, so it must be handled.
        return 1;
    }

    // TODO: Implement 
    function handleLQTY() external view returns (uint256) {
        // during every withdrawl the possibility of this contract
        // receiving LQTY exists, so it must be handled.
        return 1;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}