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

import "./interfaces/IEulerTokenMinimal.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/Version.sol";

import "@balancer-labs/v2-pool-linear/contracts/LinearPool.sol";

contract EulerLinearPool is LinearPool, Version {
    uint256 private immutable _digitsDifference;

    struct ConstructorArgs {
        IVault vault;
        string name;
        string symbol;
        IERC20 mainToken;
        IERC20 wrappedToken;
        address assetManager;
        uint256 upperTarget;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
        string version;
    }

    constructor(ConstructorArgs memory args)
        LinearPool(
            args.vault,
            args.name,
            args.symbol,
            args.mainToken,
            args.wrappedToken,
            args.upperTarget,
            _toAssetManagerArray(args),
            args.swapFeePercentage,
            args.pauseWindowDuration,
            args.bufferPeriodDuration,
            args.owner
        )
        Version(args.version)
    {
        uint256 mainTokenDecimals = ERC20(address(args.mainToken)).decimals();

        // Euler tokens always have 18 decimals
        // https://docs.euler.finance/developers/getting-started/contract-reference#decimals
        _digitsDifference = 18 - mainTokenDecimals;

        // solhint-disable-next-line max-line-length
        _require(
            address(args.mainToken) == IEulerTokenMinimal(address(args.wrappedToken)).underlyingAsset(),
            Errors.TOKENS_MISMATCH
        );
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        // https://github.com/euler-xyz/euler-contracts/blob/master/contracts/modules/EToken.sol#L104
        // Convert an eToken balance to an underlying amount, taking into account current exchange rate
        // @param balance eToken balance, in internal book-keeping units (18 decimals)
        // @return Amount in underlying units, (same decimals as underlying token)
        // balance in eToken is scaled by (wrappedTokenDecimals - mainTokenDecimals)
        // to account for a more precise rate in case the mainToken has lower than 18 decimals

        try
            // solhint-disable-next-line max-line-length
            IEulerTokenMinimal(address(getWrappedToken())).convertBalanceToUnderlying(1e18 * 10**_digitsDifference)
        returns (uint256 rate) {
            return rate;
        } catch (bytes memory revertData) {
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
