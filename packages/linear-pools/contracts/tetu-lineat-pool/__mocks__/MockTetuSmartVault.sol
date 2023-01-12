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

pragma solidity >=0.7.0 <0.9.0;

import "../interfaces/ITetuSmartVault.sol";

import "./MockTetuStrategy.sol";

import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";
import "@orbcollective/shared-dependencies/contracts/TestToken.sol";

contract MockTetuSmartVault is ITetuSmartVault, TestToken, MockMaliciousQueryReverter {
    IERC20 public underlyingAsset;
    uint256 underlyingDecimals;
    uint256 private _underlyingBalanceInVault = 0;
    MockTetuStrategy private immutable _tetuStrategy;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _underlyingAsset,
        MockTetuStrategy tetuStrategy
    ) TestToken(name, symbol, decimals) {
        underlyingAsset = IERC20(_underlyingAsset);
        underlyingDecimals = decimals;
        _tetuStrategy = tetuStrategy;
    }

    function getPricePerFullShare() external view override returns (uint256) {
        revert("Should not call this");
    }

    // Should pass rate with decimals from underlyingToken
    function setRate(uint256 newRate) public {
        uint256 totalSupply = this.totalSupply();
        // arbitrary number, just to make sure that both Vault and Invested values compose the rate.
        uint8 vaultInvestedRatio = 3;
        _underlyingBalanceInVault = newRate * totalSupply / (vaultInvestedRatio * 10**underlyingDecimals);
        _tetuStrategy.setInvestedUnderlyingBalance(
            (vaultInvestedRatio - 1) * newRate * totalSupply / (vaultInvestedRatio * 10**underlyingDecimals)
        );
    }

    function underlyingBalanceInVault() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _underlyingBalanceInVault;
    }

    function underlyingBalanceWithInvestmentForHolder(address) external view override returns (uint256) {
        return underlyingAsset.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override {}

    function withdraw(uint256 numberOfShares) external override {}

    function transferUnderlying(uint256 amount, address to) public {}

    function underlying() external view override returns (address) {
        return address(underlyingAsset);
    }

    function underlyingUnit() external view override returns (uint256) {
        return 10**underlyingDecimals;
    }

    function strategy() external view override returns (address) {
        return address(_tetuStrategy);
    }
}
