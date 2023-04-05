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

contract MidasLinearPoolRebalancer is LinearPoolRebalancer {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    uint256 private immutable _divisor;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(
        IVault vault,
        IBalancerQueries queries
    ) LinearPoolRebalancer(_getLinearPool(), vault, queries) {
        ILinearPool pool = _getLinearPool();        

        // The CToken function `exchangeRateHypothetical` returns the rate scaled to 18 decimals.
        // When calculating _getRequiredTokensToWrap, we receive wrappedAmount in the decimals
        // of the wrapped token. To get back to main token decimals, we divide by:
        // 10^(18 + wrappedTokenDecimals - mainTokenDecimals)
        _divisor = 10**(18 + ERC20(address(pool.getWrappedToken())).decimals() - ERC20(address(pool.getMainToken())).decimals());
    }

    function _wrapTokens(uint256 amount) internal override {
        _mainToken.safeApprove(address(_wrappedToken), amount);
        require(ICToken(address(_wrappedToken)).mint(amount) == 0, "wrapping failed");
    }

    function _unwrapTokens(uint256 wrappedAmount) internal override {
        require(ICToken(address(_wrappedToken)).redeem(wrappedAmount) == 0, "unwrapping failed");
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // Midas' `exchangeRateHypothetical` returns the exchangeRate for the current block scaled to 18 decimals. It
        // builds on Compounds' `exchangeRateStored` function by projecting the exchangeRate to the current block.
        return wrappedAmount.mulUp(ICToken(address(_wrappedToken)).exchangeRateHypothetical()).divUp(_divisor);
    }

    function _getLinearPool() private view returns (ILinearPool) {
        return ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool());
    }
}
