# Silo Linear Pool v2

Second deployment of the `SiloLinearPoolFactory`, for Linear Pools with a Silo yield-bearing token (shareToken).
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `SiloLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

Supersedes `20230315-silo-linear-pool`, updating the BasePoolFactory `_create` function, by requiring an additional `uint256 salt` parameter.

## Useful Files

- [`SiloLinearPool` artifact](./artifact/SiloLinearPool.json)
- [`SiloLinearPoolFactory` artifact](./artifact/SiloLinearPoolFactory.json)
- [`SiloLinearPoolRebalancer` artifact](./artifact/SiloLinearPoolRebalancer.json)