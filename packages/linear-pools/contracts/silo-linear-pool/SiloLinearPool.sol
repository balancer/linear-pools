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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ISilo.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/Version.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/IShareToken.sol";

import "./SiloHelpers.sol";
import "../LinearPool.sol";

contract SiloLinearPool is LinearPool, Version {
    ISilo private immutable _silo;
    IShareToken private immutable _shareToken;

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

    constructor(
        ConstructorArgs memory args
    )
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
        _shareToken = IShareToken(address(args.wrappedToken));
        _silo = ISilo(IShareToken(address(args.wrappedToken)).silo());
        _require(address(args.mainToken) == IShareToken(address(args.wrappedToken)).asset(), Errors.TOKENS_MISMATCH);
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        // @dev value hardcoded to find the exchange rate for a single _shareToken
        uint256 singleShare = 1e18;
        // @dev total amount deposited
        uint256 totalAmount = _silo.assetStorage(_shareToken.asset()).totalDeposits;
        // @dev total number of shares
        uint256 totalShares = _shareToken.totalSupply();
        // @dev toAmount function is what silo uses to calculate exchange rates during withdraw period
        // The protocol currently does not expose an exchange rate function
        uint256 rate = SiloHelpers.toAmount(singleShare, totalAmount, totalShares);

        return rate;
    }
}
