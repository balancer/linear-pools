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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

import "./interfaces/ITetuSmartVault.sol";
import "./interfaces/ITetuStrategy.sol";

contract TetuShareValueHelper {
    using SafeERC20 for IERC20;
    using Math for uint256;

    function _getTokenRate(address wrappedTokenAddress) internal view returns (uint256) {
        // Since there's fixed point divisions and multiplications with rounding involved, this value might
        // be off by one. We add one to ensure the returned value will always be enough to get `wrappedAmount`
        // when unwrapping. This might result in some dust being left in the Rebalancer.

        uint256 wrappedTokenTotalSupply = _getWrappedTokenTotalSupply(wrappedTokenAddress);
        if (wrappedTokenTotalSupply == 0) {
            return 0;
        } else {
            uint256 underlyingBalanceInVault = _getUnderlyingBalanceInVault(wrappedTokenAddress);
            uint256 strategyInvestedUnderlyingBalance = _getStrategyInvestedUnderlyingBalance(wrappedTokenAddress);
            uint256 balance = Math.add(underlyingBalanceInVault, strategyInvestedUnderlyingBalance);
            return FixedPoint.divDown(balance, wrappedTokenTotalSupply);
        }
    }

    function _getWrappedTokenTotalSupply(address wrappedTokenAddress) private view returns (uint256) {
        try IERC20(wrappedTokenAddress).totalSupply() returns (uint256 totalSupply) {
            return totalSupply;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
            // into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getUnderlyingBalanceInVault(address wrappedTokenAdddress) private view returns (uint256) {
        try ITetuSmartVault(wrappedTokenAdddress).underlyingBalanceInVault() returns (
            uint256 underlyingBalanceInVault
        ) {
            return underlyingBalanceInVault;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
            // into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getStrategyInvestedUnderlyingBalance(address wrappedTokenAddress) private view returns (uint256) {
        address tetuStrategy = _getTetuStrategy(wrappedTokenAddress);
        if (address(tetuStrategy) == address(0)) {
            return 0;
        } else {
            try ITetuStrategy(tetuStrategy).investedUnderlyingBalance() returns (
                uint256 strategyInvestedUnderlyingBalance
            ) {
                return strategyInvestedUnderlyingBalance;
            } catch (bytes memory revertData) {
                // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
                // into reporting invalid data to the query mechanism for swaps/joins/exits.
                // We then check the revert data to ensure this doesn't occur.
                ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
            }
        }
    }

    function _getTetuStrategy(address wrappedTokenAddress) private view returns (address) {
        try ITetuSmartVault(wrappedTokenAddress).strategy() returns (address strategy) {
            return strategy;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
            // into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
