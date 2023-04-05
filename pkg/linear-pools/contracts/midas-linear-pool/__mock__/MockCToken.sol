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

import "../interfaces/ICToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";
import "@orbcollective/shared-dependencies/contracts/TestToken.sol";

contract MockCToken is TestToken, ICToken, MockMaliciousQueryReverter {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    address public immutable override underlying;

    uint256 private immutable _scaleFactor;

    uint256 private _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset,
        uint256 exchangeRate
    ) TestToken(name, symbol, decimals) {
        underlying = underlyingAsset;

        // Scale the exchange rate to 1e(18-decimals+underlyingDecimals).
        uint256 scaleFactor = 10**(uint256(18 - decimals).add(ERC20(underlyingAsset).decimals()));
        _scaleFactor = scaleFactor;

        // Incoming exchange rate is scaled to 1e18.
        _exchangeRate = exchangeRate.mulDown(scaleFactor);
    }

    /**
     * @notice Sender supplies assets into the market and receives cTokens in exchange
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param mintAmount The amount of the underlying asset to supply
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function mint(uint256 mintAmount) public override returns (uint256) {
        uint256 amountToMint = toCTokenAmount(mintAmount);

        IERC20(underlying).safeTransferFrom(msg.sender, address(this), mintAmount);

        _mint(msg.sender, amountToMint);

        return 0;
    }

    function mintCTokens(uint256 mintAmount) public {
        mint(mintAmount);
    }

    /**
     * @notice Sender redeems cTokens in exchange for the underlying asset
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param redeemTokens The number of cTokens to redeem into underlying
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function redeem(uint256 redeemTokens) external override returns (uint256) {
        _burn(msg.sender, redeemTokens);

        uint256 amountToReturn = fromCTokenAmount(redeemTokens);

        IERC20(underlying).safeTransfer(msg.sender, amountToReturn);

        return 0;
    }

    /* function exchangeRateCurrent() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _exchangeRate;
    } */

    /* function exchangeRateStored() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _exchangeRate;
    } */

    function exchangeRateHypothetical() external view override returns (uint256) {
        maybeRevertMaliciously();
        return _exchangeRate;
    }

    function setExchangeRate(uint256 newExchangeRate) external {
        _exchangeRate = newExchangeRate.mulDown(_scaleFactor);
    }

    /**
     * @notice Preview the amount of cTokens returned by a deposit.
     * @param amount The number of underlying tokens to be deposited.
     * @return The number of cTokens returned.
     */
    function toCTokenAmount(uint256 amount) public view returns (uint256) {
        return amount.divDown(_exchangeRate);
    }

    /**
     * @notice Preview the amount of underlying returned by a withdrawal.
     * @param amount The number of cTokens to be redeemed.
     * @return The number of underlying tokens returned.
     */
    function fromCTokenAmount(uint256 amount) public view returns (uint256) {
        return amount.mulUp(_exchangeRate);
    }
}
