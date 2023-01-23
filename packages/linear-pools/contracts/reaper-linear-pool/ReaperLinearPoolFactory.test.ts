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
import { actionId } from '@orbcollective/shared-dependencies/test-helpers/actions';

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

describe('ReaperLinearPoolFactory', function () {
  let authorizer: Contract, vault: Contract, tokens: TokenList, factory: Contract;
  let creationTime: BigNumber, admin: SignerWithAddress, owner: SignerWithAddress;
  let factoryVersion: string, poolVersion: string;

  const NAME = 'Balancer Linear Pool Token';
  const SYMBOL = 'LPT';
  const UPPER_TARGET = fp(2000);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  const AAVE_PROTOCOL_ID = 0;
  const BEEFY_PROTOCOL_ID = 1;
  const STURDY_PROTOCOL_ID = 2;
  const YEARN_PROTOCOL_ID = 3;
  const REAPER_PROTOCOL_ID = 6;

  const AAVE_PROTOCOL_NAME = 'AAVE';
  const BEEFY_PROTOCOL_NAME = 'Beefy';
  const STURDY_PROTOCOL_NAME = 'Sturdy';
  const YEARN_PROTOCOL_NAME = 'Yearn';
  const REAPER_PROTOCOL_NAME = 'Reaper';


  beforeEach('deploy factory & tokens', async () => {
    let deployer: SignerWithAddress;
    let trader: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, admin, owner] = await ethers.getSigners();
    ({ authorizer, vault, deployer } = await setupEnvironment());
    const manager = deployer;

    // Deploy tokens
    const mainToken = await deployToken('DAI', 18, deployer);
    const mockReaperVault = await deployPackageContract('MockReaperVault', {
      args: ['rpDAI', 'rpDAI', 18, mainToken.address, fp(1)],
    });
    const wrappedToken = await getPackageContractDeployedAt('TestToken', mockReaperVault.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    factoryVersion = JSON.stringify({
      name: 'ReaperLinearPoolFactory',
      version: '1',
      deployment: 'test-deployment',
    });
    poolVersion = JSON.stringify({
      name: 'ReaperLinearPool',
      version: '1',
      deployment: 'test-deployment',
    });
    factory = await deployPackageContract('ReaperLinearPoolFactory', {
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
    const rpDAI = await tokens.getTokenBySymbol('rpDAI');
    const tx = await factory.create(
      NAME,
      SYMBOL,
      DAI.address,
      rpDAI.address,
      UPPER_TARGET,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      REAPER_PROTOCOL_ID
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    expectEvent.inReceipt(receipt, 'ReaperLinearPoolCreated', {
      pool: event.args.pool,
      protocolId: REAPER_PROTOCOL_ID,
    });

    return getPackageContractDeployedAt('ReaperLinearPool', event.args.pool);
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
      const rpDAI = await tokens.getTokenBySymbol('rpDAI');

      expect(poolTokens.tokens).to.have.lengthOf(3);
      expect(poolTokens.tokens).to.include(DAI.address);
      expect(poolTokens.tokens).to.include(rpDAI.address);
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

      const rebalancer = await getPackageContractDeployedAt('ReaperLinearPoolRebalancer', assetManager);

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
      const rpDAI = await tokens.getTokenBySymbol('rpDAI');
      expect(await pool.getWrappedToken()).to.equal(rpDAI.address);
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

  describe('protocol id', () => {
    it('should not allow adding protocols without permission', async () => {
      await expect(factory.registerProtocolId(REAPER_PROTOCOL_ID, 'Reaper')).to.be.revertedWith('BAL#401');
    });

    context('with no registered protocols', () => {
      it('should revert when asking for an unregistered protocol name', async () => {
        await expect(factory.getProtocolName(REAPER_PROTOCOL_ID)).to.be.revertedWith('Protocol ID not registered');
      });
    });

    context('with registered protocols', () => {
      beforeEach('grant permissions', async () => {
        const action = await actionId(factory, 'registerProtocolId');
        await (await authorizer.connect(admin)).grantPermissions([action], admin.address, [factory.address]);
      });

      beforeEach('register some protocols', async () => {
        await factory.connect(admin).registerProtocolId(AAVE_PROTOCOL_ID, AAVE_PROTOCOL_NAME);
        await factory.connect(admin).registerProtocolId(BEEFY_PROTOCOL_ID, BEEFY_PROTOCOL_NAME);
        await factory.connect(admin).registerProtocolId(STURDY_PROTOCOL_ID, STURDY_PROTOCOL_NAME);
        await factory.connect(admin).registerProtocolId(REAPER_PROTOCOL_ID, REAPER_PROTOCOL_NAME);
      });

      it('protocol ID registration should emit an event', async () => {
        const OTHER_PROTOCOL_ID = 57;
        const OTHER_PROTOCOL_NAME = 'Protocol 57';
        const tx = await factory.connect(admin).registerProtocolId(OTHER_PROTOCOL_ID, OTHER_PROTOCOL_NAME);
        expectEvent.inReceipt(await tx.wait(), 'ReaperLinearPoolProtocolIdRegistered', {
          protocolId: OTHER_PROTOCOL_ID,
          name: OTHER_PROTOCOL_NAME,
        });
      });

      it('should register protocols', async () => {
        expect(await factory.getProtocolName(AAVE_PROTOCOL_ID)).to.equal(AAVE_PROTOCOL_NAME);
        expect(await factory.getProtocolName(BEEFY_PROTOCOL_ID)).to.equal(BEEFY_PROTOCOL_NAME);
        expect(await factory.getProtocolName(STURDY_PROTOCOL_ID)).to.equal(STURDY_PROTOCOL_NAME);
        expect(await factory.getProtocolName(REAPER_PROTOCOL_ID)).to.equal(REAPER_PROTOCOL_NAME);
      });

      it('should fail when a protocol is already registered', async () => {
        await expect(
          factory.connect(admin).registerProtocolId(STURDY_PROTOCOL_ID, 'Random protocol')
        ).to.be.revertedWith('Protocol ID already registered');
      });
    });
  });
});