# ERC4626 Linear Pool v4

Third deployment of the `ERC4626LinearPoolFactory`, for Linear Pools with a ERC4626 yield-bearing token.
Supersedes `erc4626-linear-pool-v3`, updating the BasePoolFactory `_create` function, by requiring an additional `uint256 salt` parameter.
Also has a fix in the `ERC4626LinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

## Useful Files

- [`ERC4626LinearPool` artifact](./artifact/ERC4626LinearPool.json)
- [`ERC4626LinearPoolFactory` artifact](./artifact/ERC4626LinearPoolFactory.json)
- [`ERC4626LinearPoolRebalancer` artifact](./artifact/ERC4626LinearPoolRebalancer.json)
