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

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";


import "../interfaces/IBAMM.sol";
import "../interfaces/ISP.sol";

contract MockBprotocolExchangeRateModel is MockMaliciousQueryReverter {
    ISP public stabilityPool;
    IBAMM public bamm;

    uint256 internal rate = 1e18;

    constructor(address _stabilityPool, address _bamm) {
        stabilityPool = ISP(_stabilityPool);
        bamm = IBAMM(_bamm);
    }

    function getSharesExchangeRate() external view returns (uint256) {
        maybeRevertMaliciously();

        // calculate total LUSD claim the BAMM has on the SP
        // percentage the shares the Rebalancer owns  is the claim
        // of LUSD the Rebalancer has.
        uint256 bammTotalLUSDclaimable = _getCompoundedLUSDDeposit(address(bamm));
        uint256 bammTotalShares = _getTotalSupply();
        uint256 rebalancerShares = _getAmountOfShares(rebalancer);

        uint256 rate = (bammTotalLUSDclaimable * rebalancerShares) / bammTotalShares;
        return rate;
    }

    // External call functions need to be wrapped in a try catch statement &
    // bubble up revert data.
    function _getCompoundedLUSDDeposit(address _address) private view returns(uint256 amount) {
        try stabilityPool.getCompoundedLUSDDeposit(address(bamm)) returns (uint256 amount) {
            return amount;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getTotalSupply() private view returns (uint256) {

        try IBAMM(bamm).totalSupply() returns (uint256 totalSupply) {
            return totalSupply;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);            
        }
    }

    function _getAmountOfShares(address _rebalancer) private view returns (uint256) {

        try IBAMM(bamm).balanceOf(_rebalancer) returns (uint256 balance) {
            return balance;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function setSharesExchangeRate(uint256 newRate) external {
        rate = newRate;
    }
}