import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp, FP_ZERO } from '@orbcollective/shared-dependencies/numbers';
import {
  deployPackageContract,
  getPackageContractDeployedAt,
  deployToken,
  setupEnvironment,
  getBalancerContractArtifact,
  MAX_UINT112,
  ZERO_ADDRESS,
} from '@orbcollective/shared-dependencies';

import { advanceTime, currentTimestamp, MONTH } from '@orbcollective/shared-dependencies/time';

import * as expectEvent from '@orbcollective/shared-dependencies/expectEvent';
import TokenList from '@orbcollective/shared-dependencies/test-helpers/token/TokenList';

async function deployBalancerContract(
  task: string,
  contractName: string,
  deployer: SignerWithAddress,
  args: unknown[]
): Promise<Contract> {
  const artifact = await getBalancerContractArtifact(task, contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(...args);

  return contract;
}

describe('ERC4626LinearPoolFactory', function () {
  let vault: Contract, tokens: TokenList, factory: Contract;
  let creationTime: BigNumber, owner: SignerWithAddress;
  let factoryVersion: string, poolVersion: string;

  const NAME = 'Balancer Linear Pool Token';
  const SYMBOL = 'LPT';
  const UPPER_TARGET = fp(2000);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  const ERC4626_PROTOCOL_ID = 0;

  beforeEach('deploy factory & tokens', async () => {
    let deployer: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, , owner] = await ethers.getSigners();
    ({ vault, deployer } = await setupEnvironment());
    const manager = deployer;

    // Deploy tokens
    const mainToken = await deployToken('DAI', 18, deployer);
    const wrappedTokenInstance = await deployPackageContract('MockERC4626Token', {
      args: ['stDAI', 'stDAI', 18, mainToken.address],
    });
    const wrappedToken = await getPackageContractDeployedAt('TestToken', wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    factoryVersion = JSON.stringify({
      name: 'ERC4626LinearPoolFactory',
      version: '1',
      deployment: 'test-deployment',
    });
    poolVersion = JSON.stringify({
      name: 'ERC4626LinearPool',
      version: '1',
      deployment: 'test-deployment',
    });
    factory = await deployPackageContract('ERC4626LinearPoolFactory', {
      args: [
        vault.address,
        ZERO_ADDRESS,
        queries.address,
        factoryVersion,
        poolVersion,
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
      ],
    });

    creationTime = await currentTimestamp();
  });

  async function createPool(): Promise<Contract> {
    const DAI = await tokens.getTokenBySymbol('DAI');
    const stDAI = await tokens.getTokenBySymbol('stDAI');
    const tx = await factory.create(
      NAME,
      SYMBOL,
      DAI.address,
      stDAI.address,
      UPPER_TARGET,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      ERC4626_PROTOCOL_ID
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    expectEvent.inReceipt(receipt, 'Erc4626LinearPoolCreated', {
      pool: event.args.pool,
      protocolId: ERC4626_PROTOCOL_ID,
    });

    return getPackageContractDeployedAt('ERC4626LinearPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    beforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('checks the factory version', async () => {
      expect(await factory.version()).to.equal(factoryVersion);
    });

    it('checks the pool version', async () => {
      expect(await pool.version()).to.equal(poolVersion);
    });

    it('checks the pool version in the factory', async () => {
      expect(await factory.getPoolVersion()).to.equal(poolVersion);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      const DAI = await tokens.getTokenBySymbol('DAI');
      const stDAI = await tokens.getTokenBySymbol('stDAI');

      expect(poolTokens.tokens).to.have.lengthOf(3);
      expect(poolTokens.tokens).to.include(DAI.address);
      expect(poolTokens.tokens).to.include(stDAI.address);
      expect(poolTokens.tokens).to.include(pool.address);

      poolTokens.tokens.forEach((token, i) => {
        expect(poolTokens.balances[i]).to.be.eq(token === pool.address ? MAX_UINT112 : 0);
      });
    });

    it('starts with all the BPT minted', async () => {
      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });

    it('sets a rebalancer as the asset manager', async () => {
      const poolId = await pool.getPoolId();
      // We only check the first token, but this will be the asset manager for both main and wrapped
      const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);

      const rebalancer = await getPackageContractDeployedAt('ERC4626LinearPoolRebalancer', assetManager);

      expect(await rebalancer.getPool()).to.equal(pool.address);
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets the owner ', async () => {
      expect(await pool.getOwner()).to.equal(owner.address);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal(NAME);
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal(SYMBOL);
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });

    it('sets main token', async () => {
      const DAI = await tokens.getTokenBySymbol('DAI');
      expect(await pool.getMainToken()).to.equal(DAI.address);
    });

    it('sets wrapped token', async () => {
      const stDAI = await tokens.getTokenBySymbol('stDAI');
      expect(await pool.getWrappedToken()).to.equal(stDAI.address);
    });

    it('sets the targets', async () => {
      const targets = await pool.getTargets();
      expect(targets.lowerTarget).to.be.equal(FP_ZERO);
      expect(targets.upperTarget).to.be.equal(UPPER_TARGET);
    });
  });

  describe('with a created pool', () => {
    let pool: Contract;

    beforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('returns the address of the last pool created by the factory', async () => {
      expect(await factory.getLastCreatedPool()).to.equal(pool.address);
    });
  });

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
    });

    it('multiple pools have the same window end times', async () => {
      const firstPool = await createPool();
      await advanceTime(BASE_PAUSE_WINDOW_DURATION / 3);
      const secondPool = await createPool();

      const { firstPauseWindowEndTime, firstBufferPeriodEndTime } = await firstPool.getPausedState();
      const { secondPauseWindowEndTime, secondBufferPeriodEndTime } = await secondPool.getPausedState();

      expect(firstPauseWindowEndTime).to.equal(secondPauseWindowEndTime);
      expect(firstBufferPeriodEndTime).to.equal(secondBufferPeriodEndTime);
    });

    it('pools created after the pause window end date have no buffer period', async () => {
      await advanceTime(BASE_PAUSE_WINDOW_DURATION + 1);

      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();
      const now = await currentTimestamp();

      expect(pauseWindowEndTime).to.equal(now);
      expect(bufferPeriodEndTime).to.equal(now);
    });
  });
});
