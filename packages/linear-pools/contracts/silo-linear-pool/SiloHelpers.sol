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

import "./interfaces/ISilo.sol";
import "./interfaces/IInterestRateModel.sol";
import "./interfaces/ISiloRepository.sol";

library SiloHelpers {
    function toShare(uint256 amount, uint256 totalAmount, uint256 totalShares) internal pure returns (uint256) {
        if (totalShares == 0 || totalAmount == 0) {
            return amount;
        }

        uint256 result = (amount * totalShares) / totalAmount;

        // Prevent rounding error
        if (result == 0 && amount != 0) {
            revert("Zero Shares");
        }

        return result;
    }

    function toShareRoundUp(uint256 amount, uint256 totalAmount, uint256 totalShares) internal pure returns (uint256) {
        if (totalShares == 0 || totalAmount == 0) {
            return amount;
        }

        uint256 numerator = amount * totalShares;
        uint256 result = numerator / totalAmount;

        // Round up
        if (numerator % totalAmount != 0) {
            result += 1;
        }

        return result;
    }

    function toAmount(uint256 share, uint256 totalAmount, uint256 totalShares) internal pure returns (uint256) {
        if (totalShares == 0 || totalAmount == 0) {
            return 0;
        }

        uint256 result = (share * totalAmount) / totalShares;

        // Prevent rounding error
        if (result == 0 && share != 0) {
            revert("Zero Assets");
        }

        return result;
    }

    /**
     * @dev This function is similar to _accrueInterest function in the Silo's BaseSilo.sol contract
     * which is used to update state data that is necessary
     */
    function calculateExchangeValue(
        uint256 amount,
        IShareToken shareToken
    ) internal view returns (uint256 accruedInterest) {
        // Load in curent state data needed to begin exchange rate calculation
        ISilo.AssetStorage memory _assetState = shareToken.silo().assetStorage(shareToken.asset());
        ISilo.AssetInterestData memory _interestData = shareToken.silo().interestData(shareToken.asset());
        uint256 lastTimestamp = _interestData.interestRateTimestamp;

        // This is the first time, so we can return early and save some gas
        if (lastTimestamp == 0) {
            _interestData.interestRateTimestamp = uint64(block.timestamp);
            return 0;
        }

        // Interest has already been accrued this block
        if (lastTimestamp == block.timestamp) {
            return 0;
        }

        // rcomp: compound interest rate from the last update until now
        // Use getCompoundInterestRate() instead of getCompoundInterestRateAndUpdate becasue we are operating within
        //      a view function and cannot manipute state
        uint256 rcomp = getModel(shareToken.silo(), shareToken.asset()).getCompoundInterestRate(
            address(shareToken.silo()),
            shareToken.asset(),
            block.timestamp
        );
        uint256 protocolShareFee = shareToken.silo().siloRepository().protocolShareFee();

        // Create new variables to store state variables so we can begin the process of calculating exchange rates
        uint256 totalBorrowAmountCached = _assetState.totalBorrowAmount;
        uint256 protocolFeesCached = _interestData.protocolFees;
        uint256 newProtocolFees;
        uint256 protocolShare;
        uint256 depositorsShare;

        accruedInterest = (totalBorrowAmountCached * rcomp) / 1e18;

        // If we overflow on multiplication it should not revert tx, we will get lower fees
        protocolShare = (accruedInterest * protocolShareFee) / 1e18;
        newProtocolFees = protocolFeesCached + protocolShare;

        if (newProtocolFees < protocolFeesCached) {
            protocolShare = type(uint256).max - protocolFeesCached;
            newProtocolFees = type(uint256).max;
        }

        depositorsShare = accruedInterest - protocolShare;

        // Instead of updating contract state which is not allowed due to the function being accessed within view functions (_getWrappedTokenRate && _getRequiredTokensToWrap),
        // it is necessary to create new variables to store the final values used to calculate exchange rates
        // localDeposits represenents _assetState.totalDeposits
        uint256 localDeposits = _assetState.totalDeposits + depositorsShare;
        // total number of shares
        uint256 totalShares = _assetState.collateralToken.totalSupply();

        // Use the newly created variables to calculate exchange rates
        toShare(amount, localDeposits, totalShares);
    }

    // Gets the interest rate model for a given asset
    function getModel(ISilo silo, address asset) internal view returns (IInterestRateModel) {
        return IInterestRateModel(silo.siloRepository().getInterestRateModel(address(silo), asset));
    }
}
