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

import "@orbcollective/shared-dependencies/contracts/TestToken.sol";
import "@orbcollective/shared-dependencies/contracts/MockMaliciousQueryReverter.sol";

//we're unable to implement IYearnTokenVault because it defines the decimals function, which collides with
//the TestToken ERC20 implementation
contract MockYearnTokenVault is TestToken, MockMaliciousQueryReverter {
    address private immutable _token;
    uint256 private _pricePerShare;
    uint256 private _totalSupply;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset,
        uint256 sharePrice
    ) TestToken(name, symbol, decimals) {
        _token = underlyingAsset;
        _pricePerShare = sharePrice;
        _totalSupply = 0;
    }

    function token() external view returns (address) {
        return _token;
    }

    function pricePerShare() external view returns (uint256) {
        maybeRevertMaliciously();
        return _pricePerShare;
    }

    function setPricePerShare(uint256 _newPricePerShare) public {
        _pricePerShare = _newPricePerShare;
    }

    function deposit(uint256 _amount, address recipient) public returns (uint256) {
        ERC20(_token).transferFrom(msg.sender, address(this), _amount);
        
        uint256 amountToMint = _amount * 10**decimals() / _pricePerShare;
        
        _mint(recipient, amountToMint);

        return amountToMint;
    }

    function withdraw(uint256 maxShares, address recipient) public returns (uint256) {
        _burn(msg.sender, maxShares);
        
        uint256 amountToReturn = maxShares * _pricePerShare / 10**decimals();
        
        ERC20(_token).transfer(recipient, amountToReturn);

        return amountToReturn;
    }


    function lockedProfitDegradation() external pure returns (uint256) {
        return 1e18;
    }

    function lastReport() external pure returns (uint256) {
        return 0;
    }

    function totalAssets() external view returns (uint256) {
        maybeRevertMaliciously();
        return totalSupply() * _pricePerShare / 10**decimals();
    }

    function lockedProfit() external pure returns (uint256) {
        return 0;
    }

    function totalSupply() public view virtual override returns (uint256) {
        maybeRevertMaliciously();
        return _totalSupply;
    }

    function setTotalSupply(uint256 _newTotalSupply) public {
        _totalSupply = _newTotalSupply;
    }
}
