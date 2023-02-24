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

import "./interfaces/ICToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

library CTokenExchangeRate {
    using FixedPoint for uint256;

    function viewExchangeRate(ICToken cToken) internal view returns (uint256) {
        uint256 accrualBlockNumberPrior = _getAccrualBlock(cToken);

        if (accrualBlockNumberPrior == block.number) {
            return _getExchangeRateStored(cToken);
        }

        uint256 totalCash = ERC20(cToken.underlying()).balanceOf(address(cToken));
        uint256 borrowsPrior = _getTotalBorrows(cToken);
        uint256 reservesPrior = _getTotalReserves(cToken);

        uint256 borrowRateMantissa = cToken.interestRateModel().getBorrowRate(totalCash, borrowsPrior, reservesPrior);

        //solhint-disable-next-line max-line-length
        require(borrowRateMantissa <= 0.0005e16, "RATE_TOO_HIGH"); // Same as borrowRateMaxMantissa in CTokenInterfaces.sol

        uint256 interestAccumulated = (borrowRateMantissa * (block.number - accrualBlockNumberPrior)).mulDown(
            borrowsPrior
        );

        uint256 totalReserves = cToken.reserveFactorMantissa().mulDown(interestAccumulated) + reservesPrior;
        uint256 totalBorrows = interestAccumulated + borrowsPrior;
        uint256 totalSupply = cToken.totalSupply();

        // TODO: determine "live" fee calculation
        // totalFuseFeesNew = interestAccumulated * fuseFee + totalFuseFees
        // totalAdminFeesNew = interestAccumulated * adminFee + totalAdminFees

        return
            totalSupply == 0
                ? _getInitialExchangeRate(cToken)
                : (totalCash +
                    totalBorrows -
                    (totalReserves + _getTotalFuseFeesPrior(cToken) + _getTotalAdminFeesPrior(cToken)))
                    .divDown(totalSupply);
    }

    function _getAccrualBlock(ICToken cToken) private view returns (uint256) {
        try cToken.accrualBlockNumber() returns (uint256 blockNumber) {
            return blockNumber;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getExchangeRateStored(ICToken cToken) private view returns (uint256) {
        try cToken.exchangeRateStored() returns (uint256 rate) {
            return rate;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getTotalBorrows(ICToken cToken) private view returns (uint256) {
        try cToken.totalBorrows() returns (uint256 totalBorrows) {
            return totalBorrows;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getTotalReserves(ICToken cToken) private view returns (uint256) {
        try cToken.totalReserves() returns (uint256 totalReserves) {
            return totalReserves;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getInitialExchangeRate(ICToken cToken) private view returns (uint256) {
        try cToken.initialExchangeRateMantissa() returns (uint256 rate) {
            return rate;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getTotalAdminFeesPrior(ICToken cToken) private view returns (uint256) {
        try cToken.totalAdminFees() returns (uint256 totalAdminFees) {
            return totalAdminFees;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }

    function _getTotalFuseFeesPrior(ICToken cToken) private view returns (uint256) {
        try cToken.totalFuseFees() returns (uint256 totalFuseFees) {
            return totalFuseFees;
        } catch (bytes memory revertData) {
            // By maliciously reverting here, Aave (or any other contract in the call stack) could trick the Pool into
            // reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
