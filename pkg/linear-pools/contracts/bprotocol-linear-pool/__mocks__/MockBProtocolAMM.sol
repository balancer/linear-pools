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
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MockBProtocolAMM is ReentrancyGuard, ERC20 {

    address public immutable mockStabilityPool;

    constructor(address _mockStabilityPool) ERC20("Mock Liquity Token", "MockLQTY") {
        mockStabilityPool = _mockStabilityPool;
    }

    function deposit(uint256 lusdAmount) external nonReentrant() {
        // [] transfer LUSD from msg.sender to the AMM Contract
        // [] transfer LUSD from the AMM contract to the Mock Stability pool
        // [] track user deposits in the form of shares

    }

    function withdraw(uint256 numShares) external nonReentrant() {
        // [] request LUSD from the Mock Stability Pool depending on
        // amount of shares
        // [] send LUSD to withdrawer
        // [] burn shares
        // [] send Eth to withdrawer
        // [] send LQTY to withdrawer
    }

    function previewWithdraw(uint256 shares) external view returns (uint256) {
        // [] return the amount of LUSD that would be withdrawn for
        // a given amount of shares
    }
    
}