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

import "./interfaces/ICToken.sol";

import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-pool-linear/contracts/LinearPoolRebalancer.sol";
import "./CTokenExchangeRate.sol";

import "hardhat/console.sol";

contract MidasLinearPoolRebalancer is LinearPoolRebalancer {
    // uint256 mainTokensToActuallyWrap;

    using FixedPoint for uint256;
    using SafeERC20 for IERC20;
    using CTokenExchangeRate for ICToken;

    uint256 private immutable _divisor;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    {
        ILinearPool pool = ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool());
        ERC20 mainToken = ERC20(address(pool.getMainToken()));
        ERC20 wrappedToken = ERC20(address(pool.getWrappedToken()));

        // The CToken function exchangeRateCurrent returns the rate scaled to 18 decimals.
        // when calculating _getRequiredTokensToWrap, we receive wrappedAmount in the decimals
        // of the wrapped token. To get back to main token decimals, we divide by:
        // 10^(18 + wrappedTokenDecimals - mainTokenDecimals)
        _divisor = 10**(18 + wrappedToken.decimals() - mainToken.decimals());
    }

    function _wrapTokens(uint256 amount) internal override {
        // Depositing from underlying (i.e. DAI, USDC, etc. instead of cDAI or cUSDC). Before we can
        // deposit however, we need to approve the wrapper (cToken) in the underlying token.
        _mainToken.safeApprove(address(_wrappedToken), amount);
        ICToken(address(_wrappedToken)).mint(amount);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of cDAI or cUSDC). Approvals are not necessary
        // here as the wrapped token is simply burnt.
        ICToken(address(_wrappedToken)).redeem(amount);
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // exchangeRateStored calculates the exchange rate from the underlying (main) to the CToken (wrapped) scaled
        // to 1e18. Since the rate calculation includes divisions and multiplications with rounding involved, this
        // value might be off by one. We divUp to ensure the returned value will always be enough to get
        // `wrappedAmount` when unwrapping. This might result in some dust being left in the Rebalancer.
        // wrappedAmount * exchangeRateCurrent / divisor

        // console.log("_getRequiredTokensToWrap: wrappedAmount", wrappedAmount);
        // uint256 exchangeRate = ICToken(address(_wrappedToken)).viewExchangeRate();
        //console.log("_getRequiredTokensToWrap: exchangeRate - library view", exchangeRate);

        uint256 mainTokensToActuallyWrap = wrappedAmount
            .mulUp(ICToken(address(_wrappedToken)).viewExchangeRate())
            .divUp(_divisor);
        console.log("_getRequiredTokensToWrap: mainTokensToActuallyWrap", mainTokensToActuallyWrap);
        console.log("_getRequiredTokensToWrap: mainTokensToActuallyWrap + 1", mainTokensToActuallyWrap + 1);

        // return wrappedAmount.mulUp(ICToken(address(_wrappedToken)).viewExchangeRate()).divUp(_divisor);
        return mainTokensToActuallyWrap;
    }
}
