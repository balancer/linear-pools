import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

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

describe('EulerLinearPoolFactory', function () {
  let authorizer: Contract, vault: Contract, tokens: TokenList, factory: Contract;
  let creationTime: BigNumber, admin: SignerWithAddress, owner: SignerWithAddress;
  let factoryVersion: string, poolVersion: string;

  // Euler Mainnet
  const EULER_PROTOCOL = '0x27182842E098f60e3D576794A5bFFb0777E025d3';
  const NAME = 'Euler Balancer Linear Pool Token';
  const SYMBOL = 'ELPT';
  const UPPER_TARGET = fp(2000);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  const EULER_PROTOCOL_ID = 0;

  const EULER_PROTOCOL_NAME = 'Euler';

  beforeEach('deploy factory & tokens', async () => {
    let deployer: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, admin, owner] = await ethers.getSigners();
    ({ authorizer, vault, deployer } = await setupEnvironment());
    const manager = deployer;

    // Deploy tokens
    const mainToken = await deployToken('DAI', 18, deployer);
    const wrappedTokenInstance = await deployPackageContract('MockEulerToken', {
      args: ['eDAI,', 'eDAI', 18, mainToken.address],
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
      name: 'EulerLinearPoolFactory',
      version: '3',
      deployment: 'test-deployment',
    });
    poolVersion = JSON.stringify({
      name: 'EulerLinearPool',
      version: '1',
      deployment: 'test-deployment',
    });
    factory = await deployPackageContract('EulerLinearPoolFactory', {
      args: [
        vault.address,
        ZERO_ADDRESS,
        queries.address,
        factoryVersion,
        poolVersion,
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
        EULER_PROTOCOL,
      ],
    });

    creationTime = await currentTimestamp();
  });

  async function createPool(): Promise<Contract> {
    const DAI = await tokens.getTokenBySymbol('DAI');
    const eDAI = await tokens.getTokenBySymbol('eDAI');
    const tx = await factory.create(
      NAME,
      SYMBOL,
      DAI.address,
      eDAI.address,
      UPPER_TARGET,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      EULER_PROTOCOL_ID
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    expectEvent.inReceipt(receipt, 'EulerLinearPoolCreated', {
      pool: event.args.pool,
      protocolId: EULER_PROTOCOL_ID,
    });

    return getPackageContractDeployedAt('EulerLinearPool', event.args.pool);
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

    it('checks factory awareness of EULER_PROTOCOL contract', async () => {
      expect(await factory.eulerProtocol()).to.equal(EULER_PROTOCOL);
    });

    it('checks the pool version in the factory', async () => {
      expect(await factory.getPoolVersion()).to.equal(poolVersion);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      const DAI = await tokens.getTokenBySymbol('DAI');
      const eDAI = await tokens.getTokenBySymbol('eDAI');

      expect(poolTokens.tokens).to.have.lengthOf(3);
      expect(poolTokens.tokens).to.include(DAI.address);
      expect(poolTokens.tokens).to.include(eDAI.address);
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

      const rebalancer = await getPackageContractDeployedAt('EulerLinearPoolRebalancer', assetManager);

      expect(await rebalancer.getPool()).to.equal(pool.address);
    });

    it('creates a rebalancer aware of EULER_PROTOCOL contract', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);

      const rebalancer = await getPackageContractDeployedAt('EulerLinearPoolRebalancer', assetManager);

      // The wrapped token does not hold the mainToken but rather
      // euler network contract holds the mainTokens. The rebalancer needs
      // to be aware of this address to approve it during wrapping
      expect(await rebalancer.eulerProtocol()).to.equal(EULER_PROTOCOL);
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
      const eDAI = await tokens.getTokenBySymbol('eDAI');
      expect(await pool.getWrappedToken()).to.equal(eDAI.address);
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
      await expect(factory.registerProtocolId(EULER_PROTOCOL_ID, 'Euler')).to.be.revertedWith('BAL#401');
    });

    context('with no registered protocols', () => {
      it('should revert when asking for an unregistered protocol name', async () => {
        await expect(factory.getProtocolName(EULER_PROTOCOL_ID)).to.be.revertedWith('Protocol ID not registered');
      });
    });

    context('with registered protocols', () => {
      beforeEach('grant permissions', async () => {
        const action = await actionId(factory, 'registerProtocolId');
        await authorizer.connect(admin).grantPermissions([action], admin.address, [factory.address]);
      });

      beforeEach('register some protocols', async () => {
        await factory.connect(admin).registerProtocolId(EULER_PROTOCOL_ID, EULER_PROTOCOL_NAME);
      });

      it('protocol ID registration should emit an event', async () => {
        const OTHER_PROTOCOL_ID = 57;
        const OTHER_PROTOCOL_NAME = 'Protocol 57';

        const tx = await factory.connect(admin).registerProtocolId(OTHER_PROTOCOL_ID, OTHER_PROTOCOL_NAME);
        expectEvent.inReceipt(await tx.wait(), 'EulerLinearPoolProtocolIdRegistered', {
          protocolId: OTHER_PROTOCOL_ID,
          name: OTHER_PROTOCOL_NAME,
        });
      });

      it('should register protocols', async () => {
        expect(await factory.getProtocolName(EULER_PROTOCOL_ID)).to.equal(EULER_PROTOCOL_NAME);
      });

      it('should fail when a protocol is already registered', async () => {
        await expect(
          factory.connect(admin).registerProtocolId(EULER_PROTOCOL_ID, 'Random protocol')
        ).to.be.revertedWith('Protocol ID already registered');
      });
    });
  });
});
