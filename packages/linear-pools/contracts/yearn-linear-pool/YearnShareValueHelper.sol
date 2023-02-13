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

import "./interfaces/IYearnTokenVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

// solhint-disable not-rely-on-time

// The YearnShareValueHelper provides a more precise wrappedTokenRate than is available
// from simply using the pricePerShare. This is because the pps is limited to the precision
// of the underlying asset (ie: USDC = 6), but it stores more precision internally, so the
// larger the amount exchanged, the larger the precision error becomes.
// This implementation was ported from the ShareValueHelper:
// https://github.com/wavey0x/ShareValueHelper/blob/master/contracts/Helper.sol
contract YearnShareValueHelper {
    using Math for uint256;

    /**
     * @notice returns the amount of tokens required to mint the desired number of shares
     */
    function _sharesToAmount(address vault, uint256 shares) internal view returns (uint256) {
        try IYearnTokenVault(vault).totalSupply() returns (uint256 totalSupply) {
            if (totalSupply == 0) {
                return shares;
            } else {
                uint256 freeFunds = _calculateFreeFunds(vault);

                // Use Math here instead of FixedPoint to improve precision (FixedPoint injects intermediate division).
                // (shares * freeFunds) / totalSupply
                return (shares.mul(freeFunds)).divDown(totalSupply);
            }
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
            // into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _calculateFreeFunds(address vault) private view returns (uint256) {
        try IYearnTokenVault(vault).totalAssets() returns (uint256 totalAssets) {
            uint256 timeSinceReport = block.timestamp.sub(IYearnTokenVault(vault).lastReport());
            uint256 lockedFundsRatio = timeSinceReport.mul(IYearnTokenVault(vault).lockedProfitDegradation());

            if (lockedFundsRatio < FixedPoint.ONE) {
                uint256 lockedProfit = IYearnTokenVault(vault).lockedProfit();
                // (1 - lockedFundsRatio) * lockedProfit
                uint256 correctedProfit = FixedPoint.mulDown(lockedProfit, FixedPoint.complement(lockedFundsRatio));
                return totalAssets.sub(correctedProfit);
            } else {
                return totalAssets;
            }
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Yearn (or any other contract in the call stack) could trick the Pool
            // into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
