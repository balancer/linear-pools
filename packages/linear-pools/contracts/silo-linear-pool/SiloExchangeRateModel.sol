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

import "./interfaces/ISilo.sol";
import "./interfaces/IInterestRateModel.sol";
import "./SiloHelpers.sol";

// Created in order to decrease exchange rate timelag when wrapping and unwrapping tokens
// between Silo Linear Pools and the Silo Protocol
contract SiloExchangeRateModel {
    /**
     * @dev This function is similar to _accrueInterest function in the Silo's BaseSilo.sol contract
     * which is used to update state data that is necessary
     */
    function calculateExchangeValue(
        uint256 amount,
        IShareToken shareToken,
        ISilo.AssetStorage memory assetStorage,
        ISilo.AssetInterestData memory interestData
    ) external view returns (uint256) {
        // rcomp: compound interest rate from the last update until now
        // Use getCompoundInterestRate() instead of getCompoundInterestRateAndUpdate becasue we are operating within
        //      a view function and cannot manipute state
        uint256 rcomp = getModel(shareToken.silo(), shareToken.asset()).getCompoundInterestRate(
            address(shareToken.silo()),
            shareToken.asset(),
            block.timestamp
        );

        uint256 accruedInterest = (assetStorage.totalBorrowAmount * rcomp) / 1e18;

        // If we overflow on multiplication it should not revert tx, we will get lower fees
        uint256 protocolShare = (accruedInterest * shareToken.silo().siloRepository().protocolShareFee()) / 1e18;

        // interestData.protocolFees + protocolShare = to newProtocolFees
        // Cut variable in order to be able to compile
        if (interestData.protocolFees + protocolShare < interestData.protocolFees) {
            protocolShare = type(uint256).max - interestData.protocolFees;
        }

        //_depositorsShare = accruedInterest - protocolShare;

        // Instead of updating contract state which is not allowed due to the function being accessed within view functions (_getWrappedTokenRate && _getRequiredTokensToWrap),
        // it is necessary to create new variables to store the final values used to calculate exchange rates
        // localDeposits represenents _assetState.totalDeposits
        // accruedInterest - protocolShare is the depositorsShare. No variable used to save memory
        uint256 localDeposits = assetStorage.totalDeposits + accruedInterest - protocolShare;
        // total number of shares
        uint256 totalShares = assetStorage.collateralToken.totalSupply();

        // Use the newly created variables to calculate exchange rates
        return SiloHelpers.toAmount(amount, localDeposits, totalShares);
    }

    // Gets the interest rate model for a given asset
    function getModel(ISilo silo, address asset) internal view returns (IInterestRateModel) {
        return IInterestRateModel(silo.siloRepository().getInterestRateModel(address(silo), asset));
    }
}
