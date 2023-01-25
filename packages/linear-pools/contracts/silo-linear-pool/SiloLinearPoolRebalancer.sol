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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-pool-linear/contracts/LinearPoolRebalancer.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./interfaces/IShareToken.sol";
import "./interfaces/ISilo.sol";
import "./SiloExchangeRateModel.sol";

contract SiloLinearPoolRebalancer is LinearPoolRebalancer {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    IShareToken private _shareToken;
    ISilo private _silo;
    SiloExchangeRateModel private _exchangeRateModel;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(
        IVault vault,
        IBalancerQueries queries,
        address wrappedToken
    ) LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries) {
        _shareToken = IShareToken(address(wrappedToken));
        _silo = ISilo(_shareToken.silo());
        _exchangeRateModel = new SiloExchangeRateModel();
    }

    function _wrapTokens(uint256 amount) internal override {
        // @dev In order to receive a sharesToken that can gain interest false must be entered for collateralOnly
        // deposit however, we need to approve the silo where we will be depositing our tokens to.
        _mainToken.safeApprove(address(_silo), amount);
        _silo.deposit(address(_mainToken), amount, false);
    }

    function _unwrapTokens(uint256 wrappedAmount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of sDAI or sUSDC). Approvals are not necessary here
        // as the wrapped token is simply burnt
        uint256 mainAmount = _getRequiredTokensToWrap(wrappedAmount) - 1;
        // Same way we round up requiredTokensToWrap, we need to round down the main amount,
        // to make sure we have enough tokens to unwrap.
        _silo.withdraw(address(_mainToken), mainAmount, false);
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        ISilo.AssetStorage memory assetStorage = _silo.assetStorage(_shareToken.asset());
        ISilo.AssetInterestData memory interestData = _silo.interestData(_shareToken.asset());
        uint256 rate = _exchangeRateModel.calculateExchangeValue(_shareToken, assetStorage, interestData);
        return wrappedAmount.mulDown(rate) + 1;
    }
}
