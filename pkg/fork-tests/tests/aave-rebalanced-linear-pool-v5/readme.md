# Aave Rebalanced Linear Pool v5

Deployment of the `AaveLinearPoolFactory`, for Linear Pools with a wrapped aToken.

Supersedes `20230206-aave-rebalanced-linear-pool-v4`, updating the BasePoolFactory `_create` function, by requiring an additional `uint256 salt` parameter.

## Useful Files

- [`AaveLinearPool` artifact](./artifact/AaveLinearPool.json)
- [`AaveLinearPoolFactory` artifact](./artifact/AaveLinearPoolFactory.json)
- [`AaveLinearPoolRebalancer` artifact](./artifact/AaveLinearPoolRebalancer.json)