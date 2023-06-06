import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@orbcollective/shared-dependencies/numbers';
import {
  deployPackageContract,
  getPackageContractDeployedAt,
  deployToken,
  setupEnvironment,
  getBalancerContractArtifact,
  MAX_UINT256,
  ZERO_ADDRESS,
} from '@orbcollective/shared-dependencies';

import { MONTH } from '@orbcollective/shared-dependencies/time';

import * as expectEvent from '@orbcollective/shared-dependencies/expectEvent';
import TokenList from '@orbcollective/shared-dependencies/test-helpers/token/TokenList';
import { randomBytes } from 'ethers/lib/utils';

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

enum RevertType {
  DoNotRevert,
  NonMalicious,
  MaliciousSwapQuery,
  MaliciousJoinExitQuery,
}

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

describe('BprotocolLinearPool', function () {
  let pool: Contract,
    vault: Contract,
    tokens: TokenList,
    mainToken: Contract,
    rebasingYieldToken: Contract,
    wrappedYieldToken: Contract;
  let poolFactory: Contract;
  let wrappedYieldTokenInstance: Contract;
  let guardian: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let manager: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BPROTOCOL_PROTOCOL_ID = 0;

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('Setup', async () => {
    let deployer: SignerWithAddress;
    let trader: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, lp, owner] = await ethers.getSigners();
    ({ vault, deployer, trader } = await setupEnvironment());
    manager = deployer;
    guardian = trader;

    // Deploy tokens
    mainToken = await deployToken('LUSD', 18, deployer);

    // mock stability pool
    const stabilityPool = await deployPackageContract('MockStabilityPool', {
      args: [],
    });

    // mock bamm
    const bamm = await deployPackageContract('MockBProtocolAMM', {
      args: [stabilityPool.address],
    });

    // Wrapper deployment information
    // TODO: implement gauge & lqty handlers
    // TODO: implement eth handlers

    const mockGauge = ZERO_ADDRESS;
    const lqty = ZERO_ADDRESS;
    wrappedYieldTokenInstance = await deployPackageContract('MockBProtocolWrapper', {
      args: [mockGauge, lqty, stabilityPool.address, bamm.address],
    });
    wrappedYieldToken = await getPackageContractDeployedAt('TestToken', wrappedYieldTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedYieldToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    poolFactory = await deployPackageContract('BProtocolLinearPoolFactory', {
      args: [
        vault.address,
        ZERO_ADDRESS,
        queries.address,
        'factoryVersion',
        'poolVersion',
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
      ],
    });

    // Deploy and initialize pool
    const tx = await poolFactory.create(
      'Balancer Pool Token',
      'BPT',
      mainToken.address,
      wrappedYieldToken.address,
      bn(0),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      BPROTOCOL_PROTOCOL_ID,
      randomBytes(32)
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await getPackageContractDeployedAt('LinearPool', event.args.pool);
    const x = 5;
  });

  describe('constructor', () => {
    it('do not revert if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await deployToken('USDC', 18, manager);

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedYieldToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          BPROTOCOL_PROTOCOL_ID,
          randomBytes(32)
        )
      ).to.be.ok;
    });
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second.address);

      expect(firstAssetManager).to.not.equal(ZERO_ADDRESS);
      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    context('under normal operation', () => {
      it('returns the expected value', async () => {
        // 18 decimals
        // 1e18 implies a 1:1 exchange rate between main and wrapped token
        await wrappedYieldTokenInstance.setSharesExchangeRate(bn(1e18));
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

        // We now double the reserve's normalised income to change the exchange rate to 2:1
        await wrappedYieldTokenInstance.setSharesExchangeRate(bn(2e18));
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
      });
    });

    context('when BProtocol reverts maliciously to impersonate a swap query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await wrappedYieldTokenInstance.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });

    context('when BProtocol reverts maliciously to impersonate a join/exit query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await wrappedYieldTokenInstance.setRevertType(RevertType.MaliciousJoinExitQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });

  describe('rebalancing', () => {
    context('when BProtocol reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      beforeEach('provide initial liquidity to pool', async () => {
        await wrappedYieldTokenInstance.setRevertType(RevertType.DoNotRevert);
        const poolId = await pool.getPoolId();
        await tokens.approve({ to: vault, amount: fp(100), from: lp });
        await vault.connect(lp).swap(
          {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: mainToken.address,
            assetOut: pool.address,
            amount: fp(10),
            userData: '0x',
          },
          { sender: lp.address, fromInternalBalance: false, recipient: lp.address, toInternalBalance: false },
          0,
          MAX_UINT256
        );
      });

      beforeEach('deploy and initialize pool', async () => {
        const poolId = await pool.getPoolId();
        const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
        rebalancer = await getPackageContractDeployedAt('BProtocolLinearPoolRebalancer', assetManager);
      });

      beforeEach('make BProtocol6 lending pool start reverting', async () => {
        await wrappedYieldTokenInstance.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(rebalancer.rebalance(guardian.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });
});
