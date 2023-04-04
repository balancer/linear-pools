# Gearbox Linear Pool v2

Second deployment of the `GearboxLinearPoolFactory`, for Linear Pools with a Gearbox yield-bearing token (dieselToken).
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `GearboxLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

Supersedes `20230213-gearbox-linear-pool`, updating the BasePoolFactory `_create` function, by requiring an additional `uint256 salt` parameter.

## Useful Files

- [`GearboxLinearPoolFactory` artifact](./artifact/GearboxLinearPoolFactory.json)
- [`GearboxLinearPool` artifact](./artifact/GearboxLinearPool.json)
- [`GearboxLinearPoolRebalancer` artifact](./artifact/GearboxLinearPoolRebalancer.json)