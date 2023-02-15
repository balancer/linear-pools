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

contract MockTimelockAuthorizer {
    mapping(bytes32 => bool) private _isPermissionGranted;

    /**
         * @notice A sentinel value for `where` that will match any address.
     */
    address public constant EVERYWHERE = address(-1);

    /**
     * @notice Emitted when `account` is granted permission to perform action `actionId` in target `where`.
     */
    event PermissionGranted(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @notice Returns the permission ID for action `actionId`, account `account` and target `where`.
     */
    function getPermissionId(
        bytes32 actionId,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, account, where));
    }

    function grantPermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        for (uint256 i = 0; i < actionIds.length; i++) {
            _grantPermission(actionIds[i], account, where[i]);
        }
    }

    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return hasPermission(actionId, account, where);
    }

    /**
     * @notice Returns true if `account` has permission over the action `actionId` in target `where`.
     */
    function hasPermission(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return
        _isPermissionGranted[getPermissionId(actionId, account, where)] ||
        _isPermissionGranted[getPermissionId(actionId, account, EVERYWHERE)];
    }

    function _grantPermission(
        bytes32 actionId,
        address account,
        address where
    ) private {
        bytes32 permission = getPermissionId(actionId, account, where);
        if (!_isPermissionGranted[permission]) {
            _isPermissionGranted[permission] = true;
            emit PermissionGranted(actionId, account, where);
        }
    }
}