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
import "./interfaces/IShareToken.sol";
import "./SiloExchangeRateModel.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/Version.sol";
import "@balancer-labs/v2-pool-linear/contracts/LinearPool.sol";

contract SiloLinearPool is LinearPool, Version {
    ISilo private immutable _silo;
    IShareToken private immutable _shareToken;
    SiloExchangeRateModel private _exchangeRateModel;
    uint8 private immutable _decimals;

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
        _decimals = ERC20(address(args.wrappedToken)).decimals();
        _exchangeRateModel = new SiloExchangeRateModel();
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
        try _silo.assetStorage(_shareToken.asset()) returns (ISilo.AssetStorage memory assetStorage) {
            try _silo.interestData(_shareToken.asset()) returns (ISilo.AssetInterestData memory interestData) {
                uint256 rate = _exchangeRateModel.calculateExchangeValue(
                    _shareToken,
                    assetStorage,
                    interestData
                );

                return rate;
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
}
