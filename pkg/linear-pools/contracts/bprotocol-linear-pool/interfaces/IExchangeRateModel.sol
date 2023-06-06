//SPDX-License-Identifier: MIT
interface IExchangeRateModel {
    function getSharesExchangeRate() external view returns (uint256 rate);
}