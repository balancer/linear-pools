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

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol"

contract MockBProtocolERC20Wrapper is ERC20 {

    // SafeERC20
    // SafeApprove? 
    // possibility to sweep from this contract? 


    address public immutable BAMM; // BProtocol AMM
    address public immutable LQTY; // LQTY Token
    address public gauge; // Boosted Pool Gauge

    construtor(address _gauge) ERC20("Wrapped BProtocol AMM", "WBAMM") {
        gauge = _gauge;
    }

    function deposit(uint256 lusdAmount) external {
        // Transfer LUSD from user to BProtocol AMM
        // Transfer BProtocol AMM shares from BProtocol AMM to user
        // Mint WBAMM to user

    }

    function withdraw(uint256 numShares) external {
        // Burn WBAMM from user
        // Transfer Bprotocol AMM shares from the Wrapper contract back to BAMM
        // Transfer LUSD from BProtocol AMM to user
    }

    // TODO: Implement 
    function handleEth() external {
        // during every withdrawl the possibility of this contract
        // receiving eth exists, so it must be handled.

    }

    // TODO: Implement 
    function handleLQTY() external {
        // during every withdrawl the possibility of this contract
        // receiving LQTY exists, so it must be handled.
    }   
}