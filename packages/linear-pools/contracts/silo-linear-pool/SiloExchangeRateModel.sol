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

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./interfaces/ISilo.sol";
import "./interfaces/IInterestRateModel.sol";

// Created in order to decrease exchange rate timelag when wrapping and unwrapping tokens
// between Silo Linear Pools and the Silo Protocol
contract SiloExchangeRateModel {
    using FixedPoint for uint256;

    /**
     * @dev This function is similar to _accrueInterest function in the Silo's BaseSilo.sol contract
     * which is used to update state data that is necessary
     */
    function calculateExchangeValue(
        IShareToken shareToken,
        ISilo.AssetStorage memory assetStorage,
        ISilo.AssetInterestData memory interestData
    ) external view returns (uint256) {
        // rcomp: compound interest rate from the last update until now
        // Use getCompoundInterestRate() instead of getCompoundInterestRateAndUpdate becasue we are operating within
        //      a view function and cannot manipute state
        try
            getModel(shareToken.silo(), shareToken.asset()).getCompoundInterestRate(
                address(shareToken.silo()),
                shareToken.asset(),
                block.timestamp
            )
        returns (uint256 rcomp) {
            uint256 accruedInterest = assetStorage.totalBorrowAmount.mulDown(rcomp);
            try shareToken.silo().siloRepository().protocolShareFee() returns (uint256 protocolShareFee) {
                uint256 protocolShare = accruedInterest.mulDown(protocolShareFee);
                // interestData.protocolFees + protocolShare = to newProtocolFees
                // Cut variable in order to be able to compile
                if (interestData.protocolFees + protocolShare < interestData.protocolFees) {
                    protocolShare = type(uint256).max - interestData.protocolFees;
                }

                // Instead of updating contract state which is not allowed due to the function being accessed within view functions (_getWrappedTokenRate && _getRequiredTokensToWrap),
                // it is necessary to create new variables to store the final values used to calculate exchange rates
                // localDeposits represenents _assetState.totalDeposits
                // accruedInterest - protocolShare is the depositorsShare. No variable used to save memory
                uint256 localDeposits = assetStorage.totalDeposits + accruedInterest - protocolShare;
                // total number of shares
                uint256 totalShares = assetStorage.collateralToken.totalSupply();

                // Use the newly created variables to calculate exchange rates
                return localDeposits.divDown(totalShares);
            } catch (bytes memory revertData) {
                // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
                // reporting invalid data to the query mechanism for swaps/joins/exits.
                // We then check the revert data to ensure this doesn't occur.
                ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
            }
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    // Gets the interest rate model for a given asset
    function getModel(ISilo silo, address asset) internal view returns (IInterestRateModel) {
        try silo.siloRepository().getInterestRateModel(address(silo), asset) returns (IInterestRateModel model) {
            return model;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
