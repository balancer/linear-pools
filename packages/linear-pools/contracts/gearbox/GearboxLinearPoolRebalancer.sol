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

import "./interfaces/IGearboxDieselToken.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-linear/contracts/LinearPoolRebalancer.sol";

contract GearboxLinearPoolRebalancer is LinearPoolRebalancer {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _wrapTokens(uint256 amount) internal override {
        // No referral code, depositing from underlying (i.e. DAI, USDC, etc. instead of dDAI or dUSDC). Before we can
        // deposit however, we need to approve the wrapper in the underlying token.
        IGearboxVault gearboxVault = _getGearboxVault(address(_wrappedToken));
        _mainToken.safeApprove(address(gearboxVault), amount);
        gearboxVault.addLiquidity(amount, address(this), 0);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of dDAI or dUSDC). Approvals are not necessary here
        // as the wrapped token is simply burnt.
        IGearboxVault gearboxVault = _getGearboxVault(address(_wrappedToken));
        gearboxVault.removeLiquidity(amount, address(this));
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        IGearboxVault gearboxVault = _getGearboxVault(address(_wrappedToken));
        // see: https://etherscan.io/address/0x86130bDD69143D8a4E5fc50bf4323D48049E98E4#readContract#F17
        // For updated list of pools and tokens, please check:
        // https://dev.gearbox.fi/docs/documentation/deployments/deployed-contracts
        // Since there's fixed point divisions and multiplications with rounding involved, this value might
        // be off by one. We add one to ensure the returned value will always be enough to get `wrappedAmount`
        // when unwrapping. This might result in some dust being left in the Rebalancer.
        return gearboxVault.fromDiesel(wrappedAmount) + 1;
    }

    function _getGearboxVault(address dieselTokenAddress) private view returns (IGearboxVault) {
        address gearboxVaultAddress = IGearboxDieselToken(dieselTokenAddress).owner();
        return IGearboxVault(gearboxVaultAddress);
    }
}
