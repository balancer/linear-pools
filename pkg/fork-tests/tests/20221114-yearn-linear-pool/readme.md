# 2022-11-14 - Yearn Linear Pool

First deployment of the `YearnLinearPoolFactory`, for Linear Pools with a Yearn yield-bearing token.
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `YearnLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

## Useful Files

- [`YearnLinearPoolFactory` artifact](./artifact/YearnLinearPoolFactory.json)
- [`YearnLinearPool` artifact](./artifact/YearnLinearPool.json)
- [`YearnLinearPoolRebalancer` artifact](./artifact/YearnLinearPoolRebalancer.json)
- [`YearnShareValueHelper` artifact](./artifact/YearnShareValueHelper.json)