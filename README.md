# Balancer V2 Linear Pool Integrations

[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/guides/boosted-pool-creators/new-protocol.html)
[![License](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)

This repo contains smart contract implementations of all known Linear Pool factories on Balancer. Contributions are welcome!

> IMPORTANT: Before developing your own factory, ensure that your yield-bearing token is truly incompatible with existing solutions. In most cases, unique factories are not required to support forks of existing integrations (e.g., Aave v2). Furthermore, yield vaults implementing the [ERC-4626 standard](https://ethereum.org/en/developers/docs/standards/tokens/erc-4626/) can leverage [that factory](./pkg/linear-pools/contracts/erc4626-linear-pool) and will not require bespoke solutions.

For more information about Boosted Pools and Linear Pools, please consult the [official documentation](https://docs.balancer.fi/concepts/pools/boosted.html).

# Components of a Linear Pool Integration

Each implementation should include the components below.

## LinearPool

The Linear Pool contract defines how the exchange rate is calculated. This is the most critical component because it governs the primary Balancer Pool interactions: swaps, joins, and exits.

> NOTE: All external calls within the `_getWrappedTokenRate` function should include try/catch blocks and utilize the `[ExternalCallLib](https://github.com/balancer-labs/balancer-v2-monorepo/blob/master/pkg/pool-utils/contracts/lib/ExternalCallLib.sol)` to prevent manipulation by nefarious tokens.

### Unit Tests

At a minimum, the unit tests for each Linear Pool should verify the following assumptions:

1. There is strict relationship between a `mainToken` and `wrappedToken` is respected (e.g., cDAI is not paired with USDC).
2. Asset Managers are set correctly.
3. The token rate is calculated correctly and is normalized to 1e18 regardless of `mainToken` or `wrappedToken` decimals.
4. Malicious queries (that manipulate the token rate) are reverted.

## LinearPoolFactory

The Linear Pool Factory contract is responsible for creating new Linear Pools.

### Unit Tests

At a minimum, the unit tests for each Linear Pool Factory should verify the following assumptions:

1. A Pool can be created and its constituent tokens are registered in the Vault.
2. The Factory version and Pool version are set correctly.
3. An Asset Manager is created and configured for each Pool.

## LinearPoolRebalancer

The Linear Pool Rebalancer contract is a helper to enable efficient, capital-free arbitrage and maintain the target balance of `mainToken` within the Pool.

It doesn't have unit tests. The logic of the Rebalancer is instead verified using fork tests, since it is very sensitive to the `wrappedToken` implementation.

## Protocol Interface(s)

In order to implement a Linear Pool for a given yield protocol, we need to understand the following features of that protocol:

* Can the exchange rate between the `mainToken` and `wrappedToken` be queried directly, and is the return value up to date?
  * If not, how can we calculate the exchange rate?
* How is `mainToken` deposited to the protocol?
* How is `wrappedToken` redeemed, or `mainToken` withdrawn, from the protocol?
* How many decimals does the `wrappedToken` have? Is it at all related to the `mainToken` decimals, or is it fixed?

These questions will define which interfaces need to be declared. Some protocols expose all of this via the token contract itself, whereas others perform some or all operations via a central protocol vault.

### Mocked Contracts

In order to properly unit test Linear Pool contracts, mocked token contracts need to be implemented. These can be found inside the `__mocks__` directory.

## Fork Tests

Fork tests are also essential because they act on real token contracts rather than mocks. The Rebalancer, especially, requires precision in order to function correctly, so it is safest to verify it on a real protocol token.

Fork tests can be found inside `[pkg/fork-tests](./pkg/fork-tests)`, and their implementation is described in the next section.

# How-To Guide

1. Create a copy of `[pkg/linear-pools/contracts/erc4626-linear-pool](./pkg/linear-pools/contracts/erc4626-linear-pool)`, and change the name to match your protocol's name (e.g., `pkg/linear-pools/contracts/[YOUR_PROTOCOL]-linear-pool`)
2. Change the names of all files accordingly, e.g., `ERC4626LinearPool.sol`, `ERC4626LinearPoolFactory.sol`, `ERC4626LinearPoolRebalancer.sol`, and all corresponding test files.
3. Within each file, change the names of variables and classes to suit your protocol's name.
4. Inside `[YOUR_PROTOCOL]LinearPool.sol`, adapt the `_getWrappedTokenRate` function to your protocol. Make sure to wrap any external calls in try/catch blocks and utilize the `ExternalCallLib`.

   1. NOTE: During this step, you'll probably need to define an interface for the token/vault of the protocol, especially the function pertaining to the exchange rate.
   
5. Inside `[YOUR_PROTOCOL]LinearPoolRebalancer.sol`, define the `_wrapTokens` (deposit), `_unwrapTokens` (redeem), and `_getRequiredTokensToWrap` (given an amount of `wrappedToken`, how many `mainToken` do I need?) functions.

   1. IMPORTANT: `_getRequiredTokensToWrap` also uses the token rate, so make sure that `_getWrappedTokenRate` and `_getRequiredTokensToWrap` use the same source to fetch the token rate.
   2. IMPORTANT: During this step, the interface created in Step 4 will need to be expanded to include withdraw/deposit functions.
   
6. Edit the `setup` section within your Linear Pool test file to make sure you're deploying and testing the correct Linear Pool. Do not delete any tests from the copied file, since many tests apply to all kinds of Linear Pools and protocols.

   1. NOTE: `setup` deploys a mocked version of the token, so you'll also need to implement a mock. If your protocol uses a central vault contract as well, check the `AaveLinearPool` tests for examples.

7. Run `yarn test` and make sure the Linear Pool tests pass. If tests are not running, go to the repo root and run `yarn && yarn build`. Make sure your node version is above 14 (preferably 16.x).
8. Edit the Linear Pool Rebalancer test file (especially beforeEach `deploy factory & tokens`) to adapt to your protocol. You don't need to change the Protocol ID right now.
9. Run `yarn test` and make sure the Linear Pool Rebalancer tests pass.
10. To begin fork testing, navigate to `pkg/fork-tests/tests`, duplicate the ERC-4626 test folder, and change the name to your protocol. Make sure the number in the folder matches the YYYYMMDD pattern.
11. Delete the `output` directory and the contents of `build-info`.
12. Adapt `index.ts`, `input.ts`, and `readme.md` to your protocol name.
13. Open `pkg/linear-pools` and run `yarn hardhat compile`. Once the contracts are compiled, open the `artifacts/build-info` directory and copy the json inside this file to `pkg/fork-tests/tests/YYYYMMDD-[YOUR-PROTOCOL]-linear-pool/build-info`.
14. Inside your test folder, open `test.fork.ts` and adapt it to your protocol. Make sure that you're using a recent block number, token addresses are correctly defined, and your chosen token holder has a large balance at that block number.
15. Go to `pkg/fork-tests` and run `yarn test`. Make sure your tests are passing.
