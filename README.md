# Orb Collective's Linear Pool Project

This repo contains implementations of all linear pools supported by Balancer.

IMPORTANT: Before developing your own Linear Pool, make sure your yield-bearing vault 
is not ERC4626 compliant and is not a fork from Aave v2, in which cases a new linear pool
is not required.

More information about boosted pools and linear pools: [LINK]

# Components of a Linear Pool

Every Linear Pool project should have the components below.

## LinearPool

Linear Pool defines how the exchange rate is calculated. 

* NOTE: `_getWrappedTokenRate` function has a try/catch block. Calls to an external view 
function implemented by the main token and related contracts need to be wrapped by 
try/catch blocks for security purposes, to avoid exploiting attacks involving the rate 
manipulation of the token.

### Unit Tests

The unit tests of the LinearPool should test:

1. If Pool accepts a main token that is not related to the wrapped token 
(should not accept, except when pool is ERC4626);
2. If asset managers are set correctly (needed to wrap/unwrap tokens);
3. If token rate is calculated correctly;
4. If malicious queries (that manipulates the token rate) are reverted.

## LinearPoolFactory

Linear Pool Factory is responsible for creating new linear pools and defines the protocol
of the created pools.

### Protocol ID

Aave has multiple forked tokens from different protocols. ERC4626 is implemented by 
many protocols as well. PROTOCOL ID exists to differentiate such protocols in a factory.
Therefore, each protocol must have its own factory, even if the pool code is shared.

New PROTOCOL IDs should be approved by governance vote, so talk to us in case you need
to register a new PROTOCOL ID. [EMAIL]

### Unit Tests

The unit tests of the LinearPoolFactory should test:

1. If pools are correctly created;
2. If pool tokens are correctly defined;
3. If Protocol IDs are defined correctly and requires permission to be manipulated.

## LinearPoolRebalancer

LinearPoolRebalancer is the component that balances the amount of main token, available to
swap in the pool, and the wrapped token (the amount of assets transferred to the
yield-bearing vault of the linear pool protocol).

It doesn't have unit tests. The logic of the rebalancer are tested in fork tests, since it 
heavily depends on the wrapped token implementation.

## Token Interface

In order to implement a linear pool for a certain protocol, we need to figure out the 
following features in that protocol:

* How to get/calculate rate between wrapped and main token?
* How to deposit main tokens in the lending protocol?
* How to withdraw main tokens from the lending protocol?
* How many decimals the wrapped token has? Is it equal to decimals of main token?

These questions will define which interfaces will need to be declared. Some protocols 
have the rate calculated by the token contract, but deposit/withdraw functions executed 
by a vault or lending pool contracts. Depending on how a protocol is implemented, more 
interfaces need to be implemented (look at Aave and Gearbox for examples of multiple 
interfaces).

### Mocked contracts

In order to properly unit test Linear Pool contracts, mocked token contracts need to be 
implemented. These mocks are inside `__mocks__` folder.

## Fork Tests

Fork tests are required because they don't mock token contracts. The rebalancer interacts with
on-chain token contracts catching potential integration bugs. Fork tests are inside 
`packages/fork-tests` folder, and their implementation is described in the next section.

# How to implement a new Linear Pool?

1. Duplicate folder `packages/linear-pools/contracts/erc4626-linear-pool`, and change the 
name to your protocol's name (e.g. 
`packages/linear-pools/contracts/[YOUR_PROTOCOL]-linear-pool`)
2. Change the name of LinearPool, LinearPoolFactory, LinearPoolRebalancer and test files to 
suit your protocol name.
3. Within each file, change the name of variables and classes to suit your protocol name.
4. Inside LinearPool file, change `_getWrappedTokenRate` function implementation to adapt
rate calculation to your protocol. Make sure to wrap any external view functions implemented 
by the token or related contracts in try/catch blocks, to avoid malicious rate manipulations.

   1. NOTE: During this step, you'll probably need to define an interface for the token/vault
   of the protocol, and define the function that returns the token rate.
   
5. Inside LinearPoolRebalancer, define the functions for `_wrapTokens` (Deposit main tokens), 
`_unwrapTokens` (withdraw main tokens) and `_getRequiredTokensToWrap` (Given amount of wrapped tokens, 
how many main tokens do I need?).

   1. IMPORTANT: `_getRequiredTokensToWrap` also uses the token rate, so make sure that LinearPool's
      `_getWrappedTokenRate` and `_getRequiredTokensToWrap` use the same source to fetch the token
      rate.
   2. IMPORTANT: During this step, the interface created in `4` will need to be expanded to include
      withdraw/deposit functions
   
6. Edit LinearPool test file `setup`, to make sure you're deploying and testing the right linear 
pool. Do not delete any test from the copied file, since that tests apply to all kinds of linear 
pools and protocols.

   1. Notice that `setup` deploys a mocked version of the token, so you'll need to implement a mock. 
   If your protocol uses vault/pool contracts as well, check Aave tests to see how to deploy 
   mocked versions of vault.

7. Run tests for the LinearPool test file and make sure they pass (`yarn test` in the linear-pools folder). 
If tests are not running, go to root folder and run `yarn && yarn build`. Make sure your 
node version is above 14 (preferentially 16.x)
8. Edit LinearPoolRebalancer test file (especially beforeEach `deploy factory & tokens`) to adapt 
to your protocol. You don't need to change the Protocol ID right now.
9. Run tests for LinearPoolRebalancer and make sure they pass.
10. To begin forked testing navigate to `packages/fork-tests/tests` and duplicate the erc4626 test
folder, changing the name to your protocol. Make sure the number in the folder matches YYYYMMDD
pattern.
11. Delete the output folder and contents of the build-info folder of the newly created folder.
12. Adapt index.ts and input.ts to your protocol name. Also change the readme.md file to match your 
protocol name.
13. Open `packages/linear-pools` and run `yarn hardhat compile`. Once the contracts are compiled, open the
`artifacts/build-info` folder and copy the json inside this file to 
`packages/fork-tests/tests/YYYYMMDD-[YOUR-PROTOCOL]-linear-pool/build-info` folder 
(don't need to rename now).
14. Inside your test folder, open `test.fork.ts` file and edit it to adapt to your protocol. 
Make sure you're using a recent block number, that token addresses are correctly defined 
and that token holder has balance in that block number.
15. Go to `packages/fork-tests` folder and run `yarn test`. Make sure your tests are passing.