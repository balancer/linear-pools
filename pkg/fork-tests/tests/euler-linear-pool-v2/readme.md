# Euler Linear Pool v2

Second deployment of the `EulerLinearPoolFactory`, for Linear Pools with an Euler yield-bearing token.

Supersedes `euler-linear-pool`, updating the BasePoolFactory `_create` function, by requiring an additional `uint256 salt` parameter.

## Useful Files

- [`EulerLinearPool` artifact](./artifact/EulerLinearPool.json)
- [`EulerLinearPoolFactory` artifact](./artifact/EulerLinearPoolFactory.json)
- [`EulerLinearPoolRebalancer` artifact](./artifact/EulerLinearPoolRebalancer.json)