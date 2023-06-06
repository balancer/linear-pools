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
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IBAMM.sol";


contract MockBProtocolAMM is ReentrancyGuard, IBAMM {

    address public override immutable SP;

    constructor(address _mockStabilityPool) {
        SP = _mockStabilityPool;
    }

    function deposit(uint256 lusdAmount) external override nonReentrant() {
        // [] transfer LUSD from msg.sender to the AMM Contract
        // [] transfer LUSD from the AMM contract to the Mock Stability pool
        // [] track user deposits in the form of shares
    }

    function balanceOf(address account) public override view returns(uint256){
        return 1;
    }

    function totalSupply() public view override returns(uint256) {
        return 1;
    }


    function withdraw(uint256 numShares) external override nonReentrant() {
        // [] request LUSD from the Mock Stability Pool depending on
        // amount of shares
        // [] send LUSD to withdrawer
        // [] burn shares
        // [] send Eth to withdrawer
        // [] send LQTY to withdrawer
    }    
}